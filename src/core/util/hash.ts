/**
 * Deterministic, dependency-free hashing.
 *
 * These functions define the automatic color of every project, so their
 * output must never change. They are covered by fixed-vector unit tests.
 */

/** 32-bit FNV-1a over the UTF-8 bytes of a string. */
export function fnv1a32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** FNV-1a finished with a MurmurHash3 mix: the hash that seeds color assignment. */
export function stableHash(input: string): number {
  return fmix32(fnv1a32(input));
}

/** MurmurHash3 finalizer: spreads entropy across all bits so small moduli are unbiased. */
export function fmix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG, good enough for shuffling a short list. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic permutation of `0 .. length-1` derived from `seed` (Fisher–Yates). */
export function seededPermutation(seed: number, length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  const random = seededRandom(seed);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  return order;
}
