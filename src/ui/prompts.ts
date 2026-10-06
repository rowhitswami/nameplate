import * as vscode from 'vscode';
import { showNoProjectMessage } from './messages';
import { sanitizeUserText } from '../core/util/text';
import type { NameplateController } from '../controller';

const MAX_NAME_LENGTH = 60;
const LABEL_PRESETS = ['DEV', 'LOCAL', 'STAGING', 'PROD'] as const;

export async function promptRenameProject(controller: NameplateController): Promise<void> {
  const snapshot = controller.snapshot;
  if (!snapshot) {
    showNoProjectMessage();
    return;
  }
  const current = snapshot.identity.customName ?? snapshot.identity.displayName;
  const value = await vscode.window.showInputBox({
    title: 'Rename Project',
    prompt: `Shown in the status bar of this workspace only. Leave empty to go back to the automatic name (${snapshot.identity.detectedName}).`,
    value: current,
    valueSelection: [0, current.length],
    validateInput: (input) =>
      sanitizeUserText(input).length > MAX_NAME_LENGTH
        ? `Keep it under ${MAX_NAME_LENGTH} characters.`
        : undefined,
  });
  if (value === undefined) {
    return;
  }
  await controller.setCustomName(value);
}

export async function promptEnvironmentLabel(controller: NameplateController): Promise<void> {
  const snapshot = controller.snapshot;
  if (!snapshot) {
    showNoProjectMessage();
    return;
  }
  const current = snapshot.identity.label;
  interface LabelItem extends vscode.QuickPickItem {
    readonly value?: string;
    readonly custom?: boolean;
  }
  const items: LabelItem[] = [
    { label: '$(circle-slash) None', description: current ? 'Remove the label' : 'current' },
    ...LABEL_PRESETS.map<LabelItem>((preset) => ({
      label: preset,
      description: preset === current ? 'current' : undefined,
      value: preset,
    })),
    {
      label: '$(edit) Custom…',
      custom: true,
      description: 'Any short text, e.g. a client or ticket',
    },
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: `Environment label for ${snapshot.identity.displayName}`,
    placeHolder:
      'Shown after the project name, e.g. "BrightDesk • PROD". Nameplate never guesses this.',
  });
  if (!choice) {
    return;
  }
  if (choice.custom) {
    const typed = await vscode.window.showInputBox({
      title: 'Custom Environment Label',
      prompt: 'Short text shown after the project name.',
      value: current ?? '',
      validateInput: (input) =>
        sanitizeUserText(input).length > 24 ? 'Keep it under 24 characters.' : undefined,
    });
    if (typed === undefined) {
      return;
    }
    await controller.setLabel(typed);
    return;
  }
  await controller.setLabel(choice.value);
}

export async function confirmResetIdentity(projectName: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Reset the identity of "${projectName}"?`,
    {
      modal: true,
      detail:
        'The custom name, custom color and environment label of this workspace will be forgotten and the automatic ones used again. Nothing outside this workspace is affected.',
    },
    'Reset',
  );
  return choice === 'Reset';
}
