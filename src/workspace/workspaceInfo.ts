import * as vscode from 'vscode';
import { posixBasename } from '../core/util/path';
import type { SettingsTarget, WorkspaceDescriptor } from '../model';

export function describeWorkspace(): WorkspaceDescriptor {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const workspaceFile = vscode.workspace.workspaceFile;
  const isUntitledWorkspace = workspaceFile?.scheme === 'untitled';
  const savedWorkspaceFile = workspaceFile && !isUntitledWorkspace ? workspaceFile : undefined;
  const workspaceFileName = savedWorkspaceFile
    ? posixBasename(savedWorkspaceFile.path).replace(/\.code-workspace$/i, '')
    : undefined;
  if (folders.length === 0) {
    return { kind: 'none', folders, isUntitledWorkspace: isUntitledWorkspace === true };
  }
  return {
    kind: folders.length > 1 || workspaceFile ? 'multi-root' : 'folder',
    folders,
    primary: folders[0],
    workspaceFile: savedWorkspaceFile,
    isUntitledWorkspace: isUntitledWorkspace === true,
    workspaceFileName,
  };
}

/** Where VS Code stores workspace-level settings for this window. */
export function settingsTargetFor(workspace: WorkspaceDescriptor): SettingsTarget {
  if (workspace.workspaceFile) {
    return {
      kind: 'workspace-file',
      uri: workspace.workspaceFile,
      label: posixBasename(workspace.workspaceFile.path),
    };
  }
  if (workspace.isUntitledWorkspace || !workspace.primary) {
    return { kind: 'internal', label: 'the untitled workspace' };
  }
  return {
    kind: 'folder-settings',
    uri: vscode.Uri.joinPath(workspace.primary.uri, '.vscode', 'settings.json'),
    label: '.vscode/settings.json',
  };
}
