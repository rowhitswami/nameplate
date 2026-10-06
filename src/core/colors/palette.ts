/**
 * The curated color palette.
 *
 * Every color was checked against WCAG AA (>= 4.5:1) with the text color that
 * `pickForeground` selects for it; the unit tests enforce this. Colors are
 * medium-deep and saturated so they read as "a color" on both light and dark
 * themes without glowing.
 *
 * IMPORTANT: the order and hex values of the entries with `auto: true` are part
 * of the automatic color assignment. Changing, removing or reordering them
 * would reshuffle the colors of existing projects. Add new automatic colors at
 * the end only; manual-only colors can change freely.
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
  { id: 'blue', name: 'Blue', hex: '#2563eb', auto: true },
  { id: 'sky', name: 'Sky', hex: '#0369a1', auto: false },
  { id: 'cyan', name: 'Cyan', hex: '#06b6d4', auto: true },
  { id: 'teal', name: 'Teal', hex: '#0f766e', auto: true },
  { id: 'green', name: 'Green', hex: '#15803d', auto: true },
  // Lime replaced olive in 0.1.1: olive was nearly indistinguishable from green (OKLab ΔE 0.045).
  { id: 'lime', name: 'Lime', hex: '#65a30d', auto: true },
  // Yellow and red are kept out of automatic assignment because a yellow or
  // red status bar reads as a warning or error state in most themes.
  { id: 'yellow', name: 'Yellow', hex: '#ca8a04', auto: false },
  { id: 'orange', name: 'Orange', hex: '#c2410c', auto: true },
  { id: 'brown', name: 'Brown', hex: '#8a4513', auto: true },
  { id: 'red', name: 'Red', hex: '#c81e1e', auto: false },
  { id: 'pink', name: 'Pink', hex: '#d41f6f', auto: true },
  { id: 'magenta', name: 'Magenta', hex: '#a21caf', auto: true },
  { id: 'purple', name: 'Purple', hex: '#7e22ce', auto: true },
  { id: 'indigo', name: 'Indigo', hex: '#4338ca', auto: true },
  { id: 'slate', name: 'Slate', hex: '#475569', auto: false },
];

/** Hex values used for automatic assignment, in their frozen order. */
export const AUTO_PALETTE: readonly string[] = BUILTIN_PALETTE.filter((c) => c.auto).map(
  (c) => c.hex,
);

export function findPaletteColor(hex: string | undefined): PaletteColor | undefined {
  const normalized = normalizeHexColor(hex);
  return normalized ? BUILTIN_PALETTE.find((c) => c.hex === normalized) : undefined;
}

/** "Blue (#2563eb)" for palette colors, "#123456" otherwise. */
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
