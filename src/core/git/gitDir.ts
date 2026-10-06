/**
 * Helpers for `.git` files (linked worktrees and submodules point to their real
 * git directory through a one-line `gitdir: <path>` file).
 */
import { isPosixAbsolute, osPathToUriPath, posixJoin, posixNormalize } from '../util/path';

/** Extracts the target of a `gitdir: <path>` file. */
export function parseGitDirFile(text: string | undefined): string | undefined {
  const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(text ?? '');
  return match?.[1];
}

/** Resolves a (possibly relative, possibly Windows-style) path found in Git metadata. */
export function resolveGitPath(baseDir: string, value: string): string {
  const converted = osPathToUriPath(value.trim());
  if (isPosixAbsolute(converted)) {
    return posixNormalize(converted);
  }
  return posixJoin(baseDir, converted);
}

/** `/repo/.git/worktrees/feature-x` → `feature-x`. */
export function worktreeNameFromGitDir(gitDir: string): string | undefined {
  const match = /\/worktrees\/([^/]+)\/?$/.exec(gitDir);
  return match?.[1];
}

/** `/super/.git/modules/lib` → true. */
export function isSubmoduleGitDir(gitDir: string): boolean {
  return /\/\.git\/modules\//.test(`${gitDir}/`);
}
