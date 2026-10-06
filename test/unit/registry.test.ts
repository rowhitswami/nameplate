import assert from 'node:assert/strict';
import { candidateOrder, canonicalColor } from '../../src/core/colors/assignColor';
import { colorDistance, MIN_DISTINCT_DISTANCE } from '../../src/core/colors/distance';
import { AUTO_PALETTE } from '../../src/core/colors/palette';
import {
  classifyOthers,
  EMPTY_REGISTRY,
  hasPriority,
  isOpen,
  LAST_SEEN_REFRESH_MS,
  MAX_OPEN_AGE_MS,
  migrateLegacyRegistry,
  needsReassignment,
  planClaim,
  planRelease,
  planTouch,
  planVisibility,
  pruneRegistry,
  sanitizeRegistryData,
  type ClaimContext,
  type RegistryData,
  type RegistryEntry,
} from '../../src/core/registry/colorRegistry';

const NOW = 1_800_000_000_000;
const palette = AUTO_PALETTE;
/** Six keys whose canonical colors are identical (all pink): the worst case. */
const COLLIDING = ['demo-26', 'demo-27', 'demo-51', 'demo-63', 'demo-75', 'demo-90'].map(
  (name) => `git:github.com/acme/${name}`,
);

function context(alive: readonly number[], overrides: Partial<ClaimContext> = {}): ClaimContext {
  return {
    now: NOW,
    palette,
    isAlive: (pid) => alive.includes(pid),
    avoidCollisions: true,
    ...overrides,
  };
}

function entry(partial: Partial<RegistryEntry> & { color: string }): RegistryEntry {
  return { visible: true, claimedAt: NOW - 1000, lastSeen: NOW - 1000, pids: [], ...partial };
}

function registryOf(entries: Record<string, RegistryEntry>): RegistryData {
  return { version: 2, entries };
}

/** Claims keys one after another, as the lock serializes them; process id = index + 1. */
function claimAll(keys: readonly string[], start: RegistryData = EMPTY_REGISTRY): RegistryData {
  let registry = start;
  const alive = keys.map((_, i) => i + 1);
  keys.forEach((key, i) => {
    registry = planClaim(registry, { key, name: key, pid: i + 1 }, context(alive)).registry;
  });
  return registry;
}

function assertDistinct(registry: RegistryData, keys: readonly string[]): void {
  const colors = keys.map((key) => registry.entries[key]?.color ?? '');
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = colorDistance(colors[i] ?? '', colors[j] ?? '');
      assert.ok(
        d >= MIN_DISTINCT_DISTANCE,
        `${keys[i]} ${colors[i]} vs ${keys[j]} ${colors[j]}: ${d}`,
      );
    }
  }
}

