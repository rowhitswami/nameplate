/**
 * End-to-end tests inside a real VS Code instance. The workspace is a
 * temporary copy of test/fixtures/sample-project with a hand-made `.git`
 * directory (see .vscode-test.mjs).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { NameplateTestApi } from '../../src/extension';
import type { ProjectSnapshot } from '../../src/model';

const EXTENSION_ID = 'rowhitswami.nameplate';
const BACKGROUND = 'statusBar.background';
const FOREGROUND = 'statusBar.foreground';
const INACTIVE = 'statusBar.inactiveBackground';

function workspaceColors(): Record<string, unknown> | undefined {
  return vscode.workspace
    .getConfiguration('workbench')
    .inspect<Record<string, unknown>>('colorCustomizations')?.workspaceValue;
}

function writeWorkspaceColors(value: Record<string, unknown> | undefined): Thenable<void> {
  return vscode.workspace
    .getConfiguration('workbench')
    .update('colorCustomizations', value, vscode.ConfigurationTarget.Workspace);
}

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs = 20_000,
  what = 'condition',
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function settledSnapshot(api: NameplateTestApi): Promise<ProjectSnapshot> {
  await api.refresh();
  return waitFor(
    () => {
      const snapshot = api.getSnapshot();
      return snapshot && snapshot.coloring.kind !== 'pending' ? snapshot : undefined;
    },
    30_000,
    'a settled snapshot',
  );
}

describe('Nameplate in VS Code', function () {
  let api: NameplateTestApi;
  let workspacePath: string;

  before(async () => {
    const extension = vscode.extensions.getExtension<NameplateTestApi | undefined>(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is installed in the test instance`);
    const exported = await extension.activate();
    assert.ok(exported, 'activate() returned the test API');
    api = exported;
    workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    assert.ok(workspacePath.length > 0, 'a workspace folder is open');
    // The test instance keeps its user settings between runs; start from the defaults.
    const config = vscode.workspace.getConfiguration('nameplate');
    for (const key of [
      'enabled',
      'colorStatusBar',
      'keepColorsOutOfGit',
      'showFirstRunNotification',
    ]) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('registers every contributed command', async () => {
    const commands = await vscode.commands.getCommands(true);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const contributed = (
      extension?.packageJSON as { contributes: { commands: { command: string }[] } }
    ).contributes.commands;
    for (const { command } of contributed) {
      assert.ok(commands.includes(command), `${command} is registered`);
    }
  });

  it('detects the project name, repository and type', async () => {
    const snapshot = await settledSnapshot(api);
    // Folder "brightdesk-mobile" + remote "BrightDesk-Mobile" → casing is adopted from the remote.
    assert.equal(snapshot.identity.displayName, 'BrightDesk Mobile');
    assert.equal(snapshot.identity.detectedSource, 'folder');
    assert.equal(snapshot.identity.key, 'git:github.com/acme/brightdesk-mobile');
    assert.equal(snapshot.git?.branch, 'main');
    assert.equal(snapshot.git?.remote?.webUrl, 'https://github.com/acme/BrightDesk-Mobile');
    assert.equal(snapshot.identity.projectType?.label, 'Expo');
  });

  it('colors the status bar and keeps the created settings file out of Git', async () => {
    const snapshot = await settledSnapshot(api);
    assert.equal(snapshot.coloring.kind, 'active', JSON.stringify(snapshot.coloring));
    assert.ok(snapshot.color, 'a color was resolved');
    const colors = await waitFor(() => {
      const value = workspaceColors();
      return value?.[BACKGROUND] === snapshot.color?.active ? value : undefined;
    });
    assert.equal(colors[FOREGROUND], snapshot.color.theme.foreground);
    assert.equal(colors[INACTIVE], snapshot.color.active);
    assert.ok(existsSync(join(workspacePath, '.vscode', 'settings.json')));
    const exclude = readFileSync(join(workspacePath, '.git', 'info', 'exclude'), 'utf8');
    assert.ok(exclude.includes('/.vscode/settings.json'), 'local exclude lists the settings file');
  });

  it('deletes the settings file and exclude entry it created when coloring is turned off', async () => {
    const settingsFile = join(workspacePath, '.vscode', 'settings.json');
    const excludeFile = join(workspacePath, '.git', 'info', 'exclude');
    await api.controller.toggleColoring();
    const off = await settledSnapshot(api);
    assert.equal(off.coloring.kind, 'off');
    assert.equal(
      existsSync(settingsFile),
      false,
      'the empty settings file Nameplate created is gone',
    );
    assert.equal(readFileSync(excludeFile, 'utf8').includes('/.vscode/settings.json'), false);
    await api.controller.toggleColoring();
    const on = await settledSnapshot(api);
    assert.equal(on.coloring.kind, 'active');
    assert.ok(existsSync(settingsFile));
    assert.ok(readFileSync(excludeFile, 'utf8').includes('/.vscode/settings.json'));
  });

  it('registers the window in the shared registry file (not the in-memory fallback)', async () => {
    const snapshot = await settledSnapshot(api);
    assert.ok(api.registryPath, 'a registry file is used, so windows can coordinate');
    const registry = JSON.parse(readFileSync(api.registryPath, 'utf8')) as {
      version: number;
      entries: Record<string, { color: string; pids: number[]; visible: boolean }>;
    };
    assert.equal(registry.version, 2);
    const own = registry.entries[snapshot.identity.key];
    assert.ok(own, 'the project has an entry');
    assert.equal(own.color, snapshot.color?.active);
    assert.equal(own.visible, true);
    assert.ok(own.pids.length > 0, 'the extension host process id is recorded');
  });

  it('preserves unrelated color customizations exactly', async () => {
    const before = workspaceColors() ?? {};
    await writeWorkspaceColors({
      'editor.background': '#101010',
      '[Dark Modern]': { 'editor.foreground': '#eeeeee' },
      ...before,
    });
    const snapshot = await settledSnapshot(api);
    const after = workspaceColors() ?? {};
    assert.equal(after['editor.background'], '#101010');
    assert.deepEqual(after['[Dark Modern]'], { 'editor.foreground': '#eeeeee' });
    assert.equal(after[BACKGROUND], snapshot.color?.active);
    assert.equal(Object.keys(after)[0], 'editor.background', 'existing keys keep their order');
  });

  it('renames the project and persists the custom name', async () => {
    await api.controller.setCustomName('BrightDesk');
    const renamed = await settledSnapshot(api);
    assert.equal(renamed.identity.displayName, 'BrightDesk');
    assert.equal(renamed.identity.customName, 'BrightDesk');
    assert.equal(renamed.identity.detectedName, 'BrightDesk Mobile');
    await api.controller.setCustomName(undefined);
    const reset = await settledSnapshot(api);
    assert.equal(reset.identity.displayName, 'BrightDesk Mobile');
  });

  it('applies a custom color and resets to the automatic one', async () => {
    const auto = (await settledSnapshot(api)).color?.auto;
    await api.controller.setCustomColor('#15803D');
    const custom = await settledSnapshot(api);
    assert.equal(custom.color?.active, '#15803d');
    assert.equal(custom.color?.source, 'custom');
    assert.equal(workspaceColors()?.[BACKGROUND], '#15803d');
    await api.controller.resetColor();
    const reset = await settledSnapshot(api);
    assert.equal(reset.color?.active, auto);
    assert.equal(workspaceColors()?.[BACKGROUND], auto);
  });

  it('regenerates a different automatic color', async () => {
    const before = (await settledSnapshot(api)).color?.auto;
    await api.controller.regenerateColor();
    const after = await settledSnapshot(api);
    assert.notEqual(after.color?.auto, before);
    assert.equal(workspaceColors()?.[BACKGROUND], after.color?.auto);
  });

  it('turns coloring off and on without touching unrelated keys', async () => {
    await api.controller.toggleColoring();
    const off = await settledSnapshot(api);
    assert.equal(off.coloring.kind, 'off');
    const colors = workspaceColors() ?? {};
    assert.equal(colors[BACKGROUND], undefined);
    assert.equal(colors[FOREGROUND], undefined);
    assert.equal(colors['editor.background'], '#101010');
    await api.controller.toggleColoring();
    const on = await settledSnapshot(api);
    assert.equal(on.coloring.kind, 'active');
    assert.equal(workspaceColors()?.[BACKGROUND], on.color?.active);
  });

  it('stands down when someone else sets the status bar color, and takes over only on request', async () => {
    const current = workspaceColors() ?? {};
    await writeWorkspaceColors({ ...current, [BACKGROUND]: '#123456' });
    const external = await settledSnapshot(api);
    assert.equal(external.coloring.kind, 'external');
    const colors = workspaceColors() ?? {};
    assert.equal(colors[BACKGROUND], '#123456', 'the foreign value is untouched');
    assert.equal(colors[FOREGROUND], undefined, 'our foreground was released');

    await api.controller.setCustomColor('#7e22ce');
    const taken = await settledSnapshot(api);
    assert.equal(taken.coloring.kind, 'active');
    assert.equal(workspaceColors()?.[BACKGROUND], '#7e22ce');

    await api.controller.toggleColoring();
    await settledSnapshot(api);
    assert.equal(
      workspaceColors()?.[BACKGROUND],
      '#123456',
      'the backed-up foreign value is restored',
    );
    await writeWorkspaceColors({ ...(workspaceColors() ?? {}), [BACKGROUND]: undefined });
    await api.controller.toggleColoring();
    const back = await settledSnapshot(api);
    assert.equal(back.coloring.kind, 'active');
  });

  it('removes its colors when disabled and restores them when enabled', async () => {
    const config = vscode.workspace.getConfiguration('nameplate');
    try {
      await config.update('enabled', false, vscode.ConfigurationTarget.Global);
      await waitFor(
        () => (workspaceColors()?.[BACKGROUND] === undefined ? true : undefined),
        20_000,
        'colors removed',
      );
      assert.equal(api.getSnapshot(), undefined);
    } finally {
      await config.update('enabled', undefined, vscode.ConfigurationTarget.Global);
    }
    const snapshot = await settledSnapshot(api);
    assert.equal(snapshot.coloring.kind, 'active');
    assert.equal(workspaceColors()?.[BACKGROUND], snapshot.color?.active);
  });

  it('resets the identity back to automatic behaviour', async () => {
    await api.controller.setCustomName('Temporary');
    await api.controller.setLabel('DEV');
    await api.controller.resetIdentity();
    const snapshot = await settledSnapshot(api);
    assert.equal(snapshot.identity.customName, undefined);
    assert.equal(snapshot.identity.label, undefined);
    assert.equal(snapshot.identity.displayName, 'BrightDesk Mobile');
    assert.equal(snapshot.coloring.kind, 'active');
  });
});
