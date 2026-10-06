/**
 * The color registry: which project uses which color on this machine, and
 * which of them are open right now. Every window reads and writes it (under a
 * lock, see `src/registry/registryFile.ts`) so that windows open at the same
 * time never show the same-looking color.
 *
 * Rules:
 *
 * - A window is *open* when one of the extension host processes that claimed
 *   the entry is still alive and its status bar actually shows the color.
 * - A new automatic color must look clearly different from every open window
 *   (see {@link chooseAutoColor}).
 * - When two open windows look the same anyway (they were assigned before this
 *   registry existed, a machine woke from sleep, a user picked a custom color),
 *   the one with lower priority moves to a free color. Priority: colors chosen
 *   by the user or set by someone else (fixed) beat automatic ones; among
 *   equals, the older claim wins. A window only moves when a clearly distinct
 *   color is available, so the process always converges.
 *
 * All functions are pure.
 */
import { chooseAutoColor } from '../colors/assignColor';
import { looksSame, MIN_DISTINCT_DISTANCE, minDistance } from '../colors/distance';
import { normalizeHexColor } from '../colors/hex';

export interface RegistryEntry {
  /** Display name, used in messages such as "Blue is used by BrightDesk". */
  readonly name?: string;
  /** The color the project shows: its custom color, else its automatic color. */
  readonly color: string;
  /** The automatic color pinned to the project. */
  readonly auto?: string;
  /** `color` was chosen by the user. */
  readonly custom?: boolean;
  /** A status bar color set by someone else (Peacock, the user), shown instead of `color`. */
  readonly external?: string;
  /** Whether the status bar currently shows the color. */
  readonly visible: boolean;
  /** When the project started using `color` (epoch ms). */
  readonly claimedAt: number;
  /** Last time a window of the project was active (epoch ms). */
  readonly lastSeen: number;
  /** Extension host process ids of the windows that show the project. */
  readonly pids?: readonly number[];
}

export interface RegistryData {
  readonly version: 2;
  readonly entries: Readonly<Record<string, RegistryEntry>>;
}

export const EMPTY_REGISTRY: RegistryData = { version: 2, entries: {} };

/** Projects used within this window count as "recent" for soft color avoidance. */
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Guards against process id reuse: an entry not seen for this long is never considered open. */
export const MAX_OPEN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** `lastSeen` is refreshed at most this often, to avoid needless writes. */
export const LAST_SEEN_REFRESH_MS = 10 * 60 * 1000;
export const MAX_REGISTRY_ENTRIES = 200;
const FALLBACK_COLOR = '#2563eb';

export type IsAlive = (pid: number) => boolean;
type Keyed = readonly [key: string, entry: RegistryEntry];

/** The color the status bar of the project actually shows. */
export function effectiveColor(entry: RegistryEntry): string {
  return entry.external ?? entry.color;
}

/** Fixed colors (custom or set by someone else) are never moved automatically. */
export function isFixed(entry: RegistryEntry): boolean {
  return entry.custom === true || entry.external !== undefined;
}

/** Whether `a` keeps a color that it shares with `b`. */
export function hasPriority([keyA, a]: Keyed, [keyB, b]: Keyed): boolean {
  const fixedA = isFixed(a);
  if (fixedA !== isFixed(b)) {
    return fixedA;
  }
  if (a.claimedAt !== b.claimedAt) {
    return a.claimedAt < b.claimedAt;
  }
  return keyA < keyB;
}

export function isOpen(entry: RegistryEntry, now: number, isAlive: IsAlive): boolean {
  return (
    entry.visible &&
    now - entry.lastSeen < MAX_OPEN_AGE_MS &&
    (entry.pids ?? []).some((pid) => isAlive(pid))
  );
}

/** Splits the other projects into open windows and recently used projects. */
export function classifyOthers(
  registry: RegistryData,
  selfKey: string,
  now: number,
  isAlive: IsAlive,
): { open: Keyed[]; recent: Keyed[] } {
  const open: Keyed[] = [];
  const recent: Keyed[] = [];
  for (const [key, entry] of Object.entries(registry.entries)) {
    if (key === selfKey) {
      continue;
    }
    if (isOpen(entry, now, isAlive)) {
      open.push([key, entry]);
    } else if (now - entry.lastSeen < RECENT_WINDOW_MS) {
      recent.push([key, entry]);
    }
  }
  return { open, recent };
}

export interface ClaimRequest {
  readonly key: string;
  readonly name: string;
  /** Extension host process id of the claiming window. */
  readonly pid: number;
  /** Automatic color pinned to this workspace (the caller checked the color source). */
  readonly pinned?: { readonly key: string; readonly color: string };
  /** The workspace's custom color, if any. */
  readonly customColor?: string;
  /** Pick the next automatic color. */
  readonly regenerate?: boolean;
}

export interface ClaimContext {
  readonly now: number;
  readonly palette: readonly string[];
  readonly isAlive: IsAlive;
  readonly avoidCollisions: boolean;
}

