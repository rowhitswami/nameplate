/**
 * Automatic color choice.
 *
 * Every project identity key produces a deterministic preference order over the
 * palette (a hash-seeded permutation). The first candidate is the project's
 * canonical color: the same on every machine. It is used whenever it looks
 * clearly different from the colors of the other windows that are open right
 * now; otherwise the next candidate in the same order that does is used.
 */
import { seededPermutation, stableHash } from '../util/hash';
import { MIN_DISTINCT_DISTANCE, minDistance, PREFERRED_DISTANCE } from './distance';

export interface ChooseColorOptions {
  /** The project identity key. */
  readonly key: string;
  /** Palette to pick from (canonical lowercase hex values). */
  readonly palette: readonly string[];
  /** Colors shown by other open windows. The result must look different from these. */
  readonly open?: readonly string[];
  /** Colors of other recently used projects. Avoided when there is a choice. */
  readonly recent?: readonly string[];
  /** Colors that must not be returned, e.g. the current color when regenerating. */
  readonly exclude?: readonly string[];
  /** When regenerating: start after this color in the preference order. */
  readonly after?: string;
}

/** The deterministic preference order of palette colors for a key. */
export function candidateOrder(key: string, palette: readonly string[]): string[] {
  const order = seededPermutation(stableHash(key), palette.length);
  const result: string[] = [];
  for (const index of order) {
    const color = palette[index];
    if (color !== undefined) {
      result.push(color);
    }
  }
  return result;
}

/** The canonical color of a key: the first candidate, ignoring every other project. */
export function canonicalColor(key: string, palette: readonly string[]): string | undefined {
  return candidateOrder(key, palette)[0];
}

/**
 * Chooses a color for a key. Candidates are visited in the key's preference
 * order (optionally starting after `after`, wrapping around, without
 * `exclude`); the first candidate of the best tier wins:
 *
 * 1. comfortably distinct from every open window and unused by recent projects;
 * 2. comfortably distinct from every open window;
 * 3. distinct from every open window and unused by recent projects;
 * 4. distinct from every open window;
 * 5. otherwise (more open windows than distinct colors): the candidate that is
 *    the most different from all open windows.
 */
export function chooseAutoColor(options: ChooseColorOptions): string | undefined {
  const { key, palette, open = [], recent = [], exclude = [], after } = options;
  let order = candidateOrder(key, palette);
  if (after !== undefined) {
    const start = order.indexOf(after);
    if (start >= 0) {
      order = [...order.slice(start + 1), ...order.slice(0, start + 1)];
    }
  }
  const candidates = order.filter((color) => !exclude.includes(color));
  if (candidates.length === 0) {
    return undefined;
  }
  const distanceToOpen = new Map(candidates.map((color) => [color, minDistance(color, open)]));
  const separation = (color: string): number => distanceToOpen.get(color) ?? 0;
  const unusedRecently = (color: string): boolean => !recent.includes(color);
  const tiers: ((color: string) => boolean)[] = [
    (color) => separation(color) >= PREFERRED_DISTANCE && unusedRecently(color),
    (color) => separation(color) >= PREFERRED_DISTANCE,
    (color) => separation(color) >= MIN_DISTINCT_DISTANCE && unusedRecently(color),
    (color) => separation(color) >= MIN_DISTINCT_DISTANCE,
  ];
  for (const tier of tiers) {
    const hit = candidates.find(tier);
    if (hit !== undefined) {
      return hit;
    }
  }
  let best = candidates[0];
  for (const color of candidates) {
    if (best === undefined || separation(color) > separation(best)) {
      best = color;
    }
  }
  return best;
}
