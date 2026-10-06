/**
 * Knows how the workspace settings file relates to Git and keeps Nameplate's
 * color lines out of it: a file Nameplate creates is listed in the
 * repository's local exclude file, and in local repositories a clean filter
 * hides Nameplate's lines from Git (see `gitFilter.ts`).
 */
import * as vscode from 'vscode';
import type { OwnershipRecord } from '../core/colors/colorCustomizations';
import type { SettingsFileGitStatus } from '../core/colors/writePolicy';
import { SETTINGS_JSON_PATH, WORKSPACE_FILE_JSON_PATH } from '../core/git/cleanSettings';
import { addExcludeBlock, removeExcludeBlock, toExcludePattern } from '../core/git/gitExclude';
import { findGitRepository } from '../core/git/repositoryReader';
import { posixDirname, posixRelativeInside } from '../core/util/path';
import type { WorkspaceStateStore } from '../configuration/persistence';
import type { GitExtensionBridge } from '../git/gitExtension';
import type { Logger } from '../logging/logger';
import type { SettingsTarget } from '../model';
import {
  exists,
  gitFileSystemFor,
  readTextFile,
  uriWithPath,
  writeTextFile,
} from '../workspace/fileAccess';
import type { GitFilter, LocalRepository } from './gitFilter';

export interface SettingsFileClassification {
  readonly status: SettingsFileGitStatus;
  readonly exists: boolean;
  readonly uri?: vscode.Uri;
  /** The repository's common git dir (holds `info/exclude`), when inside a repository. */
  readonly commonDirUri?: vscode.Uri;
  /** Path of the settings file relative to the repository root. */
  readonly relativePath?: string;
  /** Set for repositories on the local disk, where the Git filter can be installed. */
  readonly local?: LocalRepository;
  readonly jsonPath: readonly string[];
}

export class SettingsFileGuard {
  /** Settings files whose Git index entry was refreshed in this session. */
  private readonly refreshed = new Set<string>();

  constructor(
    private readonly gitExtension: GitExtensionBridge,
    private readonly gitFilter: GitFilter | undefined,
    private readonly state: WorkspaceStateStore,
    private readonly logger: Logger,
  ) {}

  /** Whether a clean filter can be installed for the classified file. */
  canFilter(classification: SettingsFileClassification): boolean {
    return this.gitFilter !== undefined && classification.local !== undefined;
  }

  async classify(target: SettingsTarget): Promise<SettingsFileClassification> {
    const jsonPath =
      target.kind === 'workspace-file' ? WORKSPACE_FILE_JSON_PATH : SETTINGS_JSON_PATH;
    if (target.kind === 'internal' || !target.uri) {
      return { status: 'internal', exists: false, jsonPath };
    }
    const uri = target.uri;
    const fileExists = await exists(uri);
    const repo = await findGitRepository(gitFileSystemFor(uri), posixDirname(uri.path));
    if (!repo) {
      return { status: 'no-repository', exists: fileExists, uri, jsonPath };
    }
    const commonDirUri = uriWithPath(uri, repo.commonDir);
    const relativePath = posixRelativeInside(repo.root, uri.path) ?? '';
    const base = { exists: fileExists, uri, commonDirUri, relativePath, jsonPath };

    if (uri.scheme === 'file') {
      // Local repository: the filter hides Nameplate's lines whether or not the
      // file is tracked, so there is no need to ask the Git extension.
      const local: LocalRepository = {
        root: uriWithPath(uri, repo.root).fsPath,
        gitDir: uriWithPath(uri, repo.gitDir).fsPath,
        commonDir: commonDirUri.fsPath,
      };
      return { ...base, local, status: fileExists ? 'unknown' : 'absent' };
    }
    if (uri.scheme !== 'vscode-remote') {
      // Virtual file systems: be conservative.
      return { ...base, status: fileExists ? 'unknown' : 'absent' };
    }
    const tracked = await this.gitExtension.isTracked(uri);
    if (tracked === true) {
      return { ...base, status: 'tracked' };
    }
    if (!fileExists) {
      return { ...base, status: 'absent' };
    }
    if (tracked === false) {
      const ignored = await this.gitExtension.isIgnored(uri);
      return { ...base, status: ignored ? 'ignored' : 'untracked' };
    }
    return { ...base, status: 'unknown' };
  }

