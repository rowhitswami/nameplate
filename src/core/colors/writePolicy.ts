/**
 * Decides whether Nameplate may write color settings into the workspace
 * settings file, and how it keeps them out of Git.
 *
 * Nameplate's color lines never show up in Git. In a local repository that is
 * always possible without asking: a file Nameplate creates is listed in
 * `.git/info/exclude`, and a file that Git tracks gets a
 * local clean filter that hides Nameplate's lines. Only where neither works
 * (a tracked file in a remote window) does Nameplate show the name without the
 * color, unless the user explicitly picks a color.
 */

export type SettingsFileGitStatus =
  /** Untitled workspace: VS Code keeps the settings in its own storage. */
  | 'internal'
  /** The settings file is not inside a Git repository. */
  | 'no-repository'
  /** Inside a repository, but the file does not exist yet (Nameplate would create it). */
  | 'absent'
  /** Exists and is ignored by Git. */
  | 'ignored'
  /** Exists and is not tracked (and not ignored). */
  | 'untracked'
  /** Exists and is tracked: without a filter, writing would show up as a change. */
  | 'tracked'
  /** Exists inside a repository, but whether it is tracked is unknown. */
  | 'unknown';

export type BlockReason = 'tracked' | 'unknown';

export type WriteDecision =
  | {
      readonly kind: 'allow';
      /** List the file in `.git/info/exclude` (only for a file Nameplate creates). */
      readonly exclude: boolean;
      /** Attach the local clean filter that hides Nameplate's lines from Git. */
      readonly filter: boolean;
    }
  | { readonly kind: 'deny'; readonly reason: BlockReason };

export interface WritePolicyInput {
  readonly status: SettingsFileGitStatus;
  /** `nameplate.keepColorsOutOfGit`. */
  readonly keepOutOfGit: boolean;
  /** A local Git clean filter can be installed for the file (local repository). */
  readonly canFilter: boolean;
  /** The write is the direct result of a user action (picking a color, turning coloring on). */
  readonly explicit: boolean;
}

export function decideWrite(input: WritePolicyInput): WriteDecision {
  const allow = (exclude: boolean, filter: boolean): WriteDecision => ({
    kind: 'allow',
    exclude,
    filter,
  });
  if (input.status === 'internal' || input.status === 'no-repository' || !input.keepOutOfGit) {
    return allow(false, false);
  }
  switch (input.status) {
    case 'absent':
      // Excluded so it never shows up; filtered too, in case someone adds it to Git later.
      return allow(true, input.canFilter);
    case 'ignored':
      return allow(false, false);
    case 'untracked':
      return allow(false, input.canFilter);
    case 'tracked':
    case 'unknown':
      if (input.canFilter) {
        return allow(false, true);
      }
      return input.explicit ? allow(false, false) : { kind: 'deny', reason: input.status };
  }
}
