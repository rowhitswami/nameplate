/**
 * Minimal parser for Git's INI-like config format, sufficient to extract the
 * configured remotes from `.git/config` without spawning a git process.
 */

export interface GitRemote {
  readonly name: string;
  /** The first (fetch) URL of the remote, as written in the config. */
  readonly url: string;
}

interface Section {
  readonly name: string;
  readonly subsection?: string;
  readonly entries: { key: string; value: string }[];
}

const SECTION_PATTERN = /^\s*\[\s*([^\]"\s]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*(?:[#;].*)?$/;
const ENTRY_PATTERN = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/;

export function parseGitConfigSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  const lines = joinContinuations(text.split(/\r?\n/));
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    const section = SECTION_PATTERN.exec(line);
    if (section) {
      let name = (section[1] ?? '').toLowerCase();
      let subsection = section[2] !== undefined ? unescapeQuoted(section[2]) : undefined;
      // Deprecated `[section.subsection]` syntax.
      if (subsection === undefined && name.includes('.')) {
        const dot = name.indexOf('.');
        subsection = name.slice(dot + 1);
        name = name.slice(0, dot);
      }
      current = { name, subsection, entries: [] };
      sections.push(current);
      continue;
    }
    const entry = ENTRY_PATTERN.exec(line);
    if (entry && current) {
      current.entries.push({
        key: (entry[1] ?? '').toLowerCase(),
        value: parseValue(entry[2] ?? 'true'),
      });
    }
  }
  return sections;
}

export function parseGitRemotes(text: string): GitRemote[] {
  const remotes: GitRemote[] = [];
  for (const section of parseGitConfigSections(text)) {
    if (section.name !== 'remote' || section.subsection === undefined) {
      continue;
    }
    const url = section.entries.find((e) => e.key === 'url')?.value;
    if (url && url.length > 0 && !remotes.some((r) => r.name === section.subsection)) {
      remotes.push({ name: section.subsection, url });
    }
  }
  return remotes;
}

/** Picks the remote that best represents the project: origin, then upstream, then the first one. */
export function selectPrimaryRemote(remotes: readonly GitRemote[]): GitRemote | undefined {
  return (
    remotes.find((r) => r.name === 'origin') ??
    remotes.find((r) => r.name === 'upstream') ??
    remotes[0]
  );
}

function joinContinuations(lines: string[]): string[] {
  const result: string[] = [];
  let buffer: string | undefined;
  for (const line of lines) {
    const combined = buffer === undefined ? line : buffer + line;
    if (/(?:^|[^\\])(?:\\\\)*\\$/.test(combined)) {
      buffer = combined.slice(0, -1);
      continue;
    }
    result.push(combined);
    buffer = undefined;
  }
  if (buffer !== undefined) {
    result.push(buffer);
  }
  return result;
}

/** Strips trailing comments (outside quotes), handles quoted segments and escapes. */
function parseValue(raw: string): string {
  let result = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i] ?? '';
    if (char === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1] ?? '';
      result += unescapeChar(next);
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === '#' || char === ';')) {
      break;
    }
    result += char;
  }
  return inQuotes ? result : result.trim();
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => unescapeChar(c));
}

function unescapeChar(char: string): string {
  switch (char) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'b':
      return '\b';
    default:
      return char;
  }
}
