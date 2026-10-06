/**
 * The project identity key: the stable string that is hashed into a color.
 *
 * - With a Git remote, the key is `git:<host>/<owner>/<repo>`, so the same
 *   repository gets the same color on every machine. A sub-folder of a
 *   repository (monorepo package) and a linked worktree get their own keys,
 *   because they are opened as separate windows that must look different.
 * - Without a remote, the key is the workspace location.
 */

export type ColorSource = 'auto' | 'path' | 'name';
export type IdentityKeySource = 'repository' | 'path' | 'name';

export interface IdentityKeyInput {
  /** Canonical remote, e.g. `github.com/owner/repo`. */
  readonly remoteCanonical?: string;
  /** Folder path relative to the repository root (`''` at the root). */
  readonly relativePathInRepo?: string;
  /** Name of the linked worktree, if the folder is one. */
  readonly worktreeName?: string;
  /** URI of the primary folder, or of the `.code-workspace` file for saved workspaces. */
  readonly workspaceUri: string;
  /** `.code-workspace` file name without extension, for saved multi-root workspaces. */
  readonly workspaceFileName?: string;
  /** The automatic display name (used for `colorSource: name`). */
  readonly displayName: string;
}

export interface IdentityKey {
  readonly key: string;
  readonly source: IdentityKeySource;
}

export function buildIdentityKey(input: IdentityKeyInput, colorSource: ColorSource): IdentityKey {
  const workspaceSuffix = input.workspaceFileName ? `|workspace:${input.workspaceFileName}` : '';
  switch (colorSource) {
    case 'name':
      return { key: `name:${input.displayName.trim().toLowerCase()}`, source: 'name' };
    case 'path':
      return { key: `path:${input.workspaceUri}`, source: 'path' };
    case 'auto': {
      if (input.remoteCanonical) {
        const subPath = input.relativePathInRepo ? `/${input.relativePathInRepo}` : '';
        const worktree = input.worktreeName ? `@${input.worktreeName}` : '';
        return {
          key: `git:${input.remoteCanonical}${subPath}${worktree}${workspaceSuffix}`,
          source: 'repository',
        };
      }
      return { key: `path:${input.workspaceUri}`, source: 'path' };
    }
  }
}
