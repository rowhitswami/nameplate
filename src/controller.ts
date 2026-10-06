/**
 * Orchestrates one window's project identity: detects the project, resolves
 * its colors, keeps the status bar in sync and executes the user's actions.
 *
 * Every refresh runs through a serial queue, so concurrent events (settings
 * changes, Git changes, commands) can never interleave their writes.
 */
import * as vscode from 'vscode';
import { ALL_MANAGED_COLOR_KEYS, STATUS_BAR_BACKGROUND } from './core/colors/statusBarTheme';
import { findThemeScopedOverrides } from './core/colors/colorCustomizations';
import { normalizeHexColor } from './core/colors/hex';
import type { Visibility } from './core/registry/colorRegistry';
import { decideWrite } from './core/colors/writePolicy';
import { sanitizeUserText } from './core/util/text';
import type { StatusBarColorizer } from './colors/statusBarColorizer';
import type { ColorCoordinator } from './colors/colorCoordinator';
import type { SettingsFileGuard } from './colors/settingsFileGuard';
import type { WorkspaceStateStore } from './configuration/persistence';
import {
  affectsColorCustomizations,
  affectsSettings,
  readSettings,
  updateGlobalSetting,
  type NameplateSettings,
} from './configuration/settings';
import type { GitService } from './git/gitService';
import { resolveIdentity } from './identity/identityResolver';
import type { Logger } from './logging/logger';
import type { ColoringStatus, ColorSnapshot, ProjectSnapshot, SettingsTarget } from './model';
import type { ProjectStatusBarItem } from './ui/statusBar';
import { SerialQueue } from './util/async';
import { describeWorkspace, settingsTargetFor } from './workspace/workspaceInfo';
import { scanWorkspaceFolder, WATCHED_ROOT_FILES } from './workspace/workspaceScanner';

export interface ControllerDependencies {
  readonly logger: Logger;
  readonly state: WorkspaceStateStore;
  readonly git: GitService;
  readonly guard: SettingsFileGuard;
  readonly colorizer: StatusBarColorizer;
  readonly colors: ColorCoordinator;
  readonly statusBar: ProjectStatusBarItem;
  readonly notifications: ControllerNotifications;
}

/** UI hooks the controller triggers; implemented in `ui/notifications.ts`. */
export interface ControllerNotifications {
  firstRun(snapshot: ProjectSnapshot): void;
  colorMoved(snapshot: ProjectSnapshot, from: string, to: string, conflictWith: string): void;
}

export interface RefreshOptions {
  /** The refresh is the direct result of a user action: take over foreign colors and consent to tracked files. */
  readonly explicit?: boolean;
  /** Pick the next free automatic color. */
  readonly regenerateColor?: boolean;
}

export class NameplateController implements vscode.Disposable {
  private readonly queue = new SerialQueue();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly updateEmitter = new vscode.EventEmitter<ProjectSnapshot | undefined>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingOptions: RefreshOptions = {};
  private pendingReasons = new Set<string>();
  private pendingWaiters: { resolve: () => void }[] = [];
  private current: ProjectSnapshot | undefined;
  /** The identity key this window registered in the shared color registry. */
  private claimedKey: string | undefined;
  private lastTouch = 0;
  private manifestWatcher: vscode.FileSystemWatcher | undefined;
  private watchedFolder: string | undefined;

  readonly onDidUpdate: vscode.Event<ProjectSnapshot | undefined> = this.updateEmitter.event;

  constructor(private readonly deps: ControllerDependencies) {}

  get snapshot(): ProjectSnapshot | undefined {
    return this.current;
  }

