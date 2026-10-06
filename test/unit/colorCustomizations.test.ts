import assert from 'node:assert/strict';
import {
  classifyKey,
  findThemeScopedOverrides,
  isOwning,
  planApply,
  planRelease,
  type ColorCustomizations,
  type OwnershipRecord,
} from '../../src/core/colors/colorCustomizations';

const desired = {
  'statusBar.background': '#2563eb',
  'statusBar.foreground': '#ffffff',
  'statusBar.inactiveBackground': '#2563eb',
};

describe('workbench.colorCustomizations planning', () => {
  it('creates the object when nothing exists', () => {
    const plan = planApply(undefined, undefined, desired, { takeover: false });
    assert.equal(plan.changed, true);
    assert.equal(plan.outcome, 'applied');
    assert.deepEqual(plan.next, desired);
    assert.deepEqual(plan.record, {
      version: 1,
      applied: desired,
      previous: {
        'statusBar.background': null,
        'statusBar.foreground': null,
        'statusBar.inactiveBackground': null,
      },
      containerExisted: false,
    });
  });

  it('preserves unrelated customizations exactly, including order and nested objects', () => {
    const current: ColorCustomizations = {
      'editor.background': '#101010',
      '[Monokai]': { 'editor.foreground': '#eeeeee' },
      'titleBar.activeBackground': '#333333',
    };
    const plan = planApply(current, undefined, desired, { takeover: false });
    assert.deepEqual(Object.keys(plan.next ?? {}), [
      'editor.background',
      '[Monokai]',
      'titleBar.activeBackground',
      'statusBar.background',
      'statusBar.foreground',
      'statusBar.inactiveBackground',
    ]);
    assert.deepEqual(plan.next?.['[Monokai]'], { 'editor.foreground': '#eeeeee' });
    assert.equal(plan.record?.containerExisted, true);
  });

  it('is a no-op when the desired values are already applied', () => {
    const first = planApply(undefined, undefined, desired, { takeover: false });
    const second = planApply(first.next, first.record, desired, { takeover: false });
    assert.equal(second.changed, false);
    assert.equal(second.outcome, 'unchanged');
    assert.deepEqual(second.record, first.record);
  });

  it('updates owned keys to a new color while keeping the original backup', () => {
    const current: ColorCustomizations = { 'statusBar.background': '#user' };
    const first = planApply(current, undefined, desired, { takeover: true });
    assert.equal(first.record?.previous['statusBar.background'], '#user');
    const next = {
      ...desired,
      'statusBar.background': '#15803d',
      'statusBar.inactiveBackground': '#15803d',
    };
    const second = planApply(first.next, first.record, next, { takeover: false });
    assert.equal(second.next?.['statusBar.background'], '#15803d');
    assert.equal(second.record?.previous['statusBar.background'], '#user');
  });

  it('removes keys that are no longer desired and restores their previous values', () => {
    const current: ColorCustomizations = { 'statusBar.debuggingBackground': '#orig' };
    const withDebug = { ...desired, 'statusBar.debuggingBackground': '#2563eb' };
    const first = planApply(current, undefined, withDebug, { takeover: true });
    const second = planApply(first.next, first.record, desired, { takeover: false });
    assert.equal(second.next?.['statusBar.debuggingBackground'], '#orig');
    assert.equal(second.record?.applied['statusBar.debuggingBackground'], undefined);
  });

  it('stands down (and releases what it owns) when a managed key was changed by someone else', () => {
    const first = planApply({ 'editor.background': '#000' }, undefined, desired, {
      takeover: false,
    });
    const tampered = { ...(first.next ?? {}), 'statusBar.background': '#ff0000' };
    const plan = planApply(tampered, first.record, desired, { takeover: false });
    assert.equal(plan.outcome, 'stood-down');
    assert.deepEqual(plan.conflicts, ['statusBar.background']);
    assert.equal(plan.record, undefined);
    // The foreign value stays, our foreground/inactive keys are removed, unrelated keys stay.
    assert.deepEqual(plan.next, { 'editor.background': '#000', 'statusBar.background': '#ff0000' });
  });

  it('never overwrites pre-existing foreign values without takeover', () => {
    const current: ColorCustomizations = { 'statusBar.background': '#123456' };
    const plan = planApply(current, undefined, desired, { takeover: false });
    assert.equal(plan.outcome, 'stood-down');
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.next, current);
    assert.deepEqual(plan.conflicts, ['statusBar.background']);
  });

  it('takes over foreign values on explicit request and backs them up', () => {
    const current: ColorCustomizations = {
      'statusBar.background': '#123456',
      'statusBar.foreground': '#abcdef',
    };
    const plan = planApply(current, undefined, desired, { takeover: true });
    assert.equal(plan.outcome, 'applied');
    assert.deepEqual(plan.next, desired);
    assert.deepEqual(plan.record?.previous, {
      'statusBar.background': '#123456',
      'statusBar.foreground': '#abcdef',
      'statusBar.inactiveBackground': null,
    });
    const release = planRelease(plan.next, plan.record);
    assert.deepEqual(release.next, current);
  });

  it('re-applies when its keys were removed externally', () => {
    const first = planApply(undefined, undefined, desired, { takeover: false });
    const plan = planApply({}, first.record, desired, { takeover: false });
    assert.equal(plan.outcome, 'applied');
    assert.deepEqual(plan.next, desired);
    assert.deepEqual(plan.record?.previous, first.record?.previous);
  });

  it('release restores previous values and removes the container it created', () => {
    const first = planApply(undefined, undefined, desired, { takeover: false });
    const release = planRelease(first.next, first.record);
    assert.equal(release.outcome, 'released');
    assert.equal(release.next, undefined);
    assert.equal(release.record, undefined);
  });

  it('release keeps an empty container that existed before', () => {
    const first = planApply({}, undefined, desired, { takeover: false });
    const release = planRelease(first.next, first.record);
    assert.deepEqual(release.next, {});
  });

  it('release leaves externally changed keys alone', () => {
    const first = planApply({ 'editor.background': '#000' }, undefined, desired, {
      takeover: false,
    });
    const tampered = { ...(first.next ?? {}), 'statusBar.foreground': '#111111' };
    const release = planRelease(tampered, first.record);
    assert.deepEqual(release.next, {
      'editor.background': '#000',
      'statusBar.foreground': '#111111',
    });
  });

  it('release without a record changes nothing', () => {
    const plan = planRelease({ a: 1 }, undefined);
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.next, { a: 1 });
  });

  it('classifies keys and ownership', () => {
    const record: OwnershipRecord = {
      version: 1,
      applied: { 'statusBar.background': '#2563eb' },
      previous: { 'statusBar.background': null },
      containerExisted: false,
    };
    assert.equal(classifyKey(undefined, undefined, 'statusBar.background'), 'free');
    assert.equal(
      classifyKey({ 'statusBar.background': '#x' }, undefined, 'statusBar.background'),
      'foreign',
    );
    assert.equal(
      classifyKey({ 'statusBar.background': '#2563eb' }, record, 'statusBar.background'),
      'owned',
    );
    assert.equal(
      classifyKey({ 'statusBar.background': '#x' }, record, 'statusBar.background'),
      'changed-externally',
    );
    assert.equal(classifyKey({}, record, 'statusBar.background'), 'removed-externally');
    assert.equal(isOwning({ 'statusBar.background': '#2563eb' }, record), true);
    assert.equal(isOwning({ 'statusBar.background': '#x' }, record), false);
    assert.equal(isOwning({}, undefined), false);
  });

  it('finds theme-scoped overrides of managed keys', () => {
    const effective: ColorCustomizations = {
      'statusBar.background': '#2563eb',
      '[Dark Modern]': { 'statusBar.background': '#000000' },
      '[Monokai]': { 'editor.background': '#000000' },
      '[Abyss]': 'not-an-object',
    };
    assert.deepEqual(findThemeScopedOverrides(effective, ['statusBar.background']), [
      '[Dark Modern]',
    ]);
    assert.deepEqual(findThemeScopedOverrides(undefined, ['statusBar.background']), []);
  });
});
