import * as vscode from 'vscode';
import type { StatusBarColorizer } from '../colors/statusBarColorizer';
import { updateGlobalSetting } from '../configuration/settings';
import { COMMANDS, EXTENSION_NAME } from '../constants';
import type { NameplateController } from '../controller';
import type { GitExtensionBridge } from '../git/gitExtension';
import type { Logger } from '../logging/logger';
import { pickProjectColor } from '../ui/colorPicker';
import { showProjectMenu } from '../ui/menu';
import { noProjectMessage } from '../ui/messages';
import { showProjectInformation } from '../ui/projectInfo';
import { confirmResetIdentity, promptEnvironmentLabel, promptRenameProject } from '../ui/prompts';

export interface CommandDependencies {
  readonly controller: NameplateController;
  readonly colorizer: StatusBarColorizer;
  readonly gitExtension: GitExtensionBridge;
  readonly logger: Logger;
  readonly homeDir: string | undefined;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDependencies,
): void {
  const { controller, colorizer, gitExtension, logger, homeDir } = deps;

  const register = (id: string, handler: () => Promise<void> | void): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await handler();
        } catch (error) {
          logger.error(`Command ${id} failed`, error);
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(
            message.startsWith(EXTENSION_NAME) ? message : `${EXTENSION_NAME}: ${message}`,
          );
        }
      }),
    );
  };

  const requireSnapshot = (): NonNullable<NameplateController['snapshot']> => {
    const snapshot = controller.snapshot;
    if (!snapshot) {
      throw new Error(noProjectMessage());
    }
    return snapshot;
  };

  const flash = (message: string): void => {
    vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
  };

  register(COMMANDS.showMenu, () => showProjectMenu(controller));
  register(COMMANDS.renameProject, () => promptRenameProject(controller));
  register(COMMANDS.changeColor, () => pickProjectColor(controller, colorizer, logger));
  register(COMMANDS.setLabel, () => promptEnvironmentLabel(controller));
  register(COMMANDS.showInfo, () => showProjectInformation(controller, gitExtension, homeDir));

  register(COMMANDS.resetName, async () => {
    requireSnapshot();
    await controller.setCustomName(undefined);
    flash(`Project name is automatic again: ${controller.snapshot?.identity.displayName ?? ''}`);
  });

  register(COMMANDS.resetColor, async () => {
    requireSnapshot();
    await controller.resetColor();
    flash('Project color is automatic again');
  });

  register(COMMANDS.regenerateColor, async () => {
    requireSnapshot();
    await controller.regenerateColor();
    flash('Assigned a new automatic color');
  });

  register(COMMANDS.resetIdentity, async () => {
    const snapshot = requireSnapshot();
    if (await confirmResetIdentity(snapshot.identity.displayName)) {
      await controller.resetIdentity();
      flash('Project identity reset');
    }
  });

  register(COMMANDS.copyPath, async () => {
    const snapshot = requireSnapshot();
    const uri = snapshot.workspace.primary?.uri;
    if (!uri) {
      return;
    }
    await vscode.env.clipboard.writeText(uri.scheme === 'file' ? uri.fsPath : uri.path);
    flash('Copied project path');
  });

  register(COMMANDS.copyRemote, async () => {
    const snapshot = requireSnapshot();
    const url = snapshot.git?.remote?.sanitizedUrl;
    if (!url) {
      void vscode.window.showInformationMessage(
        `${EXTENSION_NAME}: no Git remote detected for this project.`,
      );
      return;
    }
    await vscode.env.clipboard.writeText(url);
    flash('Copied Git remote');
  });

  register(COMMANDS.openFolder, async () => {
    const snapshot = requireSnapshot();
    const uri = snapshot.workspace.primary?.uri;
    if (!uri) {
      return;
    }
    try {
      await vscode.commands.executeCommand('revealFileInOS', uri);
    } catch (error) {
      logger.warn(`revealFileInOS failed: ${String(error)}`);
      void vscode.window.showInformationMessage(
        `${EXTENSION_NAME}: the project folder cannot be opened in the file manager from this window.`,
      );
    }
  });

  register(COMMANDS.openRepository, async () => {
    const snapshot = requireSnapshot();
    const url = snapshot.git?.remote?.webUrl;
    if (!url) {
      void vscode.window.showInformationMessage(
        `${EXTENSION_NAME}: no repository URL detected for this project.`,
      );
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  });

  register(COMMANDS.toggleColoring, async () => {
    requireSnapshot();
    const enabled = await controller.toggleColoring();
    flash(enabled ? 'Project coloring turned on' : 'Project coloring turned off for this project');
  });

  register(COMMANDS.enable, async () => {
    await updateGlobalSetting('enabled', true);
    flash(`${EXTENSION_NAME} enabled`);
  });

  register(COMMANDS.disable, async () => {
    await updateGlobalSetting('enabled', false);
    flash(`${EXTENSION_NAME} disabled`);
  });

  register(COMMANDS.showLog, () => logger.show());
}
