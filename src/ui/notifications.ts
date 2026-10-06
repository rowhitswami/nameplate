/**
 * The only notification Nameplate shows is a hint after the first coloring on
 * this machine, shown in one window only. Color moves get a short status bar
 * message, and everything else goes to the log.
 */
import * as vscode from 'vscode';
import { colorDisplayName } from '../core/colors/palette';
import { updateGlobalSetting } from '../configuration/settings';
import { COMMANDS, EXTENSION_NAME } from '../constants';
import type { ControllerNotifications, NameplateController } from '../controller';
import type { Logger } from '../logging/logger';
import type { ProjectSnapshot } from '../model';

export function createNotifications(
  getController: () => NameplateController,
  /** Resolves true for exactly one window on this machine (see `claimOnce`). */
  claimWelcome: () => Promise<boolean>,
  logger: Logger,
): ControllerNotifications {
  let welcomeChecked = false;

  return {
    firstRun(snapshot: ProjectSnapshot): void {
      if (welcomeChecked || !snapshot.color) {
        return;
      }
      welcomeChecked = true;
      void getController().markFirstRunShown();
      const colorName = colorDisplayName(snapshot.color.active).toLowerCase();
      void claimWelcome()
        .then(async (mine) => {
          if (!mine) {
            return; // Another window already welcomed the user.
          }
          const choice = await vscode.window.showInformationMessage(
            `${EXTENSION_NAME} labeled this window "${snapshot.identity.displayName}" and colored its status bar ${colorName}. Every project gets its own color. Click the name to change it.`,
            'Customize',
            "Don't Show Again",
          );
          if (choice === 'Customize') {
            await vscode.commands.executeCommand(COMMANDS.showMenu);
          } else if (choice === "Don't Show Again") {
            await updateGlobalSetting('showFirstRunNotification', false);
          }
        })
        .catch((error: unknown) => logger.warn(`Welcome notification failed: ${String(error)}`));
    },

    colorMoved(snapshot: ProjectSnapshot, from: string, to: string, conflictWith: string): void {
      // A quiet status bar message, not a notification: the color change itself is the news.
      vscode.window.setStatusBarMessage(
        `$(paintcan) ${colorDisplayName(from)} is already used by ${conflictWith} in another window, ` +
          `so ${snapshot.identity.displayName} is now ${colorDisplayName(to)}`,
        12_000,
      );
    },
  };
}
