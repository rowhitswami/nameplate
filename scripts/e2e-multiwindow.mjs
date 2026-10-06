// Multi-window end-to-end check: opens several windows of an isolated VS Code
// instance on throw-away Git projects whose automatic colors all collide,
// installs a Nameplate VSIX while the windows are open (so every window
// activates at the same moment), and reports the color each window ended up
// with. Exits non-zero when two open windows show the same or a confusingly
// similar color.
//
//   npm run test:multiwindow                     (packages, then tests the current version)
//   node scripts/e2e-multiwindow.mjs --vsix old.vsix --upgrade-to new.vsix
//
// The instance uses its own user-data and extensions directories under the OS
// temp dir; your normal VS Code installation and settings are never touched.
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
// Default: the VSIX `npm run package` produces for the current version.
const vsix =
  option('--vsix') ??
  `nameplate-${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}.vsix`;
const upgradeTo = option('--upgrade-to');
const keep = args.includes('--keep');
// Six repository names whose canonical colors are identical (all pink in 0.1.0).
const names = (option('--names') ?? 'demo-26,demo-27,demo-51,demo-63,demo-75,demo-90').split(',');
if (!existsSync(vsix)) {
  console.error(
    `${vsix} not found. Run "npm run package" first, or pass --vsix <file> [--upgrade-to <file>] [--keep].`,
  );
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), 'nameplate-mw-'));
const userDataDir = join(root, 'user-data');
const extensionsDir = join(root, 'extensions');
// Every other project commits its .vscode/settings.json, like many real repositories.
const projects = names.map((name, i) =>
  createProject(join(root, 'projects', name), name, i % 2 === 1),
);

const executable = await downloadAndUnzipVSCode('stable');
// Only the CLI path: the helper also returns its own --user-data-dir/--extensions-dir,
// and duplicated flags make the GUI launch fail silently.
const [cli] = resolveCliArgsFromVSCodeExecutablePath(executable);
const baseArgs = [
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-telemetry',
];

/** Whether the final state (after the upgrade, if any) has clearly different colors. */
async function run() {
  console.log(`root: ${root}`);
  await openWindows();
  install(vsix);
  const first = report(await waitForStableColors('after installing ' + vsix));
  if (!upgradeTo) {
    return first;
  }
  install(upgradeTo);
  await stopInstance();
  await openWindows();
  return report(await waitForStableColors('after upgrading to ' + upgradeTo));
}

let passed;
try {
  passed = await run();
  printLogs();
} finally {
  if (!keep) {
    await stopInstance();
  }
}
if (passed && !keep) {
  rmSync(root, { recursive: true, force: true });
} else {
  console.log(`\nkept ${root} for inspection`);
}
process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------

function createProject(dir, name, tracked) {
  if (tracked) {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }, null, 2));
    writeFileSync(
      join(dir, '.vscode', 'settings.json'),
      '{\n  "editor.codeActionsOnSave": {\n    "source.fixAll": "explicit"\n  }\n}\n',
    );
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('remote', 'add', 'origin', `git@github.com:acme/${name}.git`);
    git('add', '.');
    git(
      '-c',
      'user.name=E2E',
      '-c',
      'user.email=e2e@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init',
    );
    return { name, dir, tracked };
  }
  mkdirSync(join(dir, '.git', 'objects'), { recursive: true });
  mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(
    join(dir, '.git', 'config'),
    `[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/${name}.git\n`,
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }, null, 2));
  return { name, dir, tracked };
}

/** What `git status` reports for the settings folder (empty = Git sees nothing of Nameplate). */
function gitStatus(dir) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', '.vscode'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    return `git status failed: ${String(error)}`;
  }
}