export type ClaimReason =
  /** The color pinned to this workspace. */
  | 'pinned'
  /** The key already had a color on this machine (e.g. another clone of the repository). */
  | 'known'
  /** The identity key changed; the workspace keeps its color. */
  | 'carried-over'
  /** First assignment. */
  | 'assigned'
  /** The user asked for another color. */
  | 'regenerated'
  /** Moved away from a color that another open window has priority on. */
  | 'moved';

export interface ClaimResult {
  readonly registry: RegistryData;
  readonly changed: boolean;
  readonly auto: string;
  readonly active: string;
  readonly reason: ClaimReason;
  readonly movedFrom?: string;
  /** Name (or key) of the open window whose color this one moved away from. */
  readonly conflictWith?: string;
  /** Colors of the other open windows, for diagnostics. */
  readonly openColors: readonly string[];
}

export function planClaim(
  registry: RegistryData,
  request: ClaimRequest,
  context: ClaimContext,
): ClaimResult {
  const { key, name, pid, pinned, customColor, regenerate } = request;
  const { now, palette, isAlive, avoidCollisions } = context;
  const self = registry.entries[key];
  const { open, recent } = avoidCollisions
    ? classifyOthers(registry, key, now, isAlive)
    : { open: [], recent: [] };
  const openColors = open.map(([, entry]) => effectiveColor(entry));
  const recentColors = recent.map(([, entry]) => effectiveColor(entry));
  const inPalette = (color: string | undefined): color is string =>
    color !== undefined && palette.includes(color);

  let auto: string | undefined;
  let reason: ClaimReason = 'assigned';
  if (pinned && pinned.key === key && inPalette(pinned.color)) {
    auto = pinned.color;
    reason = 'pinned';
  } else if (inPalette(self?.auto)) {
    auto = self.auto;
    reason = 'known';
  } else if (pinned && inPalette(pinned.color)) {
    auto = pinned.color;
    reason = 'carried-over';
  }

  let movedFrom: string | undefined;
  let conflictWith: string | undefined;
  if (regenerate || auto === undefined) {
    const current = auto;
    auto =
      chooseAutoColor({
        key,
        palette,
        open: openColors,
        recent: recentColors,
        after: regenerate ? current : undefined,
        exclude: regenerate && current ? [current] : [],
      }) ??
      current ??
      palette[0] ??
      FALLBACK_COLOR;
    reason = regenerate ? 'regenerated' : 'assigned';
  } else if (customColor === undefined && self?.external === undefined && avoidCollisions) {
    const me: Keyed = [
      key,
      {
        color: auto,
        visible: true,
        claimedAt: self && self.color === auto && !self.custom ? self.claimedAt : now,
        lastSeen: now,
      },
    ];
    const current = auto;
    const rival = open.find(
      ([otherKey, other]) =>
        looksSame(effectiveColor(other), current) && hasPriority([otherKey, other], me),
    );
    if (rival) {
      const candidate = chooseAutoColor({ key, palette, open: openColors, recent: recentColors });
      if (
        candidate !== undefined &&
        candidate !== current &&
        minDistance(candidate, openColors) >= MIN_DISTINCT_DISTANCE
      ) {
        movedFrom = current;
        auto = candidate;
        reason = 'moved';
        conflictWith = rival[1].name ?? rival[0];
      }
    }
  }

  const active = customColor ?? auto;
  const pids = [...new Set([...(self?.pids ?? []).filter((p) => isAlive(p)), pid])];
  const entry: RegistryEntry = {
    name,
    color: active,
    auto,
    ...(customColor !== undefined ? { custom: true } : {}),
    ...(self?.external !== undefined ? { external: self.external } : {}),
    visible: self?.visible ?? true,
    claimedAt: self && self.color === active ? self.claimedAt : now,
    lastSeen: self && now - self.lastSeen < LAST_SEEN_REFRESH_MS ? self.lastSeen : now,
    pids,
  };
  const changed = !sameEntry(self, entry);
  return {
    registry: changed ? withEntry(registry, key, entry) : registry,
    changed,
    auto,
    active,
    reason,
    movedFrom,
    conflictWith,
    openColors,
  };
}

/**
 * Dry run: would claiming the key right now move its automatic color because
 * another open window has priority on a same-looking color?
 */
export function needsReassignment(
  registry: RegistryData,
  key: string,
  pid: number,
  context: ClaimContext,
): boolean {
  const self = registry.entries[key];
  if (!self?.auto || isFixed(self) || !context.avoidCollisions) {
    return false;
  }
  return (
    planClaim(
      registry,
      { key, name: self.name ?? key, pid, pinned: { key, color: self.auto } },
      context,
    ).reason === 'moved'
  );
}

export interface Visibility {
  readonly visible: boolean;
  /** Status bar color set by someone else, when that is what the window shows. */
  readonly external?: string;
}

