import assert from 'node:assert/strict';
import { hexToRgb, isHexColor, normalizeHexColor, rgbToHex } from '../../src/core/colors/hex';
import {
  contrastRatio,
  DARK_FOREGROUND,
  formatContrast,
  LIGHT_FOREGROUND,
  MIN_CONTRAST_AA,
  pickForeground,
  relativeLuminance,
} from '../../src/core/colors/contrast';
import {
  AUTO_PALETTE,
  BUILTIN_PALETTE,
  colorDisplayName,
  describeColor,
  findPaletteColor,
  resolveAutoPalette,
} from '../../src/core/colors/palette';
import {
  buildStatusBarTheme,
  STATUS_BAR_BACKGROUND,
  STATUS_BAR_DEBUGGING_BACKGROUND,
  STATUS_BAR_FOREGROUND,
  STATUS_BAR_INACTIVE_BACKGROUND,
} from '../../src/core/colors/statusBarTheme';

describe('hex colors', () => {
  it('normalizes valid input to lowercase #rrggbb', () => {
    assert.equal(normalizeHexColor('#2563EB'), '#2563eb');
    assert.equal(normalizeHexColor('2563eb'), '#2563eb');
    assert.equal(normalizeHexColor('  #ABC  '), '#aabbcc');
    assert.equal(normalizeHexColor('abc'), '#aabbcc');
  });

  it('rejects invalid input', () => {
    for (const bad of [
      '',
      '#',
      '#12',
      '#1234',
      '#12345',
      '#1234567',
      '#ggg',
      'red',
      '#2563eb80',
      null,
      undefined,
    ]) {
      assert.equal(normalizeHexColor(bad), undefined, `expected ${String(bad)} to be rejected`);
      assert.equal(isHexColor(bad), false);
    }
  });

  it('round-trips rgb', () => {
    assert.deepEqual(hexToRgb('#2563eb'), { r: 37, g: 99, b: 235 });
    assert.equal(rgbToHex({ r: 37, g: 99, b: 235 }), '#2563eb');
    assert.equal(rgbToHex({ r: 300, g: -5, b: 0.4 }), '#ff0000');
    assert.throws(() => hexToRgb('nope'), TypeError);
  });
});

describe('contrast', () => {
  it('computes WCAG reference values', () => {
    assert.equal(relativeLuminance('#ffffff'), 1);
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#2563eb', '#ffffff').toFixed(2), '5.17');
    assert.equal(contrastRatio('#ca8a04', '#000000').toFixed(2), '7.15');
  });

  it('prefers light text when it is accessible, otherwise the better of the two', () => {
    assert.equal(pickForeground('#2563eb').foreground, LIGHT_FOREGROUND);
    assert.equal(pickForeground('#06b6d4').foreground, DARK_FOREGROUND);
    assert.equal(pickForeground('#ffffff').foreground, DARK_FOREGROUND);
    assert.equal(pickForeground('#000000').foreground, LIGHT_FOREGROUND);
  });

  it('always reaches AA for any opaque background', () => {
    // Sample the color cube; the worst case is a mid-luminance grey (~4.58:1).
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = rgbToHex({ r, g, b });
          const choice = pickForeground(hex);
          assert.ok(choice.contrast >= MIN_CONTRAST_AA, `${hex} only reaches ${choice.contrast}`);
        }
      }
    }
  });

  it('formats ratios', () => {
    assert.equal(formatContrast(5.1689), '5.17:1');
  });
});

describe('palette', () => {
  it('passes AA for every entry with its computed foreground', () => {
    for (const color of BUILTIN_PALETTE) {
      const choice = pickForeground(color.hex);
      assert.ok(
        choice.contrast >= MIN_CONTRAST_AA,
        `${color.name} ${color.hex} reaches only ${formatContrast(choice.contrast)}`,
      );
    }
  });

  it('has unique ids, names and hex values', () => {
    const ids = new Set(BUILTIN_PALETTE.map((c) => c.id));
    const names = new Set(BUILTIN_PALETTE.map((c) => c.name));
    const hexes = new Set(BUILTIN_PALETTE.map((c) => c.hex));
    assert.equal(ids.size, BUILTIN_PALETTE.length);
    assert.equal(names.size, BUILTIN_PALETTE.length);
    assert.equal(hexes.size, BUILTIN_PALETTE.length);
  });

  it('freezes the automatic palette (changing it would recolor existing projects)', () => {
    assert.deepEqual(AUTO_PALETTE, [
      '#2563eb',
      '#06b6d4',
      '#0f766e',
      '#15803d',
      '#65a30d',
      '#c2410c',
      '#8a4513',
      '#d41f6f',
      '#a21caf',
      '#7e22ce',
      '#4338ca',
    ]);
  });

  it('keeps warning/error-like colors out of automatic assignment', () => {
    assert.equal(findPaletteColor('#c81e1e')?.auto, false);
    assert.equal(findPaletteColor('#ca8a04')?.auto, false);
  });

  it('describes colors', () => {
    assert.equal(describeColor('#2563EB'), 'Blue (#2563eb)');
    assert.equal(describeColor('#123456'), '#123456');
    assert.equal(colorDisplayName('#2563eb'), 'Blue');
    assert.equal(colorDisplayName('#123456'), '#123456');
    assert.equal(findPaletteColor('nope'), undefined);
  });

  it('resolves a user palette, dropping junk and duplicates', () => {
    assert.deepEqual(resolveAutoPalette(['#ABC', 'nope', '#aabbcc', 42, '123456']), [
      '#aabbcc',
      '#123456',
    ]);
    assert.deepEqual(resolveAutoPalette([]), AUTO_PALETTE);
    assert.deepEqual(resolveAutoPalette(undefined), AUTO_PALETTE);
    assert.deepEqual(resolveAutoPalette(['nope']), AUTO_PALETTE);
  });
});

describe('status bar theme', () => {
  it('writes background and computed foreground', () => {
    const theme = buildStatusBarTheme('#2563EB', {
      supportsInactiveBackground: false,
      colorWhileDebugging: false,
    });
    assert.equal(theme.background, '#2563eb');
    assert.equal(theme.foreground, '#ffffff');
    assert.deepEqual(Object.keys(theme.colors), [STATUS_BAR_BACKGROUND, STATUS_BAR_FOREGROUND]);
  });

  it('adds the inactive and debugging keys on request', () => {
    const theme = buildStatusBarTheme('#06b6d4', {
      supportsInactiveBackground: true,
      colorWhileDebugging: true,
    });
    assert.equal(theme.colors[STATUS_BAR_INACTIVE_BACKGROUND], '#06b6d4');
    assert.equal(theme.colors[STATUS_BAR_DEBUGGING_BACKGROUND], '#06b6d4');
    assert.equal(theme.colors['statusBar.debuggingForeground'], '#000000');
  });

  it('rejects invalid colors', () => {
    assert.throws(
      () =>
        buildStatusBarTheme('blue', {
          supportsInactiveBackground: true,
          colorWhileDebugging: false,
        }),
      TypeError,
    );
  });
});
