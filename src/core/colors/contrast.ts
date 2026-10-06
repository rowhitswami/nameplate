/**
 * WCAG 2.x relative luminance and contrast ratio.
 *
 * The status bar text color is always chosen from pure white and pure black.
 * For any opaque background at least one of the two reaches a contrast ratio
 * of about 4.58:1, which means the WCAG AA threshold for normal text (4.5:1)
 * is guaranteed regardless of the color a user picks.
 */
import { hexToRgb } from './hex';

export const LIGHT_FOREGROUND = '#ffffff';
export const DARK_FOREGROUND = '#000000';

/** WCAG AA minimum contrast for normal-size text. */
export const MIN_CONTRAST_AA = 4.5;

export type ForegroundKind = 'light' | 'dark';

export interface ForegroundChoice {
  readonly foreground: string;
  readonly kind: ForegroundKind;
  /** Contrast ratio between the chosen foreground and the background. */
  readonly contrast: number;
}

function linearChannel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(colorA: string, colorB: string): number {
  const a = relativeLuminance(colorA);
  const b = relativeLuminance(colorB);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks the status bar text color for a background. Light text is preferred
 * whenever it is accessible, because that is how VS Code themes render the
 * status bar; otherwise whichever of white/black contrasts more is used.
 */
export function pickForeground(background: string): ForegroundChoice {
  const light = contrastRatio(background, LIGHT_FOREGROUND);
  if (light >= MIN_CONTRAST_AA) {
    return { foreground: LIGHT_FOREGROUND, kind: 'light', contrast: light };
  }
  const dark = contrastRatio(background, DARK_FOREGROUND);
  return dark >= light
    ? { foreground: DARK_FOREGROUND, kind: 'dark', contrast: dark }
    : { foreground: LIGHT_FOREGROUND, kind: 'light', contrast: light };
}

export function formatContrast(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
