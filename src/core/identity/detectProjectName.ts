/**
 * The automatic project name.
 *
 * Priority (`auto`):
 *   1. the `.code-workspace` file name, when the workspace was saved;
 *   2. the workspace folder name, when it is meaningful (not `app`, `src`, …);
 *   3. branded manifest names (Expo app name, package.json displayName/productName);
 *   4. package names (package.json, pyproject.toml, Cargo.toml, go.mod, …);
 *   5. `<repository> <folder>` when the folder is a generically named
 *      sub-folder of a repository (monorepos);
 *   6. the Git repository name (from the remote URL, then the root directory);
 *   7. the folder name, even if generic.
 *
 * Whatever wins, if another source spells the same name with deliberate
 * casing (`BrightDesk` for a folder called `brightdesk`), that spelling is used.
 */
import { canonicalName, hasDistinctiveCasing } from './formatName';
import { isGenericName } from './genericNames';

export type NameSource =
  'workspace-file' | 'folder' | 'folder-in-repository' | 'manifest' | 'repository' | 'fallback';

export type NamePreference = 'auto' | 'folder' | 'manifest' | 'repository';

export interface NameCandidates {
  /** `.code-workspace` file name without extension (saved multi-root workspaces). */
  readonly workspaceFileName?: string;
  /** Name of the primary workspace folder. */
  readonly folderName?: string;
  /** Human-facing names from manifests: Expo app name, displayName, productName. */
  readonly manifestDisplayNames?: readonly string[];
  /** Package names from manifests (package.json, pyproject.toml, Cargo.toml, go.mod, …). */
  readonly manifestNames?: readonly string[];
  /** Repository name from the Git remote URL. */
  readonly repositoryName?: string;
  /** Name of the directory that contains `.git`. */
  readonly repositoryDirName?: string;
  /** Path of the folder inside the repository (`''` at the root). */
  readonly relativePathInRepo?: string;
}

export interface DetectedName {
  readonly raw: string;
  readonly source: NameSource;
}

export const FALLBACK_NAME = 'Untitled';

export function detectProjectName(
  candidates: NameCandidates,
  preference: NamePreference = 'auto',
): DetectedName {
  const detected = preferred(candidates, preference) ?? automatic(candidates);
  return { ...detected, raw: upgradeCasing(detected.raw, candidates) };
}

function preferred(c: NameCandidates, preference: NamePreference): DetectedName | undefined {
  switch (preference) {
    case 'auto':
      return undefined;
    case 'folder':
      return c.folderName ? { raw: c.folderName, source: 'folder' } : undefined;
    case 'manifest':
      return (
        firstMeaningful(c.manifestDisplayNames, 'manifest') ??
        firstMeaningful(c.manifestNames, 'manifest')
      );
    case 'repository': {
      const repo = meaningful(c.repositoryName) ?? meaningful(c.repositoryDirName);
      if (!repo) {
        return undefined;
      }
      if (c.relativePathInRepo && c.folderName) {
        return { raw: `${repo} ${c.folderName}`, source: 'folder-in-repository' };
      }
      return { raw: repo, source: 'repository' };
    }
  }
}

function automatic(c: NameCandidates): DetectedName {
  const workspaceFile = meaningful(c.workspaceFileName);
  if (workspaceFile) {
    return { raw: workspaceFile, source: 'workspace-file' };
  }
  const folder = meaningful(c.folderName);
  if (folder) {
    return { raw: folder, source: 'folder' };
  }
  const manifest =
    firstMeaningful(c.manifestDisplayNames, 'manifest') ??
    firstMeaningful(c.manifestNames, 'manifest');
  if (manifest) {
    return manifest;
  }
  const repo = meaningful(c.repositoryName) ?? meaningful(c.repositoryDirName);
  if (repo && c.relativePathInRepo && c.folderName) {
    return { raw: `${repo} ${c.folderName}`, source: 'folder-in-repository' };
  }
  if (repo) {
    return { raw: repo, source: 'repository' };
  }
  if (c.folderName) {
    return { raw: c.folderName, source: 'folder' };
  }
  if (c.workspaceFileName) {
    return { raw: c.workspaceFileName, source: 'workspace-file' };
  }
  return { raw: FALLBACK_NAME, source: 'fallback' };
}

/**
 * If the chosen name has no casing information, adopt the spelling of any
 * other source that is the same name with deliberate mixed casing.
 */
export function upgradeCasing(raw: string, c: NameCandidates): string {
  if (hasDistinctiveCasing(raw)) {
    return raw;
  }
  const target = canonicalName(raw);
  if (target.length === 0) {
    return raw;
  }
  const sources = [
    ...(c.manifestDisplayNames ?? []),
    ...(c.manifestNames ?? []),
    c.repositoryName,
    c.repositoryDirName,
    c.folderName,
    c.workspaceFileName,
  ];
  for (const candidate of sources) {
    if (candidate && hasDistinctiveCasing(candidate) && canonicalName(candidate) === target) {
      return candidate;
    }
  }
  return raw;
}

function meaningful(name: string | undefined): string | undefined {
  return name && !isGenericName(name) ? name.trim() : undefined;
}

function firstMeaningful(
  names: readonly string[] | undefined,
  source: NameSource,
): DetectedName | undefined {
  for (const name of names ?? []) {
    const value = meaningful(name);
    if (value) {
      return { raw: value, source };
    }
  }
  return undefined;
}
