/**
 * Edits a repository's local, never-committed metadata files:
 *
 * - `.git/info/exclude` hides a `.vscode/settings.json` that Nameplate created
 *   just to hold the status bar color;
 * - `.git/info/attributes` attaches Nameplate's clean filter to a settings
 *   file that Git tracks, so Git never sees Nameplate's color lines.
 *
 * Nameplate marks its lines so it can remove exactly those lines again later.
 */

export const EXCLUDE_MARKER =
  '# Nameplate (VS Code extension): keeps the per-project status bar color out of Git.';
const EXCLUDE_HINT = (pattern: string): string =>
  `# Delete these lines to let Git see ${pattern.replace(/^\//, '')} again.`;

export const ATTRIBUTES_MARKER =
  '# Nameplate (VS Code extension): Git never sees its status bar colors in the next file.';
const ATTRIBUTES_HINT = '# Nameplate removes these lines when it stops coloring the project.';
export const FILTER_NAME = 'nameplate';

/** Turns a repository-relative path into an anchored gitignore pattern, escaping special characters. */
export function toExcludePattern(relativePath: string): string {
  const escaped = relativePath
    .replace(/\\/g, '\\\\')
    .replace(/([*?[\]])/g, '\\$1')
    .replace(/^([#!])/, '\\$1')
    .replace(/ $/, '\\ ');
  return `/${escaped.replace(/^\/+/, '')}`;
}

/** The `.git/info/attributes` line that attaches the clean filter to a file. */
export function toAttributesLine(relativePath: string): string {
  // Attribute patterns cannot contain spaces unquoted; such paths are quoted C-style.
  const pattern = toExcludePattern(relativePath);
  const quoted = /\s/.test(pattern) ? `"${pattern.replace(/(["\\])/g, '\\$1')}"` : pattern;
  return `${quoted} filter=${FILTER_NAME}`;
}

/** True when a non-comment line matches the pattern exactly. */
export function excludeHasPattern(text: string, pattern: string): boolean {
  return hasLine(text, pattern);
}

/** Appends Nameplate's block for the pattern unless the pattern is already present. */
export function addExcludeBlock(text: string, pattern: string): string {
  return addBlock(text, [EXCLUDE_MARKER, EXCLUDE_HINT(pattern)], pattern);
}

/**
 * Removes the block Nameplate added for the pattern. A pattern line that was
 * not written by Nameplate (no marker in front of it) is left alone.
 */
export function removeExcludeBlock(text: string, pattern: string): string {
  return removeBlock(text, EXCLUDE_MARKER, pattern);
}

export function addAttributesBlock(text: string, relativePath: string): string {
  return addBlock(text, [ATTRIBUTES_MARKER, ATTRIBUTES_HINT], toAttributesLine(relativePath));
}

export function removeAttributesBlock(text: string, relativePath: string): string {
  return removeBlock(text, ATTRIBUTES_MARKER, toAttributesLine(relativePath));
}

/** Whether any attributes line written by Nameplate is left. */
export function hasNameplateAttributes(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === ATTRIBUTES_MARKER);
}

function hasLine(text: string, wanted: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#') && trimmed === wanted;
  });
}

function addBlock(text: string, header: readonly string[], line: string): string {
  if (hasLine(text, line)) {
    return text;
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const separator = text.length === 0 || text.endsWith('\n') ? '' : newline;
  return `${text}${separator}${[...header, line].join(newline)}${newline}`;
}

function removeBlock(text: string, marker: string, line: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i] ?? '';
    if (current.trim() === marker) {
      let j = i + 1;
      while ((lines[j] ?? '').trim().startsWith('#') && (lines[j] ?? '').trim() !== marker) {
        j++;
      }
      if ((lines[j] ?? '').trim() === line) {
        i = j;
        continue;
      }
      // Marker without our line: keep it, something else is going on.
    }
    result.push(current);
  }
  return result.join(newline);
}
