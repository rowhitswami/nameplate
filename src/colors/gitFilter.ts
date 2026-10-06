/**
 * Keeps Nameplate's color lines out of Git for settings files inside a local
 * repository, without changing anything that is committed:
 *
 * - `<global storage>/git/clean.sh` + `clean-filter.js`: the filter program,
 *   run on VS Code's own Node runtime (no Node installation needed);
 * - `.git/config` → `filter.nameplate.clean`: registers the filter (local only);
 * - `.git/info/attributes`: attaches it to the settings file (local only);
 * - `.git/nameplate-colors.json`: which keys Nameplate wrote, for the filter.
 *
 * Git then sees the settings file exactly as it would be without Nameplate:
 * no changes in `git status`/`git diff`, nothing to commit, while the user's own
 * edits to the file show up as usual. Every entry is removed again when
 * Nameplate stops coloring the project.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CLEAN_RECORD_FILE_NAME, type CleanRecord } from '../core/git/cleanSettings';
import {
  addAttributesBlock,
  FILTER_NAME,
  hasNameplateAttributes,
  removeAttributesBlock,
} from '../core/git/gitExclude';
import type { Logger } from '../logging/logger';

export interface LocalRepository {
  /** Working tree root (file system path). */
  readonly root: string;
  /** Git directory of this working tree (differs from `commonDir` in linked worktrees). */
  readonly gitDir: string;
  /** Shared git directory holding `config` and `info/`. */
  readonly commonDir: string;
}

interface RecordFile {
  readonly version: 1;
  readonly files: Record<string, CleanRecord>;
}

const CONFIG_KEY = `filter.${FILTER_NAME}.clean`;
const execFileAsync = promisify(execFile);

export class GitFilter {
  private readonly filterDir: string;
  private prepared: Promise<boolean> | undefined;
  /** What was last installed per settings file, to skip redundant work on every refresh. */
  private readonly installed = new Map<string, string>();

  constructor(
    storageDir: string,
    private readonly filterSource: string,
    private readonly runtime: string,
    private readonly gitPath: () => Promise<string>,
    private readonly logger: Logger,
  ) {
    this.filterDir = join(storageDir, 'git');
  }

  /**
   * Makes sure Git hides Nameplate's keys in the file. Returns false when that
   * is not possible (no git, read-only repository, ...).
   */
  async protect(
    repo: LocalRepository,
    relativePath: string,
    record: CleanRecord,
  ): Promise<boolean> {
    const id = `${repo.gitDir}|${relativePath}`;
    const signature = JSON.stringify(record);
    if (this.installed.get(id) === signature) {
      return true;
    }
    try {
      if (!(await this.prepare())) {
        return false;
      }
      await this.writeRecord(repo, relativePath, record);
      await this.editAttributes(repo, (text) => addAttributesBlock(text, relativePath));
      const command = this.filterCommand();
      const current = await this.git(repo, ['config', '--local', '--get', CONFIG_KEY]).catch(
        () => '',
      );
      if (current.trim() !== command) {
        await this.git(repo, ['config', '--local', CONFIG_KEY, command]);
      }
      this.installed.set(id, signature);
      this.logger.info(`Git will not see Nameplate's colors in ${relativePath} (${repo.root})`);
      return true;
    } catch (error) {
      this.logger.warn(`Could not set up the Git filter for ${relativePath}: ${String(error)}`);
      return false;
    }
  }

