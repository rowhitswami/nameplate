/**
 * Removes Nameplate's color keys from the text of a settings file, so that Git
 * only ever sees the file as it would be without Nameplate. Used by the local
 * Git clean filter (see `src/gitFilter/cleanFilter.ts`).
 *
 * Edits are applied with `jsonc-parser`, the library VS Code itself uses to
 * write settings, key by key, so the rest of the file (comments, formatting,
 * other color customizations) stays byte-for-byte as it is. For the common
 * case (Nameplate added its block to a file that had none) the result is
 * exactly the original text.
 */
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
  type FormattingOptions,
  type Node,
} from 'jsonc-parser';

/** What Nameplate wrote into one settings file; stored in `.git/nameplate-colors.json`. */
export interface CleanRecord {
  /** JSON path of the color customizations object, e.g. `["workbench.colorCustomizations"]`. */
  readonly jsonPath: readonly string[];
  /** Keys Nameplate wrote, with the values it wrote. */
  readonly applied: Readonly<Record<string, string>>;
  /** Values before Nameplate wrote each key; `null` = the key did not exist. */
  readonly previous: Readonly<Record<string, unknown>>;
  /** Whether the customizations object existed before Nameplate's first write. */
  readonly containerExisted: boolean;
}

/** File in the (per-worktree) git directory that tells the filter which keys are Nameplate's. */
export const CLEAN_RECORD_FILE_NAME = 'nameplate-colors.json';

export const SETTINGS_JSON_PATH: readonly string[] = ['workbench.colorCustomizations'];
export const WORKSPACE_FILE_JSON_PATH: readonly string[] = [
  'settings',
  'workbench.colorCustomizations',
];

/**
 * Returns the text with Nameplate's keys restored to their previous values (or
 * removed), or `undefined` when the text contains nothing of Nameplate's.
 * Keys whose value differs from what Nameplate wrote belong to someone else
 * and are left alone.
 */
export function removeManagedColors(text: string, record: CleanRecord): string | undefined {
  const container = objectAt(text, record.jsonPath);
  if (!container) {
    return undefined;
  }
  const formattingOptions = detectFormatting(text);
  let result = text;
  let changed = false;
  for (const [key, value] of Object.entries(record.applied)) {
    if (valueOf(container, key) !== value) {
      continue;
    }
    const previous = record.previous[key];
    const replacement = previous === null || previous === undefined ? undefined : previous;
    result = applyEdits(
      result,
      modify(result, [...record.jsonPath, key], replacement, { formattingOptions }),
    );
    changed = true;
  }
  if (!changed) {
    return undefined;
  }
  if (!record.containerExisted) {
    const remaining = objectAt(result, record.jsonPath);
    if (remaining && (remaining.children?.length ?? 0) === 0) {
      result = applyEdits(
        result,
        modify(result, [...record.jsonPath], undefined, { formattingOptions }),
      );
    }
  }
  return result;
}

/** Indentation and line endings as used by the file, so edits blend in. */
export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith('\t')) {
    return { insertSpaces: false, tabSize: 4, eol };
  }
  return { insertSpaces: true, tabSize: indent && indent.length > 0 ? indent.length : 4, eol };
}

function objectAt(text: string, path: readonly string[]): Node | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  const node = root ? findNodeAtLocation(root, [...path]) : undefined;
  return node?.type === 'object' ? node : undefined;
}

function valueOf(container: Node, key: string): unknown {
  for (const property of container.children ?? []) {
    const [name, value] = property.children ?? [];
    if (name?.value === key) {
      return value?.type === 'string' ? value.value : undefined;
    }
  }
  return undefined;
}