/** Records whether (and in which color) the project's status bar is actually colored. */
export function planVisibility(
  registry: RegistryData,
  key: string,
  visibility: Visibility,
): { registry: RegistryData; changed: boolean } {
  const self = registry.entries[key];
  if (!self) {
    return { registry, changed: false };
  }
  const external = normalizeHexColor(visibility.external);
  const visible = visibility.visible || external !== undefined;
  if (self.visible === visible && self.external === external) {
    return { registry, changed: false };
  }
  const { external: _previous, ...rest } = self;
  const entry: RegistryEntry = { ...rest, visible, ...(external ? { external } : {}) };
  return { registry: withEntry(registry, key, entry), changed: true };
}

/** Refreshes `lastSeen` (throttled) and registers the process as showing the project. */
export function planTouch(
  registry: RegistryData,
  key: string,
  pid: number,
  now: number,
  isAlive: IsAlive,
): { registry: RegistryData; changed: boolean } {
  const self = registry.entries[key];
  if (!self) {
    return { registry, changed: false };
  }
  const pids = [...new Set([...(self.pids ?? []).filter((p) => isAlive(p)), pid])];
  const lastSeen = now - self.lastSeen < LAST_SEEN_REFRESH_MS ? self.lastSeen : now;
  const entry: RegistryEntry = { ...self, pids, lastSeen };
  return sameEntry(self, entry)
    ? { registry, changed: false }
    : { registry: withEntry(registry, key, entry), changed: true };
}

/** Removes the process from the entry, e.g. when the window stops showing the project. */
export function planRelease(
  registry: RegistryData,
  key: string,
  pid: number,
): { registry: RegistryData; changed: boolean } {
  const self = registry.entries[key];
  if (!self?.pids?.includes(pid)) {
    return { registry, changed: false };
  }
  const entry: RegistryEntry = { ...self, pids: self.pids.filter((p) => p !== pid) };
  return { registry: withEntry(registry, key, entry), changed: true };
}

/** Keeps the most recently seen entries only. */
export function pruneRegistry(
  registry: RegistryData,
  maxEntries: number = MAX_REGISTRY_ENTRIES,
): RegistryData {
  const entries = Object.entries(registry.entries);
  if (entries.length <= maxEntries) {
    return registry;
  }
  entries.sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  return { version: 2, entries: Object.fromEntries(entries.slice(0, maxEntries)) };
}

/** Defensive parse of the registry file. */
export function sanitizeRegistryData(value: unknown): RegistryData {
  if (!isRecord(value) || value['version'] !== 2 || !isRecord(value['entries'])) {
    return EMPTY_REGISTRY;
  }
  const entries: Record<string, RegistryEntry> = {};
  for (const [key, raw] of Object.entries(value['entries'])) {
    if (!isRecord(raw)) {
      continue;
    }
    const color = normalizeHexColor(asString(raw['color']));
    const claimedAt = raw['claimedAt'];
    const lastSeen = raw['lastSeen'];
    if (!color || typeof claimedAt !== 'number' || typeof lastSeen !== 'number') {
      continue;
    }
    const auto = normalizeHexColor(asString(raw['auto']));
    const external = normalizeHexColor(asString(raw['external']));
    const name = asString(raw['name']);
    const pids = Array.isArray(raw['pids'])
      ? raw['pids'].filter((p): p is number => Number.isInteger(p) && (p as number) > 0)
      : [];
    entries[key] = {
      ...(name ? { name } : {}),
      color,
      ...(auto ? { auto } : {}),
      ...(raw['custom'] === true ? { custom: true } : {}),
      ...(external ? { external } : {}),
      visible: raw['visible'] !== false,
      claimedAt,
      lastSeen,
      pids,
    };
  }
  return { version: 2, entries };
}

/**
 * Converts the registry of version 0.1.0 (`globalState`, `{ key: { color, auto, lastSeen } }`)
 * into entries that are not open (no process ids), so they only count as "recent".
 */
export function migrateLegacyRegistry(value: unknown): Record<string, RegistryEntry> {
  const entries: Record<string, RegistryEntry> = {};
  if (!isRecord(value)) {
    return entries;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      continue;
    }
    const color = normalizeHexColor(asString(raw['color']));
    const lastSeen = raw['lastSeen'];
    if (!color || typeof lastSeen !== 'number') {
      continue;
    }
    const auto = normalizeHexColor(asString(raw['auto']));
    entries[key] = {
      color,
      ...(auto ? { auto } : {}),
      ...(auto && auto !== color ? { custom: true } : {}),
      visible: true,
      claimedAt: lastSeen,
      lastSeen,
      pids: [],
    };
  }
  return entries;
}

function withEntry(registry: RegistryData, key: string, entry: RegistryEntry): RegistryData {
  return pruneRegistry({ version: 2, entries: { ...registry.entries, [key]: entry } });
}

function sameEntry(a: RegistryEntry | undefined, b: RegistryEntry): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
