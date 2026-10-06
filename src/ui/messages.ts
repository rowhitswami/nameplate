import * as vscode from 'vscode';
import { readSettings } from '../configuration/settings';
import { EXTENSION_NAME } from '../constants';

/** Why there is no project right now, phrased for the user. */
export function noProjectMessage(): string {
  if (!readSettings().enabled) {
    return `${EXTENSION_NAME} is disabled. Run "${EXTENSION_NAME}: Enable" to turn it on.`;
  }
  return `${EXTENSION_NAME}: open a folder or workspace first.`;
}

export function showNoProjectMessage(): void {
  void vscode.window.showInformationMessage(noProjectMessage());
}
