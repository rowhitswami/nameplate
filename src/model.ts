/**
 * The shared read model: everything the UI needs to know about the current
 * window's project. Produced by the controller, consumed by the status bar
 * item, the actions menu and the project information view.
 */
import type * as vscode from 'vscode';
import type { StatusBarTheme } from './core/colors/statusBarTheme';
import type { BlockReason } from './core/colors/writePolicy';
import type { ParsedRemote } from './core/git/remoteUrl';
import type { NameSource } from './core/identity/detectProjectName';
import type { IdentityKeySource } from './core/identity/identityKey';
import type { ProjectType } from './core/identity/projectType';

export interface WorkspaceDescriptor {
  readonly kind: 'none' | 'folder' | 'multi-root';
  readonly folders: readonly vscode.WorkspaceFolder[];
  /** The folder that defines the window's identity (the first one). */
  readonly primary?: vscode.WorkspaceFolder;
  /** The saved `.code-workspace` file, if the workspace was saved to one. */
  readonly workspaceFile?: vscode.Uri;
  readonly isUntitledWorkspace: boolean;
  /** `.code-workspace` file name without extension. */
  readonly workspaceFileName?: string;
}

export interface GitSnapshot {
  readonly rootUri: vscode.Uri;
  readonly gitDirUri: vscode.Uri;
  readonly commonDirUri: vscode.Uri;
  /** Folder path relative to the repository root (`''` at the root). */
  readonly relativePath: string;
  /** Branch name, `abc1234 (detached)` or a ref. */
  readonly headLabel?: string;
  readonly branch?: string;
  readonly remoteName?: string;
  readonly remote?: ParsedRemote;
  readonly worktreeName?: string;
  readonly isSubmodule: boolean;
}

export interface IdentitySnapshot {
  readonly key: string;
  readonly keySource: IdentityKeySource;
  /** Raw automatic name before formatting. */
  readonly detectedRaw: string;
  readonly detectedSource: NameSource;
  /** Formatted automatic name. */
  readonly detectedName: string;
  readonly customName?: string;
  /** What is shown in the status bar (custom or detected, formatted). */
  readonly displayName: string;
  readonly label?: string;
  readonly projectType?: ProjectType;
}

export interface ColorSnapshot {
  /** The pinned automatic color. */
  readonly auto: string;
  readonly custom?: string;
  readonly active: string;
  readonly source: 'auto' | 'custom';
  readonly theme: StatusBarTheme;
}

export type ColoringStatus =
  /** Nameplate wrote the color and still owns the keys. */
  | { readonly kind: 'active' }
  /** Coloring is turned off. */
  | { readonly kind: 'off'; readonly reason: 'setting' | 'workspace' }
  /** Someone else set status bar colors in the workspace; Nameplate stands down. */
  | { readonly kind: 'external'; readonly conflicts: readonly string[] }
  /** Not colored: the color could not be kept out of Git (e.g. a tracked file in a remote window). */
  | { readonly kind: 'blocked'; readonly reason: BlockReason; readonly file: string }
  /** Writing the settings failed; the name is still shown. */
  | { readonly kind: 'error'; readonly message: string }
  /** Color work has not finished yet. */
  | { readonly kind: 'pending' };

export interface SettingsTarget {
  readonly kind: 'folder-settings' | 'workspace-file' | 'internal';
  readonly uri?: vscode.Uri;
  /** Short label for messages, e.g. `.vscode/settings.json`. */
  readonly label: string;
}

export interface ProjectSnapshot {
  readonly workspace: WorkspaceDescriptor;
  readonly identity: IdentitySnapshot;
  readonly git?: GitSnapshot;
  readonly color?: ColorSnapshot;
  readonly coloring: ColoringStatus;
  readonly settingsTarget: SettingsTarget;
  /** `[Theme]` selectors in the effective customizations that override the managed keys. */
  readonly themeOverrides: readonly string[];
}
