/**
 * A repository that commits .vscode/settings.json (see .vscode-test.mjs):
 * Nameplate must color the window without asking and without Git ever seeing
 * its lines, while the user's own edits stay visible to Git.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { NameplateTestApi } from '../../src/extension';
import type { ProjectSnapshot } from '../../src/model';

const EXTENSION_ID = 'rowhitswami.nameplate';
const BACKGROUND = 'statusBar.background';

function workspaceColors(): Record<string, unknown> | undefined {
  return vscode.workspace
    .getConfiguration('workbench')
    .inspect<Record<string, unknown>>('colorCustomizations')?.workspaceValue;
}

async function settled(api: NameplateTestApi): Promise<ProjectSnapshot> {
  await api.refresh();
  const started = Date.now();
  for (;;) {
    const snapshot = api.getSnapshot();
    if (snapshot && snapshot.coloring.kind !== 'pending') {
      return snapshot;
    }
    if (Date.now() - started > 30_000) {
      throw new Error('Timed out waiting for a settled snapshot');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 20_000) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('Nameplate with a Git-tracked settings file', function () {
  let api: NameplateTestApi;
  let folder: string;
  let settingsFile: string;
  let committed: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  before(async () => {
    const extension = vscode.extensions.getExtension<NameplateTestApi | undefined>(EXTENSION_ID);
    assert.ok(extension);
    const exported = await extension.activate();
    assert.ok(exported);
    api = exported;
    folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    settingsFile = join(folder, '.vscode', 'settings.json');
    committed = git('show', 'HEAD:.vscode/settings.json');
    const config = vscode.workspace.getConfiguration('nameplate');
    for (const key of [
      'enabled',
      'colorStatusBar',
      'keepColorsOutOfGit',
      'showFirstRunNotification',
    ]) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    await api.controller.resetIdentity();
  });

  it('colors the window right away, without asking', async () => {
    const snapshot = await settled(api);
    assert.equal(snapshot.coloring.kind, 'active', JSON.stringify(snapshot.coloring));
    assert.equal(workspaceColors()?.[BACKGROUND], snapshot.color?.active);
    assert.equal(workspaceColors()?.['editor.background'], '#101010', "the user's own color stays");
    assert.ok(
      readFileSync(settingsFile, 'utf8').includes('statusBar.background'),
      'the color is on disk',
    );
  });

  it('keeps Git from seeing the color lines', async () => {
    await eventually(() => git('status', '--porcelain') === '', 'a clean git status');
    assert.equal(git('diff'), '');
    assert.ok(git('config', '--local', '--get', 'filter.nameplate.clean').includes('clean.sh'));
    assert.ok(
      readFileSync(join(folder, '.git', 'info', 'attributes'), 'utf8').includes('filter=nameplate'),
    );
  });

  it("still shows the user's own edits to the file", async () => {
    const editor = vscode.workspace.getConfiguration('editor');
    await editor.update('tabSize', 4, vscode.ConfigurationTarget.Workspace);
    try {
      await eventually(() => git('diff').includes('"editor.tabSize": 4'), 'the edit in git diff');
      assert.ok(!git('diff').includes('statusBar'), 'no color lines in the diff');
    } finally {
      await editor.update('tabSize', 2, vscode.ConfigurationTarget.Workspace);
    }
    await eventually(() => git('diff') === '', 'the edit to be undone');
  });

  it('takes everything back out when coloring is turned off', async () => {
    await api.controller.toggleColoring();
    const off = await settled(api);
    assert.equal(off.coloring.kind, 'off');
    assert.deepEqual(workspaceColors(), { 'editor.background': '#101010' });
    assert.ok(!readFileSync(settingsFile, 'utf8').includes('statusBar'));
    assert.throws(
      () => git('config', '--local', '--get', 'filter.nameplate.clean'),
      'filter removed',
    );
    assert.ok(!existsSync(join(folder, '.git', 'nameplate-colors.json')));
    assert.ok(!git('diff').includes('statusBar'));
    assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), JSON.parse(committed));

    await api.controller.toggleColoring();
    const on = await settled(api);
    assert.equal(on.coloring.kind, 'active');
    await eventually(() => git('status', '--porcelain') === '', 'a clean git status again');
  });

  it('writes plainly when keepColorsOutOfGit is off', async () => {
    const config = vscode.workspace.getConfiguration('nameplate');
    try {
      await config.update('keepColorsOutOfGit', false, vscode.ConfigurationTarget.Global);
      await eventually(() => {
        try {
          git('config', '--local', '--get', 'filter.nameplate.clean');
          return false;
        } catch {
          return true;
        }
      }, 'the filter to be removed');
      await settled(api);
      assert.ok(git('diff').includes('statusBar.background'), 'Git sees the colors');
    } finally {
      await config.update('keepColorsOutOfGit', undefined, vscode.ConfigurationTarget.Global);
    }
    const snapshot = await settled(api);
    assert.equal(snapshot.coloring.kind, 'active');
    await eventually(
      () => git('status', '--porcelain') === '',
      'a clean git status after re-enabling',
    );
  });
});