  /**
   * Makes Git blind to the color lines described by `record` before they are
   * written. Returns false when that is not possible.
   */
  async protect(
    classification: SettingsFileClassification,
    record: OwnershipRecord,
  ): Promise<boolean> {
    const { local, relativePath } = classification;
    if (!this.gitFilter || !local || !relativePath) {
      return false;
    }
    const previous = this.state.get().gitFilter;
    if (previous && (previous.gitDir !== local.gitDir || previous.relativePath !== relativePath)) {
      await this.removeFilter(); // the window now uses another settings file
    }
    const ok = await this.gitFilter.protect(local, relativePath, {
      jsonPath: classification.jsonPath,
      applied: record.applied,
      previous: record.previous,
      containerExisted: record.containerExisted,
    });
    if (ok) {
      await this.state.update({ gitFilter: { ...local, relativePath } });
    }
    return ok;
  }

  /**
   * Lets Git notice that, filtered, nothing changed. Needed after every write
   * (`force`) and once per session for colors written before the filter existed.
   */
  async refreshIndex(classification: SettingsFileClassification, force: boolean): Promise<void> {
    const { local, relativePath } = classification;
    if (!this.gitFilter || !local || !relativePath) {
      return;
    }
    const id = `${local.gitDir}|${relativePath}`;
    if (!force && this.refreshed.has(id)) {
      return;
    }
    this.refreshed.add(id);
    await this.gitFilter.refreshIndex(local, relativePath);
  }

  /** Removes the Git filter Nameplate installed for this workspace, if any. Never throws. */
  async removeFilter(): Promise<void> {
    const installed = this.state.get().gitFilter;
    if (!installed || !this.gitFilter) {
      return;
    }
    const { relativePath, ...repo } = installed;
    await this.gitFilter.unprotect(repo, relativePath);
    await this.state.update({ gitFilter: undefined });
    this.logger.info(`Removed the Git filter for ${relativePath}`);
  }

  /** Adds the settings file to `.git/info/exclude` and remembers it. Never throws. */
  async addLocalExclude(classification: SettingsFileClassification): Promise<void> {
    const { uri, commonDirUri, relativePath } = classification;
    if (!uri || !commonDirUri || !relativePath) {
      return;
    }
    try {
      if (await this.gitExtension.isIgnored(uri)) {
        this.logger.debug(`${relativePath} is already ignored by Git; no local exclude needed`);
        return;
      }
      const excludeUri = vscode.Uri.joinPath(commonDirUri, 'info', 'exclude');
      const pattern = toExcludePattern(relativePath);
      const current = (await readTextFile(excludeUri)) ?? '';
      const next = addExcludeBlock(current, pattern);
      if (next !== current) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(commonDirUri, 'info'));
        await writeTextFile(excludeUri, next);
        this.logger.info(`Added ${pattern} to ${excludeUri.path}`);
      }
      await this.state.update({ excludePattern: pattern, excludeFileUri: excludeUri.toString() });
    } catch (error) {
      this.logger.warn(`Could not update the local Git exclude file: ${String(error)}`);
    }
  }

  /**
   * Undoes what Nameplate did to the repository: deletes the settings file if
   * Nameplate created it and it is empty again, removes the exclude entry and
   * the Git filter.
   */
  async cleanup(target: SettingsTarget): Promise<void> {
    const state = this.state.get();
    try {
      if (state.gitFilter && this.gitFilter) {
        const { relativePath, ...repo } = state.gitFilter;
        await this.gitFilter.refreshIndex(repo, relativePath);
        await this.gitFilter.unprotect(repo, relativePath);
        this.logger.info(`Removed the Git filter for ${relativePath}`);
      }
      if (state.createdSettingsFile && target.kind === 'folder-settings' && target.uri) {
        const text = await readTextFile(target.uri);
        if (text !== undefined && isEmptyJsonObject(text)) {
          await vscode.workspace.fs.delete(target.uri, { useTrash: false });
          this.logger.info(
            `Deleted ${target.label}, which Nameplate had created and which was empty`,
          );
          const dir = vscode.Uri.joinPath(target.uri, '..');
          if ((await vscode.workspace.fs.readDirectory(dir)).length === 0) {
            await vscode.workspace.fs.delete(dir, { useTrash: false });
          }
        }
      }
      if (state.excludePattern && state.excludeFileUri) {
        const excludeUri = vscode.Uri.parse(state.excludeFileUri);
        const current = await readTextFile(excludeUri);
        if (current !== undefined) {
          const next = removeExcludeBlock(current, state.excludePattern);
          if (next !== current) {
            await writeTextFile(excludeUri, next);
            this.logger.info(`Removed ${state.excludePattern} from ${excludeUri.path}`);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Cleanup of the settings file failed: ${String(error)}`);
    } finally {
      await this.state.update({
        createdSettingsFile: undefined,
        excludePattern: undefined,
        excludeFileUri: undefined,
        gitFilter: undefined,
      });
    }
  }
}

function isEmptyJsonObject(text: string): boolean {
  return /^\s*\{\s*\}\s*$/.test(text);
}