describe('color registry: claims', () => {
  it('reproduces the reported collision as the worst case: identical canonical colors', () => {
    const canonical = new Set(COLLIDING.map((key) => canonicalColor(key, palette)));
    assert.equal(canonical.size, 1);
  });

  it('gives windows that claim one after another clearly different colors', () => {
    const registry = claimAll(COLLIDING);
    assertDistinct(registry, COLLIDING);
    // The first window keeps its canonical color.
    assert.equal(
      registry.entries[COLLIDING[0] ?? '']?.color,
      canonicalColor(COLLIDING[0] ?? '', palette),
    );
  });

  it('keeps a pinned color when no open window looks the same', () => {
    const result = planClaim(
      EMPTY_REGISTRY,
      { key: 'k', name: 'K', pid: 1, pinned: { key: 'k', color: '#7e22ce' } },
      context([1]),
    );
    assert.equal(result.reason, 'pinned');
    assert.equal(result.auto, '#7e22ce');
    assert.equal(result.changed, true);
    assert.deepEqual(result.registry.entries['k']?.pids, [1]);
  });

  it('moves a pinned color that an older open window already shows', () => {
    const registry = registryOf({
      other: entry({
        name: 'Other',
        color: '#d41f6f',
        auto: '#d41f6f',
        pids: [2],
        claimedAt: NOW - 5000,
      }),
    });
    const result = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: '#d41f6f' } },
      context([1, 2]),
    );
    assert.equal(result.reason, 'moved');
    assert.equal(result.movedFrom, '#d41f6f');
    assert.equal(result.conflictWith, 'Other');
    assert.ok(colorDistance(result.auto, '#d41f6f') >= MIN_DISTINCT_DISTANCE);
    assert.equal(result.registry.entries['me']?.claimedAt, NOW);
  });

  it('keeps its color when it has priority, also against near-duplicates', () => {
    const registry = registryOf({
      me: entry({ color: '#15803d', auto: '#15803d', pids: [1], claimedAt: NOW - 9000 }),
      other: entry({ color: '#0f766e', auto: '#0f766e', pids: [2], claimedAt: NOW - 5000 }),
    });
    const mine = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: '#15803d' } },
      context([1, 2]),
    );
    assert.equal(mine.reason, 'pinned');
    // The younger window with the near-duplicate teal moves instead.
    const theirs = planClaim(
      registry,
      { key: 'other', name: 'Other', pid: 2, pinned: { key: 'other', color: '#0f766e' } },
      context([1, 2]),
    );
    assert.equal(theirs.reason, 'moved');
  });

  it('ignores windows that are closed, uncolored or showing nothing', () => {
    const registry = registryOf({
      closed: entry({ color: '#d41f6f', pids: [7] }),
      hidden: entry({ color: '#d41f6f', pids: [2], visible: false }),
      ancient: entry({ color: '#d41f6f', pids: [2], lastSeen: NOW - MAX_OPEN_AGE_MS - 1 }),
    });
    const result = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: '#d41f6f' } },
      context([1, 2]),
    );
    assert.equal(result.reason, 'pinned');
  });

  it('treats custom and foreign (Peacock) colors as fixed: automatic windows move away from them', () => {
    const registry = registryOf({
      peacock: entry({ color: '#a21caf', external: '#dd0531', pids: [2], claimedAt: NOW }),
      custom: entry({ color: '#2563eb', custom: true, pids: [3], claimedAt: NOW }),
    });
    const nearRed = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: '#d41f6f' } },
      context([1, 2, 3]),
    );
    assert.equal(nearRed.reason, 'moved'); // pink looks like the Peacock red
    const nearBlue = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: '#2563eb' } },
      context([1, 2, 3]),
    );
    assert.equal(nearBlue.reason, 'moved');
    // A custom color itself never moves.
    const custom = planClaim(
      registry,
      { key: 'me', name: 'Me', pid: 1, customColor: '#2563eb' },
      context([1, 2, 3]),
    );
    assert.equal(custom.active, '#2563eb');
    assert.equal(custom.registry.entries['me']?.custom, true);
  });

  it('does not move when no clearly distinct color is left', () => {
    const entries: Record<string, RegistryEntry> = {};
    palette.forEach((color, i) => {
      entries[`o${i}`] = entry({ color, auto: color, pids: [10 + i], claimedAt: NOW - 100_000 });
    });
    const alive = [1, ...palette.map((_, i) => 10 + i)];
    const result = planClaim(
      registryOf(entries),
      { key: 'me', name: 'Me', pid: 1, pinned: { key: 'me', color: palette[0] ?? '' } },
      context(alive),
    );
    assert.equal(result.reason, 'pinned');
  });

  it('reuses the color a key already has on this machine, and carries a color over when the key changes', () => {
    const registry = registryOf({ 'git:x': entry({ color: '#7e22ce', auto: '#7e22ce' }) });
    const clone = planClaim(registry, { key: 'git:x', name: 'X', pid: 1 }, context([1]));
    assert.equal(clone.reason, 'known');
    assert.equal(clone.auto, '#7e22ce');
    const renamed = planClaim(
      EMPTY_REGISTRY,
      { key: 'git:new', name: 'X', pid: 1, pinned: { key: 'path:old', color: '#0f766e' } },
      context([1]),
    );
    assert.equal(renamed.reason, 'carried-over');
    assert.equal(renamed.auto, '#0f766e');
  });

  it('regenerates to the next distinct color in the key order', () => {
    const key = COLLIDING[0] ?? '';
    const order = candidateOrder(key, palette);
    const result = planClaim(
      EMPTY_REGISTRY,
      { key, name: 'K', pid: 1, pinned: { key, color: order[0] ?? '' }, regenerate: true },
      context([1]),
    );
    assert.equal(result.reason, 'regenerated');
    assert.equal(result.auto, order[1]);
  });

  it('assigns purely by hash when collision avoidance is off', () => {
    const registry = claimAll(COLLIDING.slice(0, 1));
    const result = planClaim(
      registry,
      { key: COLLIDING[1] ?? '', name: 'B', pid: 2 },
      context([1, 2], { avoidCollisions: false }),
    );
    assert.equal(result.auto, canonicalColor(COLLIDING[1] ?? '', palette));
  });

  it('does not rewrite the file when nothing changed, and throttles lastSeen', () => {
    const first = planClaim(EMPTY_REGISTRY, { key: 'k', name: 'K', pid: 1 }, context([1]));
    const again = planClaim(
      first.registry,
      { key: 'k', name: 'K', pid: 1, pinned: { key: 'k', color: first.auto } },
      context([1]),
    );
    assert.equal(again.changed, false);
    const later = planClaim(
      first.registry,
      { key: 'k', name: 'K', pid: 1, pinned: { key: 'k', color: first.auto } },
      context([1], { now: NOW + LAST_SEEN_REFRESH_MS + 1 }),
    );
    assert.equal(later.changed, true);
    assert.equal(later.registry.entries['k']?.lastSeen, NOW + LAST_SEEN_REFRESH_MS + 1);
  });

  it('drops dead process ids and records its own', () => {
    const registry = registryOf({ k: entry({ color: '#7e22ce', auto: '#7e22ce', pids: [5, 6] }) });
    const result = planClaim(registry, { key: 'k', name: 'K', pid: 1 }, context([1, 6]));
    assert.deepEqual(result.registry.entries['k']?.pids, [6, 1]);
  });
});

