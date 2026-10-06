/**
 * Runs Nameplate's clean filter through real Git: a repository that tracks
 * .vscode/settings.json must look untouched while Nameplate's colors are in
 * the file, and the user's own edits must still show up.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitFilter, shellQuote, toShellPath, wrapperScript } from '../../src/colors/gitFilter';
import { SETTINGS_JSON_PATH, type CleanRecord } from '../../src/core/git/cleanSettings';
import {
  addAttributesBlock,
  hasNameplateAttributes,
  removeAttributesBlock,
  toAttributesLine,
} from '../../src/core/git/gitExclude';
import type { Logger } from '../../src/logging/logger';

const FILTER_BUNDLE = resolve(__dirname, '..', '..', '..', 'dist', 'git-clean-filter.js');
const SETTINGS = '.vscode/settings.json';

const silentLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
  dispose: () => undefined,
};

const committed = '{\n  "editor.codeActionsOnSave": {\n    "source.fixAll": "explicit"\n  }\n}\n';
const colored =
  '{\n  "editor.codeActionsOnSave": {\n    "source.fixAll": "explicit"\n  },\n' +
  '  "workbench.colorCustomizations": {\n    "statusBar.background": "#06b6d4",\n' +
  '    "statusBar.foreground": "#000000"\n  }\n}\n';
const record: CleanRecord = {
  jsonPath: SETTINGS_JSON_PATH,
  applied: { 'statusBar.background': '#06b6d4', 'statusBar.foreground': '#000000' },
  previous: { 'statusBar.background': null, 'statusBar.foreground': null },
  containerExisted: false,
};

describe('Git clean filter with real Git', function () {
  this.timeout(30_000);
  let root: string;
  let repo: string;
  let filter: GitFilter;
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const local = (): { root: string; gitDir: string; commonDir: string } => ({
    root: repo,
    gitDir: join(repo, '.git'),
    commonDir: join(repo, '.git'),
  });

  before(function () {
    try {
      execFileSync('git', ['--version']);
    } catch {
      this.skip();
    }
    assert.ok(existsSync(FILTER_BUNDLE), `${FILTER_BUNDLE} exists (run npm run bundle)`);
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nameplate-git-'));
    repo = join(root, 'repo');
    mkdirSync(join(repo, '.vscode'), { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, SETTINGS), committed);
    writeFileSync(join(repo, 'README.md'), 'hi\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    filter = new GitFilter(
      join(root, 'storage'),
      FILTER_BUNDLE,
      process.execPath,
      () => Promise.resolve('git'),
      silentLogger,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('hides Nameplate colors from status, diff and commits', async () => {
    assert.equal(await filter.protect(local(), SETTINGS, record), true);
    writeFileSync(join(repo, SETTINGS), colored);
    await filter.refreshIndex(local(), SETTINGS);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('diff'), '');
    git('add', '-A');
    assert.equal(git('diff', '--cached'), '', 'nothing to commit');
    assert.equal(readFileSync(join(repo, SETTINGS), 'utf8'), colored, 'the colors stay on disk');
  });

  it("still shows the user's own edits, without the colors", async () => {
    await filter.protect(local(), SETTINGS, record);
    writeFileSync(join(repo, SETTINGS), colored.replace('"explicit"', '"always"'));
    const diff = git('diff');
    assert.ok(diff.includes('+    "source.fixAll": "always"'), diff);
    assert.ok(!diff.includes('statusBar'), diff);
    git('commit', '-q', '-am', 'user change');
    const stored = git('show', `HEAD:${SETTINGS}`);
    assert.ok(stored.includes('"always"'));
    assert.ok(!stored.includes('statusBar'), 'the colors were not committed');
  });

  it('lets checkout and stash work as usual', async () => {
    await filter.protect(local(), SETTINGS, record);
    git('branch', 'other');
    writeFileSync(join(repo, SETTINGS), colored);
    await filter.refreshIndex(local(), SETTINGS);
    git('checkout', '-q', 'other');
    git('checkout', '-q', 'main');
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    git('stash', '-q');
    git('stash', 'pop', '-q');
    assert.equal(git('status', '--porcelain').trim(), 'M README.md');
  });

  it('shows colors that were committed by mistake as a removal', async () => {
    writeFileSync(join(repo, SETTINGS), colored);
    git('commit', '-q', '-am', 'oops: committed the colors');
    await filter.protect(local(), SETTINGS, record);
    await filter.refreshIndex(local(), SETTINGS);
    const diff = git('diff');
    assert.ok(diff.includes('-  "workbench.colorCustomizations": {'), diff);
  });

  it('removes every trace when unprotected', async () => {
    await filter.protect(local(), SETTINGS, record);
    assert.ok(git('config', '--local', '--get', 'filter.nameplate.clean').includes('clean.sh'));
    await filter.unprotect(local(), SETTINGS);
    assert.throws(() => git('config', '--local', '--get', 'filter.nameplate.clean'));
    assert.equal(
      hasNameplateAttributes(readFileSync(join(repo, '.git', 'info', 'attributes'), 'utf8')),
      false,
    );
    assert.equal(existsSync(join(repo, '.git', 'nameplate-colors.json')), false);
  });

  it('lets Git see the colors again once the filter is removed', async () => {
    await filter.protect(local(), SETTINGS, record);
    writeFileSync(join(repo, SETTINGS), colored);
    await filter.refreshIndex(local(), SETTINGS);
    assert.equal(git('status', '--porcelain'), '');
    await filter.unprotect(local(), SETTINGS);
    assert.equal(git('status', '--porcelain').trim(), 'M .vscode/settings.json');
    assert.ok(git('diff').includes('statusBar.background'));
  });

  it('falls back to passing content through when the filter program is gone', async () => {
    await filter.protect(local(), SETTINGS, record);
    rmSync(join(root, 'storage'), { recursive: true, force: true });
    writeFileSync(join(repo, SETTINGS), colored);
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(
      status.trim(),
      'M .vscode/settings.json',
      'git keeps working, it just sees the colors',
    );
  });
});

describe('Git filter helpers', () => {
  it('quotes paths for sh, also on Windows', () => {
    assert.equal(shellQuote("it's"), `'it'\\''s'`);
    assert.equal(toShellPath('C:\\Users\\me\\x.sh'), 'C:/Users/me/x.sh');
    const script = wrapperScript('/a b/clean-filter.js', '/Applications/Visual Studio Code.app/x');
    assert.ok(script.includes("script='/a b/clean-filter.js'"));
    assert.ok(script.includes('ELECTRON_RUN_AS_NODE=1 exec "$runtime" "$script" "$@"'));
    assert.ok(script.trimEnd().endsWith('exec cat'));
  });

  it('adds and removes its attributes lines', () => {
    const line = toAttributesLine('.vscode/settings.json');
    assert.equal(line, '/.vscode/settings.json filter=nameplate');
    assert.equal(
      toAttributesLine('my app/.vscode/settings.json'),
      '"/my app/.vscode/settings.json" filter=nameplate',
    );
    const added = addAttributesBlock('*.png binary\n', '.vscode/settings.json');
    assert.ok(added.startsWith('*.png binary\n#'));
    assert.equal(addAttributesBlock(added, '.vscode/settings.json'), added);
    assert.equal(hasNameplateAttributes(added), true);
    assert.equal(removeAttributesBlock(added, '.vscode/settings.json'), '*.png binary\n');
  });
});
