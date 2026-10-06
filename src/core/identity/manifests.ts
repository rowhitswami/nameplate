/**
 * Readers for the project manifests Nameplate understands. Each reader is
 * tolerant: malformed input yields `undefined` instead of throwing, so a broken
 * `package.json` never breaks project detection.
 */

export interface PackageJsonInfo {
  readonly name?: string;
  readonly displayName?: string;
  readonly productName?: string;
  /** Names of dependencies and devDependencies. */
  readonly dependencies: ReadonlySet<string>;
  readonly isVsCodeExtension: boolean;
}

export interface PyprojectInfo {
  readonly name?: string;
  /** Lowercase distribution names of declared dependencies (best effort). */
  readonly dependencies: ReadonlySet<string>;
}

export function parsePackageJson(text: string): PackageJsonInfo | undefined {
  const json = parseJsonObject(text);
  if (!json) {
    return undefined;
  }
  const dependencies = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = json[field];
    if (isRecord(deps)) {
      for (const key of Object.keys(deps)) {
        dependencies.add(key);
      }
    }
  }
  const engines = json['engines'];
  return {
    name: optionalString(json['name']),
    displayName: optionalString(json['displayName']),
    productName: optionalString(json['productName']),
    dependencies,
    isVsCodeExtension: isRecord(engines) && typeof engines['vscode'] === 'string',
  };
}

/** `@scope/name` → `name`, or `scope name` when the unscoped part is not meaningful on its own. */
export function unscopePackageName(name: string, isGeneric: (n: string) => boolean): string {
  const match = /^@([^/]+)\/(.+)$/.exec(name);
  if (!match) {
    return name;
  }
  const scope = match[1] ?? '';
  const unscoped = match[2] ?? '';
  return isGeneric(unscoped) ? `${scope} ${unscoped}` : unscoped;
}

/** Expo's `app.json` (`{ "expo": { "name": "BrightDesk" } }`), also plain `{ "name": ... }`. */
export function parseAppJson(
  text: string,
): { readonly name?: string; readonly isExpo: boolean } | undefined {
  const json = parseJsonObject(text);
  if (!json) {
    return undefined;
  }
  const expo = json['expo'];
  if (isRecord(expo)) {
    return { name: optionalString(expo['name']), isExpo: true };
  }
  return { name: optionalString(json['name']), isExpo: false };
}

export function parsePyproject(text: string): PyprojectInfo {
  const name =
    tomlValue(text, 'project', 'name') ??
    tomlValue(text, 'tool.poetry', 'name') ??
    tomlValue(text, 'tool.flit.metadata', 'module');
  const dependencies = new Set<string>();
  for (const section of tomlSections(text)) {
    const isDependencySection =
      section.name === 'project' ||
      section.name === 'project.optional-dependencies' ||
      section.name === 'dependency-groups' ||
      section.name === 'tool.poetry.dependencies' ||
      section.name === 'tool.poetry.dev-dependencies' ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section.name);
    if (!isDependencySection) {
      continue;
    }
    if (section.name.startsWith('tool.poetry')) {
      for (const key of section.keys) {
        dependencies.add(normalizeDistributionName(key));
      }
      continue;
    }
    for (const literal of section.arrayStrings) {
      const dep = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(literal)?.[1];
      if (dep) {
        dependencies.add(normalizeDistributionName(dep));
      }
    }
  }
  return { name, dependencies };
}

export function parseRequirements(text: string): ReadonlySet<string> {
  const dependencies = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (match?.[1] && !line.trim().startsWith('-')) {
      dependencies.add(normalizeDistributionName(match[1]));
    }
  }
  return dependencies;
}

export function parseCargoToml(text: string): { readonly name?: string } {
  return { name: tomlValue(text, 'package', 'name') };
}