describe('color registry: convergence', () => {
  it('heals windows that were assigned the same color by the old race', () => {
    // Version 0.1.0 left three windows pink and two brown. Each window re-claims
    // with its pinned color, in some order; then every window re-checks until stable.
    const pinned: Record<string, string> = {
      'git:github.com/acme/storefront': '#d41f6f',
      'git:github.com/acme/billing-api': '#d41f6f',
      'path:file:///Users/me/code/notes': '#d41f6f',
      'git:github.com/acme/mobile-app': '#8a4513',
      'git:github.com/acme/admin': '#8a4513',
      'git:github.com/acme/docs': '#06b6d4',
    };
    const keys = Object.keys(pinned);
    const alive = [...keys.map((_, i) => i + 1), 99];
    // The Peacock-colored website window shows red and never moves.
    let registry = registryOf({
      'git:github.com/acme/website': entry({
        color: '#a21caf',
        external: '#dd0531',
        pids: [99],
      }),
    });
    for (let round = 0; round < 5; round++) {
      keys.forEach((key, i) => {
        const current = registry.entries[key]?.auto ?? pinned[key] ?? '';
        registry = planClaim(
          registry,
          { key, name: key, pid: i + 1, pinned: { key, color: current } },
          context(alive),
        ).registry;
      });
    }
    assertDistinct(registry, keys);
    for (const key of keys) {
      const color = registry.entries[key]?.color ?? '';
      assert.ok(
        colorDistance(color, '#dd0531') >= MIN_DISTINCT_DISTANCE,
        `${key} ${color} looks like the Peacock red`,
      );
      assert.equal(needsReassignment(registry, key, keys.indexOf(key) + 1, context(alive)), false);
    }
  });

  it('flags exactly the window that has to move', () => {
    const registry = registryOf({
      old: entry({ color: '#d41f6f', auto: '#d41f6f', pids: [1], claimedAt: NOW - 9000 }),
      young: entry({ color: '#d41f6f', auto: '#d41f6f', pids: [2], claimedAt: NOW - 1000 }),
    });
    assert.equal(needsReassignment(registry, 'old', 1, context([1, 2])), false);
    assert.equal(needsReassignment(registry, 'young', 2, context([1, 2])), true);
    assert.equal(needsReassignment(registry, 'missing', 3, context([1, 2])), false);
  });
});

