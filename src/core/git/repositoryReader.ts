/**
 * Discovers the Git repository that contains a directory by reading two tiny
 * files (`HEAD` and `config`) through an injected file system. No git binary,
 * no child processes, no dependency on the Git extension: the result is
 * available in milliseconds on the very first activation, which is what makes
 * the automatic color stable from the first frame.
 */
import { posixDirname, posixJoin, posixRelativeInside } from '../util/path';
import {
  isSubmoduleGitDir,
  parseGitDirFile,
  resolveGitPath,
  worktreeNameFromGitDir,
} from './gitDir';
import { parseGitRemotes, type GitRemote } from './gitConfig';
import { parseGitHead, type GitHead } from './gitHead';

export type FileKind = 'file' | 'directory';

export interface GitFileSystem {
  /** Returns the UTF-8 text of a file, or `undefined` if it cannot be read. */
  readText(path: string): Promise<string | undefined>;
  /** Returns the kind of an entry, or `undefined` if it does not exist. */
  stat(path: string): Promise<FileKind | undefined>;
}

export interface GitRepository {
  /** Root of the working tree (the directory that holds `.git`). */
  readonly root: string;
  /** Directory holding `HEAD` for this working tree. */
  readonly gitDir: string;
  /** Directory holding `config` and `info/exclude` (differs from `gitDir` in linked worktrees). */
  readonly commonDir: string;
  readonly head: GitHead;
  readonly remotes: readonly GitRemote[];
  /** Set when the working tree is a linked worktree (`git worktree add`). */
  readonly worktreeName?: string;
  readonly isSubmodule: boolean;
  /** Path of the start directory relative to `root` (`''` when they are equal). */
  readonly relativePath: string;
}

export interface FindRepositoryOptions {
  /** How many parent directories to inspect at most. */
  readonly maxDepth?: number;
}

export async function findGitRepository(
  fs: GitFileSystem,
  startDir: string,
  options: FindRepositoryOptions = {},
): Promise<GitRepository | undefined> {
  const maxDepth = options.maxDepth ?? 16;
  let dir = startDir;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const dotGit = posixJoin(dir, '.git');
    const kind = await fs.stat(dotGit);
    if (kind === 'directory') {
      return readRepository(fs, dir, dotGit, startDir);
    }
    if (kind === 'file') {
      const target = parseGitDirFile(await fs.readText(dotGit));
      if (target) {
        return readRepository(fs, dir, resolveGitPath(dir, target), startDir);
      }
    }
    const parent = posixDirname(dir);
    if (parent === dir || parent === '.') {
      break;
    }
    dir = parent;
  }
  return undefined;
}

async function readRepository(
  fs: GitFileSystem,
  root: string,
  gitDir: string,
  startDir: string,
): Promise<GitRepository> {
  const commonDirValue = await fs.readText(posixJoin(gitDir, 'commondir'));
  const commonDir = commonDirValue?.trim() ? resolveGitPath(gitDir, commonDirValue) : gitDir;
  const [headText, configText] = await Promise.all([
    fs.readText(posixJoin(gitDir, 'HEAD')),
    fs.readText(posixJoin(commonDir, 'config')),
  ]);
  return {
    root,
    gitDir,
    commonDir,
    head: parseGitHead(headText),
    remotes: configText ? parseGitRemotes(configText) : [],
    worktreeName: commonDir !== gitDir ? worktreeNameFromGitDir(gitDir) : undefined,
    isSubmodule: isSubmoduleGitDir(gitDir),
    relativePath: posixRelativeInside(root, startDir) ?? '',
  };
}
