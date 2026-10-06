/**
 * Ownership-aware editing of the workspace-level `workbench.colorCustomizations`
 * object.
 *
 * Rules that keep the user's settings safe:
 *
 * - Nameplate only ever touches the keys it manages (`statusBar.*`). Every other
 *   entry of the object is copied through untouched and in its original order.
 * - Before a key is written for the first time, its previous value (or the fact
 *   that it was absent) is remembered in an {@link OwnershipRecord}, so the key
 *   can be restored exactly when coloring is turned off.
 * - A key whose current value differs from what Nameplate last wrote belongs to
 *   someone else (the user, another extension, a teammate's commit). Nameplate
 *   never overwrites such a value on its own: it stands down and releases the
 *   other keys it owns, because a foreground computed for a different
 *   background could be unreadable. Only an explicit user action (`takeover`)
 *   replaces foreign values, and even then they are backed up first.
 *
 * All functions are pure: they return a plan and never write anything.
 */

export type ColorCustomizations = Record<string, unknown>;

export interface OwnershipRecord {
  readonly version: 1;
  /** Keys Nameplate wrote, with the exact values it wrote. */
  readonly applied: Readonly<Record<string, string>>;
  /**
   * Values that were present before Nameplate first wrote each key.
   * `null` means the key did not exist.
   */
  readonly previous: Readonly<Record<string, unknown>>;
  /** Whether a workspace-level `workbench.colorCustomizations` object existed before the first write. */
  readonly containerExisted: boolean;
}

export type KeyStatus =
  /** Absent and never written by Nameplate. */
  | 'free'
  /** Present with exactly the value Nameplate wrote. */
  | 'owned'
  /** Present, but Nameplate never wrote it. */
  | 'foreign'
  /** Nameplate wrote it, somebody changed it since. */
  | 'changed-externally'
  /** Nameplate wrote it, somebody removed it since. */
  | 'removed-externally';

export type PlanOutcome = 'applied' | 'stood-down' | 'released' | 'unchanged';

export interface ColorPlan {
  /** The new workspace-level value. `undefined` removes the setting entirely. */
  readonly next: ColorCustomizations | undefined;
  /** The ownership record to persist after writing (`undefined` = nothing owned). */
  readonly record: OwnershipRecord | undefined;
  /** Whether `next` differs from the current value and must be written. */
  readonly changed: boolean;
  /** Managed keys that hold foreign values and were left alone. */
  readonly conflicts: readonly string[];
  readonly outcome: PlanOutcome;
}

export interface ApplyOptions {
  /** Replace foreign values (after backing them up). Only for explicit user actions. */
  readonly takeover: boolean;
}

export function classifyKey(
  current: ColorCustomizations | undefined,
  record: OwnershipRecord | undefined,
  key: string,
): KeyStatus {
  const value = current?.[key];
  const applied = record?.applied[key];
  if (applied !== undefined) {
    if (value === undefined) {
      return 'removed-externally';
    }
    return value === applied ? 'owned' : 'changed-externally';
  }
  return value === undefined ? 'free' : 'foreign';
}

/** True when Nameplate wrote keys and all of them still hold Nameplate's values. */
export function isOwning(
  current: ColorCustomizations | undefined,
  record: OwnershipRecord | undefined,
): boolean {
  if (!record) {
    return false;
  }
  const keys = Object.keys(record.applied);
  return keys.length > 0 && keys.every((key) => classifyKey(current, record, key) === 'owned');
}

export function planApply(
  current: ColorCustomizations | undefined,
  record: OwnershipRecord | undefined,
  desired: Readonly<Record<string, string>>,
  options: ApplyOptions,
): ColorPlan {
  const previouslyApplied = record?.applied ?? {};
  const managedKeys = unique([...Object.keys(desired), ...Object.keys(previouslyApplied)]);

  const conflicts = managedKeys.filter((key) => {
    if (!(key in desired)) {
      return false;
    }
    const status = classifyKey(current, record, key);
    return status === 'foreign' || status === 'changed-externally';
  });

  if (conflicts.length > 0 && !options.takeover) {
    const release = planRelease(current, record);
    return { ...release, conflicts, outcome: 'stood-down' };
  }

  const next: ColorCustomizations = { ...(current ?? {}) };
  const applied: Record<string, string> = {};
  const previous: Record<string, unknown> = {};

  for (const key of managedKeys) {
    const status = classifyKey(current, record, key);
    const wanted = desired[key];
    if (wanted !== undefined) {
      switch (status) {
        case 'owned':
          previous[key] = record?.previous[key] ?? null;
          break;
        case 'foreign':
        case 'changed-externally':
          // Explicit takeover: remember what we are replacing.
          previous[key] = current?.[key] ?? null;
          break;
        case 'free':
        case 'removed-externally':
          previous[key] = null;
          break;
      }
      next[key] = wanted;
      applied[key] = wanted;
    } else if (status === 'owned') {
      restoreKey(next, key, record?.previous[key]);
    }
    // Keys we used to own but no longer want and that changed externally are simply forgotten.
  }

  const containerExisted = record?.containerExisted ?? current !== undefined;
  const value = Object.keys(next).length === 0 && !containerExisted ? undefined : next;
  const changed = !sameCustomizations(current, value);
  const nextRecord: OwnershipRecord | undefined =
    Object.keys(applied).length > 0
      ? { version: 1, applied, previous, containerExisted }
      : undefined;

  return {
    next: value,
    record: nextRecord,
    changed,
    conflicts: [],
    outcome: changed ? 'applied' : 'unchanged',
  };
}

/** Restores every owned key to its pre-Nameplate value and forgets the record. */
export function planRelease(
  current: ColorCustomizations | undefined,
  record: OwnershipRecord | undefined,
): ColorPlan {
  if (!record) {
    return {
      next: current,
      record: undefined,
      changed: false,
      conflicts: [],
      outcome: 'unchanged',
    };
  }
  const next: ColorCustomizations = { ...(current ?? {}) };
  for (const key of Object.keys(record.applied)) {
    if (classifyKey(current, record, key) === 'owned') {
      restoreKey(next, key, record.previous[key]);
    }
  }
  const value = Object.keys(next).length === 0 && !record.containerExisted ? undefined : next;
  const changed = !sameCustomizations(current, value);
  return {
    next: value,
    record: undefined,
    changed,
    conflicts: [],
    outcome: changed ? 'released' : 'unchanged',
  };
}

/**
 * Finds theme-scoped blocks such as `"[Dark Modern]": { "statusBar.background": ... }`
 * in an (effective, merged) customizations object. Such blocks take precedence
 * over the plain keys Nameplate writes and would hide the project color.
 */
export function findThemeScopedOverrides(
  customizations: ColorCustomizations | undefined,
  managedKeys: readonly string[],
): string[] {
  if (!customizations) {
    return [];
  }
  const selectors: string[] = [];
  for (const [key, value] of Object.entries(customizations)) {
    if (!key.startsWith('[') || !isRecord(value)) {
      continue;
    }
    if (managedKeys.some((managed) => managed in value)) {
      selectors.push(key);
    }
  }
  return selectors;
}

function restoreKey(target: ColorCustomizations, key: string, previous: unknown): void {
  if (previous === null || previous === undefined) {
    delete target[key];
  } else {
    target[key] = previous;
  }
}

function sameCustomizations(
  a: ColorCustomizations | undefined,
  b: ColorCustomizations | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
