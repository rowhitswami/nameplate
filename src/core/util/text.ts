/** Text helpers for status bar items and Markdown tooltips. */

/** Prevents `$(icon)` sequences in user-controlled text from rendering as codicons. */
export function escapeStatusBarText(text: string): string {
  return text.replace(/\$\(/g, '\\$(');
}

/** Escapes characters that Markdown would otherwise interpret. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+!|<>~])/g, '\\$1');
}

/** Removes control characters and collapses whitespace in user input. */
export function sanitizeUserText(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    result += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  return result.replace(/\s+/g, ' ').trim();
}
