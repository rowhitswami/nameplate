/**
 * Perceptual color difference, measured in the OKLab color space
 * (Björn Ottosson, 2020): Euclidean distance there tracks how different two
 * colors look far better than RGB or HSL distances do.
 *
 * The thresholds were calibrated on the status bar palette: pairs below
 * {@link MIN_DISTINCT_DISTANCE} (green/olive 0.045, teal/green 0.086,
 * magenta/purple 0.092, orange/red 0.078) read as "the same color" on a thin
 * status bar seen from the corner of the eye; pairs between the two thresholds
 * (blue/indigo 0.104, orange/brown 0.109) are distinguishable side by side but
 * clearly related.
 */
import { hexToRgb } from './hex';

/** Below this distance two status bar colors are considered indistinguishable at a glance. */
export const MIN_DISTINCT_DISTANCE = 0.1;
/** Preferred minimum distance when the palette leaves a choice. */
export const PREFERRED_DISTANCE = 0.12;

export type Oklab = readonly [lightness: number, a: number, b: number];

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function toOklab(hex: string): Oklab {
  const { r, g, b } = hexToRgb(hex);
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab ΔE between two hex colors (0 = identical, 1 = black vs white). */
export function colorDistance(hexA: string, hexB: string): number {
  const a = toOklab(hexA);
  const b = toOklab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Smallest distance from `color` to any of `others`; `Infinity` when there are none. */
export function minDistance(color: string, others: readonly string[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const other of others) {
    min = Math.min(min, colorDistance(color, other));
  }
  return min;
}

export function looksSame(hexA: string, hexB: string): boolean {
  return colorDistance(hexA, hexB) < MIN_DISTINCT_DISTANCE;
}