  /** Removes everything `protect` added for the file. */
  async unprotect(repo: LocalRepository, relativePath: string): Promise<void> {
    this.installed.delete(`${repo.gitDir}|${relativePath}`);
    try {
      await this.removeRecord(repo, relativePath);
      const remaining = await this.editAttributes(repo, (text) =>
        removeAttributesBlock(text, relativePath),
      );
      if (!hasNameplateAttributes(remaining)) {
        await this.git(repo, [
          'config',
          '--local',
          '--remove-section',
          `filter.${FILTER_NAME}`,
        ]).catch(() => undefined);
      }
      // Git trusts its cached "unchanged" result until a file's size or time
      // changes. Touch the file so Git looks at it again without the filter.
      const now = new Date();
      await utimes(join(repo.root, relativePath), now, now).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`Could not remove the Git filter for ${relativePath}: ${String(error)}`);
    }
  }

  /**
   * Git caches file sizes and reports a file as modified when its size changed,
   * without asking the filter. When the filtered content is unchanged
   * (`git diff --quiet`), `git add -u` refreshes that cache; it stages nothing
   * new and never adds untracked files.
   */
  async refreshIndex(repo: LocalRepository, relativePath: string): Promise<void> {
    try {
      await this.git(repo, ['diff', '--quiet', '--', relativePath]);
    } catch {
      return; // real changes (exit 1): leave the index alone
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.git(repo, ['add', '-u', '--', relativePath]);
        return;
      } catch (error) {
        const { stderr } = error as { stderr?: unknown };
        if (typeof stderr !== 'string' || !stderr.includes('index.lock')) {
          return; // e.g. the file is not tracked: nothing to refresh
        }
        // Another git process (VS Code's Git extension) holds the index: try again shortly.
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  /** The command stored in `.git/config`; falls back to `cat` if the filter was deleted. */
  filterCommand(): string {
    const script = shellQuote(toShellPath(join(this.filterDir, 'clean.sh')));
    return `f=${script}; if [ -f "$f" ]; then sh "$f" %f; else cat; fi`;
  }

  private prepare(): Promise<boolean> {
    this.prepared ??= (async () => {
      try {
        await mkdir(this.filterDir, { recursive: true });
        const script = join(this.filterDir, 'clean-filter.js');
        await writeIfChanged(script, await readFile(this.filterSource, 'utf8'));
        await writeIfChanged(join(this.filterDir, 'clean.sh'), wrapperScript(script, this.runtime));
        return true;
      } catch (error) {
        this.logger.warn(`Could not install the Git filter program: ${String(error)}`);
        return false;
      }
    })();
    return this.prepared;
  }

  private async writeRecord(
    repo: LocalRepository,
    relativePath: string,
    record: CleanRecord,
  ): Promise<void> {
    const file = join(repo.gitDir, CLEAN_RECORD_FILE_NAME);
    const data = await readRecordFile(file);
    data.files[relativePath] = record;
    await writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  private async removeRecord(repo: LocalRepository, relativePath: string): Promise<void> {
    const file = join(repo.gitDir, CLEAN_RECORD_FILE_NAME);
    const data = await readRecordFile(file);
    if (!(relativePath in data.files)) {
      return;
    }
    delete data.files[relativePath];
    if (Object.keys(data.files).length === 0) {
      await rm(file, { force: true });
    } else {
      await writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
    }
  }

  private async editAttributes(
    repo: LocalRepository,
    edit: (text: string) => string,
  ): Promise<string> {
    const file = join(repo.commonDir, 'info', 'attributes');
    const current = await readFile(file, 'utf8').catch(() => '');
    const next = edit(current);
    if (next !== current) {
      await mkdir(dirname(file), { recursive: true });
      await writeAtomic(file, next);
    }
    return next;
  }

  private async git(repo: LocalRepository, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(await this.gitPath(), ['-C', repo.root, ...args], {
      timeout: 15_000,
      windowsHide: true,
    });
    return stdout;
  }
}

/** The shell script Git runs; it prefers VS Code's own Node runtime. */
export function wrapperScript(script: string, runtime: string): string {
  return [
    '#!/bin/sh',
    "# Nameplate (VS Code extension): Git clean filter that keeps Nameplate's status bar",
    '# colors out of Git. Registered in the .git/config and .git/info/attributes of the',
    '# repositories Nameplate colors, and removed from them when Nameplate stops.',
    `script=${shellQuote(toShellPath(script))}`,
    `runtime=${shellQuote(toShellPath(runtime))}`,
    'if [ -f "$script" ]; then',
    '  if [ -x "$runtime" ]; then',
    '    ELECTRON_RUN_AS_NODE=1 exec "$runtime" "$script" "$@"',
    '  fi',
    '  if command -v node >/dev/null 2>&1; then',
    '    exec node "$script" "$@"',
    '  fi',
    'fi',
    'exec cat',
    '',
  ].join('\n');
}

/** Single-quotes a value for POSIX sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Git for Windows runs filters with its bundled sh, which understands `C:/...` paths. */
export function toShellPath(path: string): string {
  return path.replace(/\\/g, '/');
}

async function readRecordFile(file: string): Promise<RecordFile> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<RecordFile>;
    if (parsed.version === 1 && parsed.files && typeof parsed.files === 'object') {
      return { version: 1, files: { ...parsed.files } };
    }
  } catch {
    // missing or corrupt: start over
  }
  return { version: 1, files: {} };
}

async function writeIfChanged(file: string, content: string): Promise<void> {
  const current = await readFile(file, 'utf8').catch(() => undefined);
  if (current !== content) {
    await writeAtomic(file, content);
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}
