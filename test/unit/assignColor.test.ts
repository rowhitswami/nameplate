import assert from 'node:assert/strict';
import { candidateOrder, canonicalColor, chooseAutoColor } from '../../src/core/colors/assignColor';
import {
  colorDistance,
  MIN_DISTINCT_DISTANCE,
  PREFERRED_DISTANCE,
} from '../../src/core/colors/distance';
import { AUTO_PALETTE } from '../../src/core/colors/palette';
import { fmix32, fnv1a32, seededPermutation, stableHash } from '../../src/core/util/hash';

describe('hash', () => {
  it('matches the FNV-1a reference vectors', () => {
    assert.equal(fnv1a32(''), 0x811c9dc5);
    assert.equal(fnv1a32('a'), 0xe40c292c);
    assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  });

  it('is deterministic and spreads bits', () => {
    assert.equal(stableHash('git:github.com/owner/repo'), stableHash('git:github.com/owner/repo'));
    assert.notEqual(stableHash('a'), stableHash('b'));
    assert.equal(fmix32(0), 0);
    assert.equal(fmix32(1), 0x514e28b7);
  });

  it('produces a full permutation for any seed', () => {
    for (const seed of [0, 1, 42, 0xffffffff, stableHash('x')]) {
      const order = seededPermutation(seed, 11);
      assert.deepEqual(
        [...order].sort((a, b) => a - b),
        Array.from({ length: 11 }, (_, i) => i),
      );
    }
    assert.deepEqual(seededPermutation(7, 0), []);
    assert.deepEqual(seededPermutation(7, 1), [0]);
  });
});

describe('automatic color choice', () => {
  const palette = AUTO_PALETTE;
  const key = 'git:github.com/a/b';
  const order = candidateOrder(key, palette);

  it('is deterministic and visits every palette color once', () => {
    assert.deepEqual(candidateOrder(key, palette), order);
    assert.deepEqual([...order].sort(), [...palette].sort());
  });

  it('pins known keys to known colors (regression anchor for the hashing scheme)', () => {
    // If this test fails, the automatic color of every existing project changed.
    assert.equal(canonicalColor('git:github.com/acme/brightdesk', palette), '#8a4513');
    assert.equal(canonicalColor('git:github.com/acme/trailmix', palette), '#15803d');
    assert.equal(canonicalColor('path:file:///Users/me/code/demo', palette), '#2563eb');
  });

  it('spreads different keys over the whole palette', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 200; i++) {
      colors.add(canonicalColor(`key-${i}`, palette) ?? '');
    }
    assert.equal(colors.size, palette.length);
  });

  it('uses the canonical color when nothing else is open', () => {
    assert.equal(chooseAutoColor({ key, palette }), order[0]);
    assert.equal(chooseAutoColor({ key, palette, open: [], recent: [] }), order[0]);
  });

  it('never returns a color that looks like an open window when a distinct one exists', () => {
    const open = [order[0] ?? ''];
    const chosen = chooseAutoColor({ key, palette, open }) ?? '';
    assert.notEqual(chosen, order[0]);
    assert.ok(colorDistance(chosen, open[0] ?? '') >= PREFERRED_DISTANCE);
    // It is the first such candidate in the key's own order (stable across machines).
    const expected = order.find((c) => colorDistance(c, open[0] ?? '') >= PREFERRED_DISTANCE);
    assert.equal(chosen, expected);
  });

  it('skips near-duplicates, not only identical colors', () => {
    // Green is open: teal (ΔE 0.086) and lime (0.136 but recent) must not win over a clearly different color.
    const chosen = chooseAutoColor({ key: 'k-green', palette, open: ['#15803d'] }) ?? '';
    assert.ok(colorDistance(chosen, '#15803d') >= PREFERRED_DISTANCE, chosen);
  });

  it('prefers colors that recently used projects do not have, softly', () => {
    const recent = [order[0] ?? ''];
    assert.equal(chooseAutoColor({ key, palette, recent }), order[1]);
    // Recent colors are still used when everything else is taken by open windows.
    const open = palette.filter((c) => c !== order[0]);
    assert.equal(chooseAutoColor({ key, palette, open, recent }), order[0]);
  });

  it('accepts the minimum separation before giving up', () => {
    // Make every candidate fail the preferred distance but keep one above the minimum.
    const target = '#2563eb'; // blue: indigo is 0.104 away
    const open = palette.filter(
      (c) => c !== '#4338ca' && colorDistance(c, '#4338ca') >= PREFERRED_DISTANCE,
    );
    open.push(target);
    const chosen = chooseAutoColor({ key, palette, open }) ?? '';
    for (const color of open) {
      assert.ok(colorDistance(chosen, color) >= MIN_DISTINCT_DISTANCE, `${chosen} vs ${color}`);
    }
  });

  it('falls back to the most distinct color when the palette is exhausted', () => {
    const chosen = chooseAutoColor({ key, palette, open: palette });
    assert.ok(chosen !== undefined && palette.includes(chosen));
  });

  it('supports regenerating: continue after the current color, skipping exclusions', () => {
    assert.equal(
      chooseAutoColor({ key, palette, after: order[0], exclude: [order[0] ?? ''] }),
      order[1],
    );
    const last = order[order.length - 1] ?? '';
    assert.equal(chooseAutoColor({ key, palette, after: last, exclude: [last] }), order[0]);
    assert.equal(chooseAutoColor({ key, palette, after: '#not-in-palette' }), order[0]);
  });

  it('handles degenerate palettes', () => {
    assert.equal(chooseAutoColor({ key: 'k', palette: [] }), undefined);
    assert.equal(
      chooseAutoColor({ key: 'k', palette: ['#111111'], exclude: ['#111111'] }),
      undefined,
    );
    assert.equal(chooseAutoColor({ key: 'k', palette: ['#111111'], open: ['#111111'] }), '#111111');
  });
});
