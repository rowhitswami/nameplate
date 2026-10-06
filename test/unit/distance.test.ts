import assert from 'node:assert/strict';
import {
  colorDistance,
  looksSame,
  MIN_DISTINCT_DISTANCE,
  minDistance,
  PREFERRED_DISTANCE,
  toOklab,
} from '../../src/core/colors/distance';
import { AUTO_PALETTE } from '../../src/core/colors/palette';

const close = (actual: number, expected: number, epsilon = 0.002): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not ≈ ${expected}`);

describe('OKLab distance', () => {
  it('matches reference values', () => {
    const [l, a, b] = toOklab('#ffffff');
    close(l, 1);
    close(a, 0);
    close(b, 0);
    close(toOklab('#000000')[0], 0);
    close(colorDistance('#000000', '#ffffff'), 1);
    assert.equal(colorDistance('#2563eb', '#2563eb'), 0);
    assert.equal(colorDistance('#2563eb', '#4338ca'), colorDistance('#4338ca', '#2563eb'));
  });

  it('calls the near-duplicates of the old palette the same color', () => {
    close(colorDistance('#15803d', '#4d7c0f'), 0.045); // green vs olive (replaced by lime)
    assert.equal(looksSame('#15803d', '#4d7c0f'), true);
    assert.equal(looksSame('#d41f6f', '#dd0531'), true); // pink vs a Peacock red
    assert.equal(looksSame('#2563eb', '#06b6d4'), false); // blue vs cyan
  });

  it('keeps every pair of automatic colors comfortably apart', () => {
    for (let i = 0; i < AUTO_PALETTE.length; i++) {
      for (let j = i + 1; j < AUTO_PALETTE.length; j++) {
        const a = AUTO_PALETTE[i] ?? '';
        const b = AUTO_PALETTE[j] ?? '';
        assert.ok(
          colorDistance(a, b) >= PREFERRED_DISTANCE,
          `${a} vs ${b}: ${colorDistance(a, b)}`,
        );
      }
    }
  });

  it('can tell eleven open windows apart', () => {
    const chosen: string[] = [];
    for (const color of AUTO_PALETTE) {
      if (minDistance(color, chosen) >= MIN_DISTINCT_DISTANCE) {
        chosen.push(color);
      }
    }
    assert.equal(chosen.length, 11, chosen.join(' '));
  });

  it('computes the minimum distance to a set', () => {
    assert.equal(minDistance('#2563eb', []), Number.POSITIVE_INFINITY);
    close(minDistance('#2563eb', ['#ffffff', '#2563eb']), 0);
  });
});
