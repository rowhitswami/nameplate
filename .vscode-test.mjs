// Configuration for `vscode-test` (@vscode/test-cli): runs test/integration in a
// real VS Code instance against throw-away copies of the fixture project.
//
// Two workspaces are prepared:
//   default: a repository with a hand-made .git (no git binary needed) and no
//            settings file, which is the common case.
//   tracked: a real repository (requires `git`) that commits
//            .vscode/settings.json, for the Git filter.
import { defineConfig } from '@vscode/test-cli';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = new URL('./test/fixtures/sample-project', import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'nameplate-'));
const common = {
  version: 'stable',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'bdd', timeout: 90_000, color: true },
};

// --- default workspace -----------------------------------------------------
const workspace = join(root, 'brightdesk-mobile');
cpSync(fixture, workspace, { recursive: true });
const gitDir = join(workspace, '.git');
mkdirSync(join(gitDir, 'objects'), { recursive: true });
mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true });
writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
writeFileSync(
  join(gitDir, 'config'),
  [
    '[core]',
    '\trepositoryformatversion = 0',
    '\tfilemode = true',
    '\tbare = false',
    '[remote "origin"]',
    '\turl = git@github.com:acme/BrightDesk-Mobile.git',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    '',
  ].join('\n'),
);

// --- tracked workspace -----------------------------------------------------
const tracked = join(root, 'tracked-project');
let trackedReady = false;
try {
  cpSync(fixture, tracked, { recursive: true });
  mkdirSync(join(tracked, '.vscode'), { recursive: true });
  writeFileSync(
    join(tracked, '.vscode', 'settings.json'),
    '{\n  "editor.tabSize": 2,\n  "workbench.colorCustomizations": {\n    "editor.background": "#101010"\n  }\n}\n',
  );
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: tracked,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Nameplate Tests',
        GIT_AUTHOR_EMAIL: 'tests@example.com',
        GIT_COMMITTER_NAME: 'Nameplate Tests',
        GIT_COMMITTER_EMAIL: 'tests@example.com',
      },
    });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture');
  trackedReady = true;
} catch (error) {
  console.warn(`Skipping the tracked-settings scenario (git unavailable?): ${String(error)}`);
}

export default defineConfig([
  {
    ...common,
    label: 'default',
    files: 'out/test/integration/extension.test.js',
    workspaceFolder: workspace,
  },
  ...(trackedReady
    ? [
        {
          ...common,
          label: 'tracked',
          files: 'out/test/integration/tracked.test.js',
          workspaceFolder: tracked,
        },
      ]
    : []),
]);