describe('color registry: bookkeeping', () => {
  it('orders priority: fixed, then older claim, then key', () => {
    const auto = entry({ color: '#111111', claimedAt: 5 });
    const older = entry({ color: '#111111', claimedAt: 1 });
    const fixed = entry({ color: '#111111', claimedAt: 9, custom: true });
    assert.equal(hasPriority(['a', fixed], ['b', older]), true);
    assert.equal(hasPriority(['a', older], ['b', auto]), true);
    assert.equal(hasPriority(['a', auto], ['b', { ...auto }]), true);
    assert.equal(hasPriority(['b', auto], ['a', { ...auto }]), false);
  });

  it('classifies open and recent projects', () => {
    const registry = registryOf({
      me: entry({ color: '#111111', pids: [1] }),
      open: entry({ color: '#222222', pids: [2] }),
      recent: entry({ color: '#333333', pids: [3] }),
      old: entry({ color: '#444444', lastSeen: NOW - 40 * 24 * 60 * 60 * 1000 }),
    });
    const { open, recent } = classifyOthers(registry, 'me', NOW, (pid) => pid !== 3);
    assert.deepEqual(
      open.map(([k]) => k),
      ['open'],
    );
    assert.deepEqual(
      recent.map(([k]) => k),
      ['recent'],
    );
    assert.equal(
      isOpen(entry({ color: '#1', pids: [] }), NOW, () => true),
      false,
    );
  });

  it('records visibility and foreign colors', () => {
    const registry = registryOf({ k: entry({ color: '#2563eb' }) });
    const hidden = planVisibility(registry, 'k', { visible: false });
    assert.equal(hidden.changed, true);
    assert.equal(hidden.registry.entries['k']?.visible, false);
    const foreign = planVisibility(hidden.registry, 'k', { visible: true, external: '#DD0531' });
    assert.equal(foreign.registry.entries['k']?.external, '#dd0531');
    const back = planVisibility(foreign.registry, 'k', { visible: true });
    assert.equal(back.registry.entries['k']?.external, undefined);
    assert.equal(planVisibility(back.registry, 'k', { visible: true }).changed, false);
    assert.equal(planVisibility(registry, 'missing', { visible: false }).changed, false);
  });

  it('touches and releases process ids', () => {
    const registry = registryOf({
      k: entry({ color: '#2563eb', pids: [2], lastSeen: NOW - LAST_SEEN_REFRESH_MS - 1 }),
    });
    const touched = planTouch(registry, 'k', 1, NOW, () => true);
    assert.deepEqual(touched.registry.entries['k']?.pids, [2, 1]);
    assert.equal(touched.registry.entries['k']?.lastSeen, NOW);
    assert.equal(planTouch(touched.registry, 'k', 1, NOW + 1, () => true).changed, false);
    const released = planRelease(touched.registry, 'k', 1);
    assert.deepEqual(released.registry.entries['k']?.pids, [2]);
    assert.equal(planRelease(released.registry, 'k', 1).changed, false);
    assert.equal(planTouch(registry, 'missing', 1, NOW, () => true).changed, false);
  });

  it('prunes the oldest entries', () => {
    const entries: Record<string, RegistryEntry> = {};
    for (let i = 0; i < 10; i++) {
      entries[`k${i}`] = entry({ color: '#000000', lastSeen: i });
    }
    assert.deepEqual(Object.keys(pruneRegistry(registryOf(entries), 3).entries).sort(), [
      'k7',
      'k8',
      'k9',
    ]);
  });

  it('sanitizes the file and migrates the 0.1.0 registry', () => {
    assert.deepEqual(sanitizeRegistryData(undefined), EMPTY_REGISTRY);
    assert.deepEqual(sanitizeRegistryData({ version: 1, entries: {} }), EMPTY_REGISTRY);
    const clean = sanitizeRegistryData({
      version: 2,
      entries: {
        ok: {
          color: '#ABC',
          claimedAt: 1,
          lastSeen: 2,
          pids: [1, -3, 'x'],
          name: 'Ok',
          visible: false,
        },
        bad: { color: 'blue', claimedAt: 1, lastSeen: 2 },
        junk: 5,
      },
    });
    assert.deepEqual(clean.entries, {
      ok: { name: 'Ok', color: '#aabbcc', visible: false, claimedAt: 1, lastSeen: 2, pids: [1] },
    });
    const migrated = migrateLegacyRegistry({
      a: { color: '#d41f6f', auto: '#d41f6f', lastSeen: 7 },
      b: { color: '#123456', auto: '#d41f6f', lastSeen: 8 },
      c: { color: 3 },
    });
    assert.deepEqual(Object.keys(migrated), ['a', 'b']);
    assert.equal(migrated['a']?.claimedAt, 7);
    assert.equal(migrated['a']?.custom, undefined);
    assert.equal(migrated['b']?.custom, true);
    assert.deepEqual(migrated['a']?.pids, []);
    assert.deepEqual(migrateLegacyRegistry('nope'), {});
  });
});
