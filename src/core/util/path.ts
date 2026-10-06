/**
 * POSIX-style path helpers operating on URI paths (always `/` separated).
 *
 * Nameplate never touches the local file system directly; it works with
 * `Uri.path` strings so that the same code serves local, remote (SSH, WSL,
 * containers) and virtual workspaces.
 */

export function posixBasename(path: string): string {
  const trimmed = stripTrailingSlashes(path);
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function posixDirname(path: string): string {
  const trimmed = stripTrailingSlashes(path);
  const index = trimmed.lastIndexOf('/');
  if (index === -1) {
    return '.';
  }
  if (index === 0) {
    return '/';
  }
  return trimmed.slice(0, index);
}

export function posixJoin(...parts: string[]): string {
  return posixNormalize(parts.filter((p) => p.length > 0).join('/'));
}

/** Resolves `.` and `..` segments and collapses duplicate slashes. */
export function posixNormalize(path: string): string {
  const absolute = path.startsWith('/');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!absolute) {
        segments.push('..');
      }
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join('/');
  if (absolute) {
    return `/${joined}`;
  }
  return joined.length > 0 ? joined : '.';
}

export function isPosixAbsolute(path: string): boolean {
  return path.startsWith('/');
}

/**
 * Relative path from `from` to `to` when `to` is inside `from`.
 * Returns `''` when they are equal and `undefined` when `to` is outside.
 */
export function posixRelativeInside(from: string, to: string): string | undefined {
  const base = stripTrailingSlashes(posixNormalize(from));
  const target = stripTrailingSlashes(posixNormalize(to));
  if (base === target) {
    return '';
  }
  const prefix = base === '/' ? '/' : `${base}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : undefined;
}

/**
 * Converts an OS path as found in Git metadata (`gitdir: C:\x\.git\worktrees\a`)
 * to a URI path. Relative paths are returned unchanged.
 */
export function osPathToUriPath(value: string): string {
  const slashed = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(slashed)) {
    return `/${slashed}`;
  }
  return slashed;
}

function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === '/') {
    end--;
  }
  return path.slice(0, end);
}
