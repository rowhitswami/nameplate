/**
 * Extension entry point: wires the services together. All behaviour lives in
 * the modules it instantiates; nothing here may throw past `activate`.
 */
import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { ColorCoordinator } from './colors/colorCoordinator';
import { GitFilter } from './colors/gitFilter';
import { SettingsFileGuard } from './colors/settingsFileGuard';
import { StatusBarColorizer } from './colors/statusBarColorizer';
import { registerCommands } from './commands/registerCommands';
import { LegacyRegistry, WorkspaceStateStore } from './configuration/persistence';
import { readSettings } from './configuration/settings';
import { EXTENSION_NAME } from './constants';
import { NameplateController } from './controller';
import { GitExtensionBridge } from './git/gitExtension';
import { GitService } from './git/gitService';
import { createLogger, type Logger } from './logging/logger';
import type { ProjectSnapshot } from './model';
import { InMemoryRegistry, RegistryFile, type RegistryStore } from './registry/registryFile';
import { createNotifications } from './ui/notifications';
import { ProjectStatusBarItem } from './ui/statusBar';

/** Internal API used by the integration tests. Not stable. */
export interface NameplateTestApi {
  readonly controller: NameplateController;
  /** The shared registry file, or `undefined` when windows cannot coordinate. */
  readonly registryPath: string | undefined;
  getSnapshot(): ProjectSnapshot | undefined;
  refresh(): Promise<void>;
  readonly onDidUpdate: vscode.Event<ProjectSnapshot | undefined>;
}

export function activate(context: vscode.ExtensionContext): NameplateTestApi | undefined {
  const logger = createLogger();
  context.subscriptions.push(logger);
  try {
    const state = new WorkspaceStateStore(context.workspaceState);
    const git = new GitService(logger);
    const gitExtension = new GitExtensionBridge(logger);
    const gitFilter = createGitFilter(context, gitExtension, logger);
    const guard = new SettingsFileGuard(gitExtension, gitFilter, state, logger);
    const colorizer = new StatusBarColorizer(state, logger);
    const registry = createRegistryStore(context, logger);
    const colors = new ColorCoordinator(
      state,
      registry,
      new LegacyRegistry(context.globalState),
      logger,
    );
    const homeDir = vscode.env.remoteName ? undefined : safeHomeDir();
    const statusBar = new ProjectStatusBarItem(readSettings().statusBarPriority, homeDir);

    // eslint-disable-next-line prefer-const
    let controller: NameplateController;
    const notifications = createNotifications(
      () => controller,
      () => claimOnce(context, 'welcome-shown'),
      logger,
    );
    controller = new NameplateController({
      logger,
      state,
      git,
      guard,
      colorizer,
      colors,
      statusBar,
      notifications,
    });
    context.subscriptions.push(git, statusBar, colors, controller);

    registerCommands(context, { controller, colorizer, gitExtension, logger, homeDir });
    controller.start();

    const kind = context.extension.extensionKind === vscode.ExtensionKind.UI ? 'ui' : 'workspace';
    const manifest = context.extension.packageJSON as { version?: string };
    logger.info(
      `${EXTENSION_NAME} ${manifest.version ?? ''} activated ` +
        `(${vscode.env.appName} ${vscode.version}, ${vscode.env.remoteName ?? 'local'} window, ${kind} extension host)`,
    );

    return {
      controller,
      registryPath: registry instanceof RegistryFile ? registry.filePath : undefined,
      getSnapshot: () => controller.snapshot,
      refresh: () => controller.requestRefresh('test'),
      onDidUpdate: controller.onDidUpdate,
    };
  } catch (error) {
    logger.error('Activation failed', error);
    return undefined;
  }
}

export function deactivate(): void {
  // Colors stay in the workspace settings on purpose: they must be visible the
  // moment the window opens again, before any extension has activated.
}

/**
 * The registry shared by all windows lives in the extension's global storage
 * directory. Desktop VS Code exposes that directory as a `vscode-userdata:` URI
 * backed by the local disk (remote extension hosts use `file:`); both map to a
 * real path that every window of the same profile shares.
 */
function createRegistryStore(context: vscode.ExtensionContext, logger: Logger): RegistryStore {
  const uri = context.globalStorageUri;
  if (uri.scheme === 'file' || uri.scheme === 'vscode-userdata') {
    try {
      mkdirSync(uri.fsPath, { recursive: true });
      return new RegistryFile({ dir: uri.fsPath, onWarning: (message) => logger.warn(message) });
    } catch (error) {
      logger.warn(`Cannot use ${uri.fsPath} for the shared color registry: ${String(error)}`);
    }
  } else {
    logger.warn(`Global storage ${uri.toString()} is not on a local disk`);
  }
  logger.warn('Windows cannot coordinate their colors; colors may repeat across windows');
  return new InMemoryRegistry();
}

/**
 * The Git clean filter needs a local global storage directory (for its script)
 * and runs on VS Code's own Node runtime (`process.execPath` with
 * ELECTRON_RUN_AS_NODE), so it works without a Node installation.
 */
function createGitFilter(
  context: vscode.ExtensionContext,
  gitExtension: GitExtensionBridge,
  logger: Logger,
): GitFilter | undefined {
  const storage = context.globalStorageUri;
  if (storage.scheme !== 'file' && storage.scheme !== 'vscode-userdata') {
    return undefined;
  }
  return new GitFilter(
    storage.fsPath,
    join(context.extensionPath, 'dist', 'git-clean-filter.js'),
    process.execPath,
    () => gitExtension.gitPath(),
    logger,
  );
}

/** Resolves true for exactly one caller on this machine (all windows of the profile). */
async function claimOnce(context: vscode.ExtensionContext, name: string): Promise<boolean> {
  try {
    const handle = await open(join(context.globalStorageUri.fsPath, name), 'wx');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

function safeHomeDir(): string | undefined {
  try {
    return homedir();
  } catch {
    return undefined;
  }
}
