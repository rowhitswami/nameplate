/**
 * Optional bridge to VS Code's built-in Git extension API. It is used for the
 * two things `.git` metadata cannot answer cheaply: whether a file is tracked
 * or ignored, and the working tree status. Everything degrades gracefully when
 * the API is unavailable (Git disabled, git not installed, or the extension
 * running in the UI host of a remote window).
 */
import * as vscode from 'vscode';
import type { Logger } from '../logging/logger';
import { withTimeout } from '../util/async';

// Minimal subset of extensions/git/src/api/git.d.ts.
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  readonly git: { readonly path: string };
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly indexChanges: readonly unknown[];
    readonly workingTreeChanges: readonly unknown[];
    readonly mergeChanges: readonly unknown[];
    readonly untrackedChanges?: readonly unknown[];
  };
  getObjectDetails(treeish: string, path: string): Promise<unknown>;
  checkIgnore(paths: string[]): Promise<Set<string>>;
}

export interface WorkingTreeSummary {
  readonly changes: number;
}

export class GitExtensionBridge {
  private apiPromise: Promise<GitApi | undefined> | undefined;
  private gitPathPromise: Promise<string> | undefined;

  constructor(private readonly logger: Logger) {}

  /** Resolves the Git API once it finished its initial repository scan, or `undefined`. */
  whenReady(timeoutMs = 6000): Promise<GitApi | undefined> {
    this.apiPromise ??= this.load();
    return withTimeout(this.apiPromise, timeoutMs);
  }

  private async load(): Promise<GitApi | undefined> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!extension) {
        this.logger.debug('Built-in Git extension not available in this extension host');
        return undefined;
      }
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (!exports.enabled) {
        this.logger.debug('Built-in Git extension is disabled');
        return undefined;
      }
      const api = exports.getAPI(1);
      if (api.state !== 'initialized') {
        await new Promise<void>((resolve) => {
          const subscription = api.onDidChangeState((state) => {
            if (state === 'initialized') {
              subscription.dispose();
              resolve();
            }
          });
        });
      }
      return api;
    } catch (error) {
      this.logger.debug(`Git extension API unavailable: ${String(error)}`);
      return undefined;
    }
  }

  /** The git executable the Git extension uses (honours `git.path`), or plain `git`. Resolved once. */
  gitPath(): Promise<string> {
    this.gitPathPromise ??= this.whenReady(3000).then(
      (api) => api?.git.path ?? 'git',
      () => 'git',
    );
    return this.gitPathPromise;
  }

  private async repositoryFor(uri: vscode.Uri): Promise<GitRepository | undefined> {
    const api = await this.whenReady();
    return api?.getRepository(uri) ?? undefined;
  }

  /** `true`/`false` when Git could tell, `undefined` when it could not be determined. */
  async isTracked(file: vscode.Uri): Promise<boolean | undefined> {
    const repository = await this.repositoryFor(file);
    if (!repository) {
      return undefined;
    }
    try {
      await repository.getObjectDetails('', file.fsPath);
      return true;
    } catch {
      return false;
    }
  }

  async isIgnored(file: vscode.Uri): Promise<boolean | undefined> {
    const repository = await this.repositoryFor(file);
    if (!repository) {
      return undefined;
    }
    try {
      const ignored = await repository.checkIgnore([file.fsPath]);
      return ignored.size > 0;
    } catch {
      return undefined;
    }
  }

  async workingTree(folder: vscode.Uri): Promise<WorkingTreeSummary | undefined> {
    const repository = await this.repositoryFor(folder);
    if (!repository) {
      return undefined;
    }
    const { indexChanges, workingTreeChanges, mergeChanges, untrackedChanges } = repository.state;
    return {
      changes:
        indexChanges.length +
        workingTreeChanges.length +
        mergeChanges.length +
        (untrackedChanges?.length ?? 0),
    };
  }
}