export function parseGoMod(text: string): { readonly module?: string; readonly name?: string } {
  const module = /^\s*module\s+("?)([^\s"]+)\1\s*$/m.exec(text)?.[2];
  if (!module) {
    return {};
  }
  const segments = module.split('/').filter((s) => s.length > 0);
  // Drop a major-version suffix such as `/v2`.
  if (segments.length > 1 && /^v[0-9]+$/.test(segments[segments.length - 1] ?? '')) {
    segments.pop();
  }
  return { module, name: segments[segments.length - 1] };
}

export function parsePubspec(text: string): {
  readonly name?: string;
  readonly isFlutter: boolean;
} {
  const name = /^name:\s*["']?([A-Za-z0-9_]+)["']?\s*$/m.exec(text)?.[1];
  return { name, isFlutter: /^\s{2,}flutter:/m.test(text) || /^flutter:/m.test(text) };
}

export function parseComposerJson(
  text: string,
): { readonly name?: string; readonly dependencies: ReadonlySet<string> } | undefined {
  const json = parseJsonObject(text);
  if (!json) {
    return undefined;
  }
  const dependencies = new Set<string>();
  for (const field of ['require', 'require-dev']) {
    const deps = json[field];
    if (isRecord(deps)) {
      for (const key of Object.keys(deps)) {
        dependencies.add(key);
      }
    }
  }
  const full = optionalString(json['name']);
  const name = full?.includes('/') ? full.slice(full.indexOf('/') + 1) : full;
  return { name, dependencies };
}

// --- helpers ---------------------------------------------------------------

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

interface TomlSection {
  readonly name: string;
  readonly keys: string[];
  /** String literals found inside array values of this section. */
  readonly arrayStrings: string[];
  readonly values: Map<string, string>;
}

/**
 * A deliberately small TOML reader: sections, `key = "string"` pairs and the
 * string literals inside (possibly multi-line) arrays. Enough for manifest
 * names and dependency lists; not a general TOML parser.
 */
function tomlSections(text: string): TomlSection[] {
  const sections: TomlSection[] = [];
  let current: TomlSection = { name: '', keys: [], arrayStrings: [], values: new Map() };
  sections.push(current);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i] ?? '');
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(trimmed);
    if (header) {
      current = {
        name: (header[1] ?? '').replace(/"/g, '').trim(),
        keys: [],
        arrayStrings: [],
        values: new Map(),
      };
      sections.push(current);
      continue;
    }
    const entry = /^("?)([A-Za-z0-9_.-]+)\1\s*=\s*(.*)$/.exec(trimmed);
    if (!entry) {
      continue;
    }
    const key = entry[2] ?? '';
    let value = entry[3] ?? '';
    current.keys.push(key);
    if (value.startsWith('[')) {
      // Collect the array across lines until the brackets balance.
      let depth = 0;
      let collected = '';
      let j = i;
      for (; j < lines.length; j++) {
        const part = j === i ? value : stripTomlComment(lines[j] ?? '');
        collected += `${part}\n`;
        depth += count(part, '[') - count(part, ']');
        if (depth <= 0) {
          break;
        }
      }
      i = j;
      for (const literal of collected.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
        current.arrayStrings.push(literal[1] ?? literal[2] ?? '');
      }
      continue;
    }
    const literal = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(value);
    if (literal) {
      value = literal[1] ?? literal[2] ?? '';
    }
    current.values.set(key, value);
  }
  return sections;
}

function tomlValue(text: string, section: string, key: string): string | undefined {
  const value = tomlSections(text)
    .find((s) => s.name === section)
    ?.values.get(key)
    ?.trim();
  return value && value.length > 0 ? value : undefined;
}

function stripTomlComment(line: string): string {
  let inString: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inString) {
      if (char === '\\' && inString === '"') {
        i++;
      } else if (char === inString) {
        inString = undefined;
      }
    } else if (char === '"' || char === "'") {
      inString = char;
    } else if (char === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) {
    if (c === char) {
      n++;
    }
  }
  return n;
}
