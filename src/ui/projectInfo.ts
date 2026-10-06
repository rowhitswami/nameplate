/**
 * "Project Information": a QuickPick of facts about the current project.
 * Selecting a row copies its value. Only known values are listed; nothing is
 * guessed.
 */
import * as vscode from 'vscode';
import { showNoProjectMessage } from './messages';
import { formatContrast } from '../core/colors/contrast';
import { describeColor } from '../core/colors/palette';
import type { NameplateController } from '../controller';
import type { GitExtensionBridge } from '../git/gitExtension';
import { displayPath } from '../workspace/fileAccess';
import { describeColoringStatus } from './statusBar';

interface InfoItem extends vscode.QuickPickItem {
  readonly value?: string;
  readonly copyAll?: boolean;
}

export async function showProjectInformation(
  controller: NameplateController,
  gitExtension: GitExtensionBridge,
  homeDir: string | undefined,
): Promise<void> {
  const snapshot = controller.snapshot;
  if (!snapshot) {
    showNoProjectMessage();
    return;
  }
  const { identity, git, color, coloring, workspace, settingsTarget, themeOverrides } = snapshot;
  const rows: [string, string | undefined][] = [];

  rows.push(['Display name', identity.displayName]);
  rows.push([
    'Detected name',
    `${identity.detectedName} (${describeSource(identity.detectedSource)})`,
  ]);
  if (identity.customName) {
    rows.push(['Custom name', identity.customName]);
  }
  if (identity.label) {
    rows.push(['Environment label', identity.label]);
  }
  rows.push([
    'Workspace',
    workspace.workspaceFile
      ? `${workspace.workspaceFileName ?? 'workspace'} (${workspace.folders.length} folder${workspace.folders.length === 1 ? '' : 's'})`
      : workspace.kind === 'multi-root'
        ? `Untitled workspace (${workspace.folders.length} folders)`
        : 'Single folder',
  ]);
  if (workspace.primary) {
    rows.push(['Local directory', displayPath(workspace.primary.uri, homeDir)]);
  }
  if (vscode.env.remoteName) {
    rows.push(['Remote', vscode.env.remoteName]);
  }
  if (git) {
    rows.push(['Git repository', displayPath(git.rootUri, homeDir)]);
    if (git.relativePath) {
      rows.push(['Folder in repository', git.relativePath]);
    }
    rows.push(['Git branch', git.headLabel]);
    rows.push([
      'Git remote',
      git.remote ? `${git.remote.sanitizedUrl} (${git.remoteName ?? 'remote'})` : undefined,
    ]);
    rows.push(['Repository URL', git.remote?.webUrl]);
    if (git.worktreeName) {
      rows.push(['Linked worktree', git.worktreeName]);
    }
    if (git.isSubmodule) {
      rows.push(['Submodule', 'yes']);
    }
    const workingTree = await gitExtension.workingTree(git.rootUri);
    if (workingTree) {
      rows.push([
        'Working tree',
        workingTree.changes === 0
          ? 'clean'
          : `${workingTree.changes} change${workingTree.changes === 1 ? '' : 's'}`,
      ]);
    }
  } else {
    rows.push(['Git repository', 'none detected']);
  }
  rows.push(['Project identity key', identity.key]);
  rows.push(['Identity source', identity.keySource]);
  if (color) {
    rows.push(['Automatic color', describeColor(color.auto)]);
    rows.push(['Active color', `${describeColor(color.active)} (${color.source})`]);
    rows.push([
      'Status bar text',
      `${color.theme.foreground} (${formatContrast(color.theme.contrast)} contrast)`,
    ]);
  }
  rows.push([
    'Status bar coloring',
    coloring.kind === 'active' ? 'active' : (describeColoringStatus(coloring) ?? coloring.kind),
  ]);
  rows.push([
    'Color settings file',
    settingsTarget.kind === 'internal'
      ? 'VS Code storage (untitled workspace)'
      : settingsTarget.label,
  ]);
  if (themeOverrides.length > 0) {
    rows.push(['Theme overrides', `${themeOverrides.join(', ')} may hide the project color`]);
  }
  rows.push(['Project type', identity.projectType?.label]);

  const known = rows.filter((row): row is [string, string] => row[1] !== undefined);
  const items: InfoItem[] = known.map(([label, value]) => ({ label, description: value, value }));
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(copy) Copy All',
    description: 'Copy this list to the clipboard',
    copyAll: true,
  });

  const choice = await vscode.window.showQuickPick(items, {
    title: `${identity.displayName}: Project Information`,
    placeHolder: 'Select a row to copy its value',
    matchOnDescription: true,
  });
  if (!choice) {
    return;
  }
  const text = choice.copyAll
    ? known.map(([label, value]) => `${label}: ${value}`).join('\n')
    : (choice.value ?? '');
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(
    `$(check) Copied ${choice.copyAll ? 'project information' : choice.label.toLowerCase()}`,
    3000,
  );
}

function describeSource(source: string): string {
  switch (source) {
    case 'workspace-file':
      return 'from the workspace file name';
    case 'folder':
      return 'from the folder name';
    case 'folder-in-repository':
      return 'from the repository and folder names';
    case 'manifest':
      return 'from a project manifest';
    case 'repository':
      return 'from the Git repository name';
    default:
      return 'fallback';
  }
}