  start(): void {
    const { git } = this.deps;
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.requestRefresh('workspace folders changed');
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsSettings(event)) {
          void this.requestRefresh('settings changed');
        } else if (affectsColorCustomizations(event)) {
          void this.requestRefresh('workbench.colorCustomizations changed');
        }
      }),
      git.onDidChange(() => {
        void this.requestRefresh('git metadata changed');
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.onFocus();
        }
      }),
      this.deps.colors.onDidChangeRegistry(() => {
        void this.checkForConflicts();
      }),
    );
    void this.requestRefresh('activation');
  }

  /** Schedules a (debounced) refresh and resolves once it ran. */
  requestRefresh(reason: string, options: RefreshOptions = {}): Promise<void> {
    this.pendingReasons.add(reason);
    this.pendingOptions = {
      explicit: this.pendingOptions.explicit || options.explicit,
      regenerateColor: this.pendingOptions.regenerateColor || options.regenerateColor,
    };
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    return new Promise<void>((resolve) => {
      this.pendingWaiters.push({ resolve });
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        const reasons = [...this.pendingReasons].join(', ');
        const refreshOptions = this.pendingOptions;
        const waiters = this.pendingWaiters;
        this.pendingReasons = new Set();
        this.pendingOptions = {};
        this.pendingWaiters = [];
        void this.queue
          .run(() => this.refresh(reasons, refreshOptions))
          .finally(() => waiters.forEach((w) => w.resolve()));
      }, 50);
    });
  }

  // --- user actions ----------------------------------------------------------

  async setCustomName(name: string | undefined): Promise<void> {
    const clean = name ? sanitizeUserText(name) : '';
    await this.deps.state.update({ customName: clean.length > 0 ? clean : undefined });
    await this.requestRefresh('rename');
  }

  async setCustomColor(color: string): Promise<void> {
    const hex = normalizeHexColor(color);
    if (!hex) {
      throw new Error(`Invalid color: ${color}`);
    }
    await this.deps.state.update({ customColor: hex, coloringEnabled: undefined });
    await this.requestRefresh('custom color', { explicit: true });
  }

  async resetColor(): Promise<void> {
    await this.deps.state.update({ customColor: undefined });
    await this.requestRefresh('reset color', { explicit: true });
  }

  async regenerateColor(): Promise<void> {
    await this.deps.state.update({ customColor: undefined, coloringEnabled: undefined });
    await this.requestRefresh('regenerate color', { explicit: true, regenerateColor: true });
  }

  async setLabel(label: string | undefined): Promise<void> {
    const clean = label ? sanitizeUserText(label) : '';
    await this.deps.state.update({ label: clean.length > 0 ? clean : undefined });
    await this.requestRefresh('label');
  }

  /**
   * Turns per-workspace coloring on or off. Turning it on is an explicit user
   * action: it takes over status bar colors set by someone else.
   */
  async toggleColoring(): Promise<boolean> {
    if (this.current?.coloring.kind === 'active') {
      await this.deps.state.update({ coloringEnabled: false });
      await this.requestRefresh('coloring off', { explicit: true });
      return false;
    }
    await this.deps.state.update({ coloringEnabled: true });
    if (!readSettings().colorStatusBar) {
      await updateGlobalSetting('colorStatusBar', true);
    }
    await this.requestRefresh('coloring on', { explicit: true });
    return true;
  }

  /** Forgets every customization of this workspace and returns to automatic behaviour. */
  async resetIdentity(): Promise<void> {
    const state = this.deps.state.get();
    await this.deps.state.update({
      customName: undefined,
      customColor: undefined,
      label: undefined,
      coloringEnabled: undefined,
      autoColor: undefined,
      // Keep the bookkeeping that belongs to files on disk.
      createdSettingsFile: state.createdSettingsFile,
      excludePattern: state.excludePattern,
      excludeFileUri: state.excludeFileUri,
      gitFilter: state.gitFilter,
      firstRunShown: state.firstRunShown,
    });
    await this.requestRefresh('reset identity');
  }

  markFirstRunShown(): Promise<unknown> {
    return this.deps.state.update({ firstRunShown: true });
  }

  // --- the pipeline ----------------------------------------------------------

  private async refresh(reason: string, options: RefreshOptions): Promise<void> {
    const { logger, statusBar } = this.deps;
    const started = Date.now();
    try {
      const settings = readSettings();
      const workspace = describeWorkspace();
      const primary = workspace.primary;
      if (workspace.kind === 'none' || !primary) {
        await this.releaseClaim();
        this.publish(undefined, settings);
        return;
      }
      this.watchManifests(primary.uri);
      const settingsTarget = settingsTargetFor(workspace);

      if (!settings.enabled) {
        // Hide the name at once; taking the colors (and the Git filter) back out takes a moment.
        this.publish(undefined, settings);
        await this.releaseColors(settingsTarget, options.explicit === true);
        await this.releaseClaim();
        logger.info(`Disabled; removed managed colors (${reason})`);
        return;
      }

      const [git, scan] = await Promise.all([
        this.deps.git.read(primary.uri),
        scanWorkspaceFolder(primary.uri),
      ]);
      const state = this.deps.state.get();
      const identity = resolveIdentity(
        workspace,
        { name: primary.name, uriString: primary.uri.toString() },
        git,
        scan,
        state,
        settings,
      );

      // Paint the name as early as possible; colors may take longer (Git API, file writes).
      const partial: ProjectSnapshot = {
        workspace,
        identity,
        git,
        coloring: { kind: 'pending' },
        settingsTarget,
        themeOverrides: [],
      };
      statusBar.render(partial, settings);

      if (this.claimedKey !== undefined && this.claimedKey !== identity.key) {
        await this.releaseClaim();
      }
      const claim = await this.deps.colors.claim({
        key: identity.key,
        name: identity.displayName,
        settings,
        regenerate: options.regenerateColor,
      });
      this.claimedKey = identity.key;
      const color = claim.color;
      const coloring = await this.syncColors(
        settingsTarget,
        settings,
        color,
        options.explicit === true,
      );
      const visibility = this.visibilityFor(coloring);
      if (visibility) {
        await this.deps.colors.reportVisibility(identity.key, visibility);
      }
      const themeOverrides = findThemeScopedOverrides(
        this.deps.colorizer.readEffectiveValue(),
        ALL_MANAGED_COLOR_KEYS,
      );
      if (themeOverrides.length > 0) {
        logger.warn(
          `Theme-specific color customizations may hide the project color: ${themeOverrides.join(', ')}`,
        );
      }
      const snapshot: ProjectSnapshot = { ...partial, color, coloring, themeOverrides };
      this.publish(snapshot, settings);
      logger.info(
        `Refreshed (${reason}) in ${Date.now() - started} ms: "${identity.displayName}" ` +
          `[${identity.detectedSource}] key=${identity.key} color=${color.active} (${color.source}) coloring=${coloring.kind}`,
      );

      if (claim.moved && coloring.kind === 'active') {
        this.deps.notifications.colorMoved(
          snapshot,
          claim.moved.from,
          claim.moved.to,
          claim.moved.conflictWith,
        );
      }
      if (coloring.kind === 'active' && !this.deps.state.get().firstRunShown) {
        // The hint is for colors that appeared on their own; after an explicit
        // action (picked a color, turned coloring on) the user already knows.
        if (options.explicit || !settings.showFirstRunNotification) {
          await this.markFirstRunShown();
        } else {
          this.deps.notifications.firstRun(snapshot);
        }
      }
    } catch (error) {
      logger.error(`Refresh failed (${reason})`, error);
    }
  }

  private async syncColors(
    target: SettingsTarget,
    settings: NameplateSettings,
    color: ColorSnapshot,
    explicit: boolean,
  ): Promise<ColoringStatus> {
    const { colorizer, guard, logger, state } = this.deps;
    if (!settings.colorStatusBar || state.get().coloringEnabled === false) {
      await this.releaseColors(target, explicit);
      return { kind: 'off', reason: settings.colorStatusBar ? 'workspace' : 'setting' };
    }

    const classification = await guard.classify(target);
    const decision = decideWrite({
      status: classification.status,
      keepOutOfGit: settings.keepColorsOutOfGit,
      canFilter: guard.canFilter(classification),
      explicit,
    });
    logger.debug(
      `Settings file ${target.label}: ${classification.status} → ${JSON.stringify(decision)}`,
    );
    if (decision.kind !== 'allow' || !decision.filter) {
      await guard.removeFilter();
    }
    if (decision.kind === 'deny') {
      // Colors written earlier would show up in Git: take them back out.
      await this.releaseColors(target, explicit);
      return { kind: 'blocked', reason: decision.reason, file: target.label };
    }

    try {
      const plan = colorizer.planApply(color.theme.colors, explicit);
      if (plan.outcome === 'stood-down') {
        await colorizer.commit(plan, explicit);
        await guard.cleanup(target);
        logger.info(
          `Standing down: ${plan.conflicts.join(', ')} set by someone else in ${target.label}`,
        );
        return { kind: 'external', conflicts: plan.conflicts };
      }
      // Make Git blind to the lines before they are written, so they never show up.
      if (decision.filter && plan.record) {
        const protectedFromGit = await guard.protect(classification, plan.record);
        if (!protectedFromGit && !explicit && classification.status !== 'absent') {
          await this.releaseColors(target, explicit);
          return {
            kind: 'blocked',
            reason: classification.status === 'tracked' ? 'tracked' : 'unknown',
            file: target.label,
          };
        }
      }
      await colorizer.commit(plan, explicit);
      if (plan.outcome === 'applied' && !classification.exists) {
        await state.update({ createdSettingsFile: true });
        if (decision.exclude) {
          await guard.addLocalExclude(classification);
        }
      }
      if (decision.filter) {
        await guard.refreshIndex(classification, plan.changed);
      }
      return { kind: 'active' };
    } catch (error) {
      logger.error(`Could not write the status bar color to ${target.label}`, error);
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async releaseColors(target: SettingsTarget, explicit: boolean): Promise<void> {
    const { colorizer, guard, logger, state } = this.deps;
    try {
      const hadRecord = state.getColorRecord() !== undefined;
      await colorizer.release({ explicit });
      const current = state.get();
      if (hadRecord || current.createdSettingsFile || current.excludePattern || current.gitFilter) {
        await guard.cleanup(target);
      }
    } catch (error) {
      logger.error('Could not remove the managed colors', error);
    }
  }

  private publish(snapshot: ProjectSnapshot | undefined, settings: NameplateSettings): void {
    this.current = snapshot;
    this.deps.statusBar.render(snapshot, settings);
    this.updateEmitter.fire(snapshot);
  }

  /** What the status bar of this window shows, for the shared registry. */
  private visibilityFor(coloring: ColoringStatus): Visibility | undefined {
    switch (coloring.kind) {
      case 'pending':
        return undefined;
      case 'active':
        return { visible: true };
      case 'external': {
        const value = this.deps.colorizer.readWorkspaceValue()?.[STATUS_BAR_BACKGROUND];
        const external = typeof value === 'string' ? normalizeHexColor(value) : undefined;
        return external ? { visible: true, external } : { visible: false };
      }
      case 'off':
      case 'blocked':
      case 'error':
        return { visible: false };
    }
  }

  /** Another window changed the registry, or this one was focused: is our color still distinct? */
  private async checkForConflicts(): Promise<void> {
    const snapshot = this.current;
    if (!snapshot?.color || snapshot.color.source === 'custom') {
      return;
    }
    try {
      if (await this.deps.colors.needsReassignment(snapshot.identity.key, readSettings())) {
        await this.requestRefresh('color conflict with another window');
      }
    } catch (error) {
      this.deps.logger.debug(`Conflict check failed: ${String(error)}`);
    }
  }

  private async onFocus(): Promise<void> {
    const key = this.current?.identity.key;
    if (!key) {
      return;
    }
    if (Date.now() - this.lastTouch > 10 * 60 * 1000) {
      this.lastTouch = Date.now();
      try {
        await this.deps.colors.touch(key);
      } catch (error) {
        this.deps.logger.debug(`Registry touch failed: ${String(error)}`);
      }
    }
    await this.checkForConflicts();
  }

  private async releaseClaim(): Promise<void> {
    const key = this.claimedKey;
    if (key === undefined) {
      return;
    }
    this.claimedKey = undefined;
    try {
      await this.deps.colors.release(key);
    } catch (error) {
      this.deps.logger.debug(`Registry release failed: ${String(error)}`);
    }
  }

  private watchManifests(folder: vscode.Uri): void {
    const key = folder.toString();
    if (this.watchedFolder === key) {
      return;
    }
    this.manifestWatcher?.dispose();
    this.watchedFolder = key;
    const pattern = new vscode.RelativePattern(folder, `{${WATCHED_ROOT_FILES.join(',')}}`);
    this.manifestWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    const trigger = (): void => void this.requestRefresh('manifest changed');
    this.manifestWatcher.onDidChange(trigger);
    this.manifestWatcher.onDidCreate(trigger);
    this.manifestWatcher.onDidDelete(trigger);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.manifestWatcher?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.updateEmitter.dispose();
  }
}
