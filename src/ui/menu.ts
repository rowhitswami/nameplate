/**
 * The quick action menu that opens when the project name is clicked.
 */
import * as vscode from 'vscode';
import { showNoProjectMessage } from './messages';
import { describeColor } from '../core/colors/palette';
import type { NameplateController } from '../controller';
import { COMMANDS, type CommandId } from '../constants';
import { describeColoringStatus } from './statusBar';

interface MenuItem extends vscode.QuickPickItem {
  readonly command?: CommandId;
}

export async function showProjectMenu(controller: NameplateController): Promise<void> {
  const snapshot = controller.snapshot;
  if (!snapshot) {
    showNoProjectMessage();
    return;
  }
  const { identity, color, git, coloring } = snapshot;
  const separator = (label: string): MenuItem => ({
    label,
    kind: vscode.QuickPickItemKind.Separator,
  });
  const coloringState =
    coloring.kind === 'active' ? 'On' : (describeColoringStatus(coloring) ?? 'Off');

  const items: MenuItem[] = [
    separator('Identity'),
    {
      command: COMMANDS.renameProject,
      label: '$(edit) Rename Project…',
      description: identity.customName ? `${identity.displayName} (custom)` : identity.displayName,
    },
    {
      command: COMMANDS.changeColor,
      label: '$(symbol-color) Change Project Color…',
      description: color
        ? `${describeColor(color.active)}${color.source === 'custom' ? ' (custom)' : ''}`
        : undefined,
    },
    {
      command: COMMANDS.setLabel,
      label: '$(tag) Set Environment Label…',
      description: identity.label ?? 'none',
    },
    {
      command: COMMANDS.regenerateColor,
      label: '$(refresh) Regenerate Automatic Color',
      description: 'Pick the next free color',
    },
    separator('Reset'),
    {
      command: COMMANDS.resetName,
      label: '$(discard) Reset Project Name',
      description: identity.customName ? `Back to ${identity.detectedName}` : 'Already automatic',
    },
    {
      command: COMMANDS.resetColor,
      label: '$(discard) Reset Project Color',
      description:
        color?.source === 'custom' ? `Back to ${describeColor(color.auto)}` : 'Already automatic',
    },
    {
      command: COMMANDS.resetIdentity,
      label: '$(trash) Reset Project Identity',
      description: 'Forget name, color and label',
    },
    separator('Project'),
    { command: COMMANDS.copyPath, label: '$(copy) Copy Project Path' },
    {
      command: COMMANDS.copyRemote,
      label: '$(copy) Copy Git Remote',
      description: git?.remote?.sanitizedUrl ?? 'No Git remote',
    },
    { command: COMMANDS.openFolder, label: '$(folder-opened) Open Project Folder' },
    {
      command: COMMANDS.openRepository,
      label: '$(globe) Open Repository',
      description: git?.remote?.webUrl ?? 'No repository URL',
    },
    separator('Nameplate'),
    {
      command: COMMANDS.toggleColoring,
      label: '$(paintcan) Toggle Project Coloring',
      description: coloringState,
    },
    { command: COMMANDS.showInfo, label: '$(info) Project Information' },
  ];

  const choice = await vscode.window.showQuickPick(items, {
    title: `${identity.displayName}: Project Actions`,
    placeHolder: 'Choose an action',
    matchOnDescription: true,
  });
  if (choice?.command) {
    await vscode.commands.executeCommand(choice.command);
  }
}