async function openWindows() {
  for (const project of projects) {
    const child = spawn(cli, [...baseArgs, '--new-window', project.dir], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    await sleep(project === projects[0] ? 6000 : 1500);
  }
  await sleep(6000);
}

function install(file) {
  console.log(`installing ${file} while ${projects.length} windows are open…`);
  const result = spawnSync(cli, [...baseArgs, '--install-extension', resolve(file), '--force'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`install failed: ${result.stderr || result.stdout}`);
  }
}

function readColors() {
  return projects.map((project) => {
    const file = join(project.dir, '.vscode', 'settings.json');
    if (!existsSync(file)) {
      return { ...project, color: undefined };
    }
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      return { ...project, color: json['workbench.colorCustomizations']?.['statusBar.background'] };
    } catch {
      return { ...project, color: undefined };
    }
  });
}

async function waitForStableColors(label) {
  const deadline = Date.now() + 120_000;
  let last = '';
  let stableSince = Date.now();
  for (;;) {
    const colors = readColors();
    const signature = colors.map((c) => c.color ?? '-').join(',');
    if (signature !== last) {
      last = signature;
      stableSince = Date.now();
    }
    const complete = colors.every((c) => c.color);
    if ((complete && Date.now() - stableSince > 8000) || Date.now() > deadline) {
      console.log(`\n=== ${label} ===`);
      return colors;
    }
    await sleep(500);
  }
}

function report(colors) {
  const problems = [];
  for (const { name, color, dir, tracked } of colors) {
    const status = gitStatus(dir);
    console.log(
      `  ${name.padEnd(10)} ${(color ?? '(no color)').padEnd(10)} ${tracked ? 'committed settings.json' : 'no settings.json yet  '}  git status .vscode: ${status === '' ? 'clean' : status.replace(/\n/g, ' | ')}`,
    );
    if (status !== '') {
      problems.push(`${name}: Git sees Nameplate's changes (${status.replace(/\n/g, ' | ')})`);
    }
  }
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i];
      const b = colors[j];
      if (!a.color || !b.color) {
        continue;
      }
      const distance = oklabDistance(a.color, b.color);
      if (distance < 0.1) {
        problems.push(
          `${a.name} and ${b.name}: ${a.color} vs ${b.color} (ΔE ${distance.toFixed(3)})`,
        );
      }
    }
  }
  const missing = colors.filter((c) => !c.color).map((c) => c.name);
  if (missing.length > 0) {
    problems.push(`no color: ${missing.join(', ')}`);
  }
  if (problems.length === 0) {
    console.log('  ✔ every window has a clearly different color');
    return true;
  }
  console.log(`  ✘ ${problems.length} problem(s):`);
  for (const problem of problems) {
    console.log(`    - ${problem}`);
  }
  return false;
}

function printLogs() {
  const logsDir = join(userDataDir, 'logs');
  if (!existsSync(logsDir)) {
    return;
  }
  console.log('\n=== Nameplate log lines about colors ===');
  for (const session of readdirSync(logsDir).sort()) {
    for (const window of readdirSync(join(logsDir, session)).filter((w) =>
      w.startsWith('window'),
    )) {
      const file = join(
        logsDir,
        session,
        window,
        'exthost',
        'rowhitswami.nameplate',
        'Nameplate.log',
      );
      if (!existsSync(file)) {
        continue;
      }
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (/Assigned|Regenerated|Moved|color conflict|Registry|lock/i.test(line)) {
          console.log(`  [${session}/${window}] ${line.slice(11, 240)}`);
        }
      }
    }
  }
}

async function stopInstance() {
  const pattern = userDataDir;
  try {
    execFileSync('pkill', ['-TERM', '-f', pattern]);
  } catch {
    return; // nothing running
  }
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      execFileSync('pgrep', ['-f', pattern]);
    } catch {
      return; // all gone
    }
  }
  try {
    execFileSync('pkill', ['-KILL', '-f', pattern]);
  } catch {
    // already gone
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function oklabDistance(hexA, hexB) {
  const a = oklab(hexA);
  const b = oklab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function oklab(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(n >> 16);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
