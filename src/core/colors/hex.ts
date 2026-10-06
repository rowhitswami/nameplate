/**
 * Hex color parsing and normalization.
 *
 * Nameplate only works with opaque `#rrggbb` colors: alpha would make the
 * contrast of the status bar text unpredictable.
 */

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Accepts `#rgb`, `#rrggbb`, with or without the leading `#`, in any casing and
 * with surrounding whitespace. Returns the canonical lowercase `#rrggbb` form,
 * or `undefined` when the input is not a valid opaque hex color.
 */
export function normalizeHexColor(input: string | undefined | null): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const match = HEX_COLOR_PATTERN.exec(input.trim());
  if (!match) {
    return undefined;
  }
  let digits = (match[1] ?? '').toLowerCase();
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${digits}`;
}

export function isHexColor(input: string | undefined | null): boolean {
  return normalizeHexColor(input) !== undefined;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    throw new TypeError(`Invalid hex color: ${hex}`);
  }
  const value = Number.parseInt(normalized.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
  const toHex = (n: number): string => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
