/**
 * Git facts for a workspace folder, read from `.git` metadata through the VS
 * Code file system, plus file watchers on `HEAD` and `config` so branch and
 * remote changes are picked up live without polling or spawning git.
 */
import * as vscode from 'vscode';
import { selectPrimaryRemote } from '../core/git/gitConfig';
import { describeGitHead } from '../core/git/gitHead';
import { parseRemoteUrl } from '../core/git/remoteUrl';
import { findGitRepository } from '../core/git/repositoryReader';
import type { Logger } from '../logging/logger';
import type { GitSnapshot } from '../model';
import { gitFileSystemFor, uriWithPath } from '../workspace/fileAccess';

export class GitService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private watchers: vscode.Disposable[] = [];
  private watchedKey: string | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Fires (debounced) when HEAD, the config or the `.git` entry of the watched folder changed. */
  readonly onDidChange: vscode.Event<void> = this.changeEmitter.event;

  constructor(private readonly logger: Logger) {}

  async read(folder: vscode.Uri): Promise<GitSnapshot | undefined> {
    const started = Date.now();
    try {
      const repo = await findGitRepository(gitFileSystemFor(folder), folder.path);
      if (!repo) {
        this.watch(folder, undefined, undefined);
        this.logger.debug(
          `No Git repository found for ${folder.toString()} (${Date.now() - started} ms)`,
        );
        return undefined;
      }
      const gitDirUri = uriWithPath(folder, repo.gitDir);
      const commonDirUri = uriWithPath(folder, repo.commonDir);
      this.watch(folder, gitDirUri, commonDirUri);
      const primaryRemote = selectPrimaryRemote(repo.remotes);
      const remote = primaryRemote ? parseRemoteUrl(primaryRemote.url) : undefined;
      this.logger.debug(
        `Git repository ${repo.root} (branch: ${describeGitHead(repo.head) ?? '?'}, remote: ${remote?.canonical ?? 'none'}, ${Date.now() - started} ms)`,
      );
      return {
        rootUri: uriWithPath(folder, repo.root),
        gitDirUri,
        commonDirUri,
        relativePath: repo.relativePath,
        headLabel: describeGitHead(repo.head),
        branch: repo.head.kind === 'branch' ? repo.head.name : undefined,
        remoteName: primaryRemote?.name,
        remote,
        worktreeName: repo.worktreeName,
        isSubmodule: repo.isSubmodule,
      };
    } catch (error) {
      this.logger.error('Reading Git metadata failed', error);
      return undefined;
    }
  }

  private watch(
    folder: vscode.Uri,
    gitDir: vscode.Uri | undefined,
    commonDir: vscode.Uri | undefined,
  ): void {
    const key = `${folder.toString()}|${gitDir?.toString() ?? ''}|${commonDir?.toString() ?? ''}`;
    if (key === this.watchedKey) {
      return;
    }
    this.disposeWatchers();
    this.watchedKey = key;
    const patterns: vscode.RelativePattern[] = [new vscode.RelativePattern(folder, '.git')];
    if (gitDir) {
      patterns.push(new vscode.RelativePattern(gitDir, 'HEAD'));
    }
    if (commonDir) {
      patterns.push(new vscode.RelativePattern(commonDir, 'config'));
    }
    for (const pattern of patterns) {
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(() => this.scheduleChange());
        watcher.onDidCreate(() => this.scheduleChange());
        watcher.onDidDelete(() => this.scheduleChange());
        this.watchers.push(watcher);
      } catch (error) {
        this.logger.warn(
          `Could not watch ${pattern.baseUri.toString()}/${pattern.pattern}: ${String(error)}`,
        );
      }
    }
  }

  private scheduleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.changeEmitter.fire();
    }, 300);
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.disposeWatchers();
    this.changeEmitter.dispose();
  }
}
