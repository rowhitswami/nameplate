/**
 * The curated color palette.
 *
 * Designed in OKLCH: the automatic colors are spread over hue and lightness so
 * that every pair is clearly different (OKLab distance of at least 0.14, above
 * PREFERRED_DISTANCE), which means up to eleven open windows can all look
 * different. Each color keeps a little distance from the edge of the sRGB
 * gamut, which keeps them vivid without looking harsh. Every color passes WCAG
 * AA (4.5:1) with the text color `pickForeground` selects; the unit tests
 * enforce both properties.
 *
 * IMPORTANT: the order and hex values of the entries with `auto: true` are part
 * of the automatic color assignment. Changing, removing or reordering them
 * would reshuffle the colors of existing projects. Add new automatic colors at
 * the end only; manual-only colors can change freely. (The palette was last
 * redesigned in 0.3.0, before the first Marketplace release.)
 */
import { normalizeHexColor } from './hex';

export interface PaletteColor {
  /** Stable identifier, also used for the swatch icon. */
  readonly id: string;
  /** Human readable name shown in pickers and tooltips. */
  readonly name: string;
  /** Canonical lowercase `#rrggbb`. */
  readonly hex: string;
  /** Whether the color takes part in automatic assignment. */
  readonly auto: boolean;
}

export const BUILTIN_PALETTE: readonly PaletteColor[] = [
  { id: 'blue', name: 'Blue', hex: '#216de8', auto: true },
  { id: 'indigo', name: 'Indigo', hex: '#4132b9', auto: true },
  { id: 'purple', name: 'Purple', hex: '#9051eb', auto: true },
  { id: 'magenta', name: 'Magenta', hex: '#9212a4', auto: true },
  { id: 'pink', name: 'Pink', hex: '#c63a86', auto: true },
  { id: 'orange', name: 'Orange', hex: '#c74b15', auto: true },
  { id: 'lime', name: 'Lime', hex: '#c3ea43', auto: true },
  { id: 'green', name: 'Green', hex: '#0c6427', auto: true },
  { id: 'teal', name: 'Teal', hex: '#158280', auto: true },
  { id: 'cyan', name: 'Cyan', hex: '#50dee9', auto: true },
  { id: 'ocean', name: 'Ocean', hex: '#0a557d', auto: true },
  // Red and yellow are kept out of automatic assignment because a red or
  // yellow status bar reads as an error or warning state in most themes.
  { id: 'red', name: 'Red', hex: '#d02c2a', auto: false },
  { id: 'yellow', name: 'Yellow', hex: '#f5af24', auto: false },
  { id: 'slate', name: 'Slate', hex: '#4b596c', auto: false },
];

/** Hex values used for automatic assignment, in their frozen order. */
export const AUTO_PALETTE: readonly string[] = BUILTIN_PALETTE.filter((c) => c.auto).map(
  (c) => c.hex,
);

export function findPaletteColor(hex: string | undefined): PaletteColor | undefined {
  const normalized = normalizeHexColor(hex);
  return normalized ? BUILTIN_PALETTE.find((c) => c.hex === normalized) : undefined;
}

/** "Blue (#216de8)" for palette colors, "#123456" otherwise. */
export function describeColor(hex: string): string {
  const normalized = normalizeHexColor(hex) ?? hex;
  const named = findPaletteColor(normalized);
  return named ? `${named.name} (${normalized})` : normalized;
}

/** "Blue" for palette colors, the hex value otherwise. */
export function colorDisplayName(hex: string): string {
  const normalized = normalizeHexColor(hex) ?? hex;
  return findPaletteColor(normalized)?.name ?? normalized;
}

/**
 * Builds the palette used for automatic assignment from a user supplied list of
 * hex values, falling back to the built-in automatic palette when the list is
 * empty or contains no valid color. Invalid entries are dropped, duplicates are
 * removed.
 */
export function resolveAutoPalette(userPalette: readonly unknown[] | undefined): readonly string[] {
  const colors: string[] = [];
  for (const entry of userPalette ?? []) {
    const hex = typeof entry === 'string' ? normalizeHexColor(entry) : undefined;
    if (hex && !colors.includes(hex)) {
      colors.push(hex);
    }
  }
  return colors.length > 0 ? colors : AUTO_PALETTE;
}
