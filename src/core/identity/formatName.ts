/**
 * Turns a raw project name into what is shown in the status bar.
 */

export type TextTransform = 'auto' | 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export const TEXT_TRANSFORMS: readonly TextTransform[] = [
  'auto',
  'none',
  'uppercase',
  'lowercase',
  'capitalize',
];

/** Maximum length of the name in the status bar before it is truncated. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** `brightdesk-mobile` → `brightdesk mobile`, `trail_mix` → `trail mix`. Dots are kept (`three.js`). */
export function splitWords(raw: string): string {
  return raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a name contains both upper- and lowercase letters (BrightDesk, iOS, TrailMix). */
export function hasDistinctiveCasing(name: string): boolean {
  return /\p{Lu}/u.test(name) && /\p{Ll}/u.test(name);
}

/** Case- and separator-insensitive form used to match names from different sources. */
export function canonicalName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface FormatOptions {
  /** The name was typed by the user: shown as typed unless an explicit transform is set. */
  readonly custom: boolean;
}

export function formatDisplayName(
  raw: string,
  transform: TextTransform,
  options: FormatOptions,
): string {
  const trimmed = raw.trim();
  switch (transform) {
    case 'none':
      return trimmed;
    case 'auto': {
      if (options.custom) {
        return trimmed;
      }
      const words = splitWords(trimmed);
      return hasDistinctiveCasing(words) ? words : words.toUpperCase();
    }
    case 'uppercase':
      return splitWords(trimmed).toUpperCase();
    case 'lowercase':
      return splitWords(trimmed).toLowerCase();
    case 'capitalize':
      return splitWords(trimmed)
        .split(' ')
        .map((word) => (word.length > 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
        .join(' ');
  }
}

export function truncateName(name: string, maxLength = MAX_DISPLAY_NAME_LENGTH): string {
  const chars = Array.from(name);
  if (chars.length <= maxLength) {
    return name;
  }
  return `${chars
    .slice(0, Math.max(1, maxLength - 1))
    .join('')
    .trimEnd()}…`;
}
