/**
 * Decides the project's colors together with the other open windows: the
 * pinned automatic color (assigned once, moved only when another open window
 * already looks the same), an optional custom color on top, and the resulting
 * status bar theme.
 */
import * as vscode from 'vscode';
import { normalizeHexColor } from '../core/colors/hex';
import { colorDisplayName, resolveAutoPalette } from '../core/colors/palette';
import { buildStatusBarTheme } from '../core/colors/statusBarTheme';
import {
  migrateLegacyRegistry,
  needsReassignment,
  planClaim,
  planRelease,
  planTouch,
  planVisibility,
  type ClaimContext,
  type ClaimResult,
  type Visibility,
} from '../core/registry/colorRegistry';
import { versionAtLeast } from '../core/util/semver';
import type { LegacyRegistry, WorkspaceStateStore } from '../configuration/persistence';
import type { NameplateSettings } from '../configuration/settings';
import { INACTIVE_BACKGROUND_MIN_VERSION } from '../constants';
import type { Logger } from '../logging/logger';
import type { ColorSnapshot } from '../model';
import { isProcessAlive } from '../registry/processAlive';
import type { RegistryStore } from '../registry/registryFile';

export interface ColorClaim {
  readonly color: ColorSnapshot;
  /** Set when the automatic color moved because another open window looked the same. */
  readonly moved?: { readonly from: string; readonly to: string; readonly conflictWith: string };
}

export interface ClaimInput {
  readonly key: string;
  readonly name: string;
  readonly settings: NameplateSettings;
  readonly regenerate?: boolean;
}

export class ColorCoordinator implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly watcher: { close(): void };
  private migrated: Promise<void> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Fires (debounced) when another window changed the registry. */
  readonly onDidChangeRegistry: vscode.Event<void> = this.changeEmitter.event;

  constructor(
    private readonly state: WorkspaceStateStore,
    private readonly store: RegistryStore,
    private readonly legacy: LegacyRegistry,
    private readonly logger: Logger,
  ) {
    this.watcher = store.watch(() => this.scheduleChange());
  }

  async claim(input: ClaimInput): Promise<ColorClaim> {
    await this.migrateOnce();
    const { key, name, settings, regenerate } = input;
    const palette = resolveAutoPalette(settings.palette);
    const workspace = this.state.get();
    const customColor = normalizeHexColor(workspace.customColor);
    const pin =
      workspace.autoColor && workspace.autoColor.colorSource === settings.colorSource
        ? { key: workspace.autoColor.key, color: workspace.autoColor.color }
        : undefined;

    const result = await this.store.update((data) => {
      const outcome = planClaim(
        data,
        { key, name, pid: process.pid, pinned: pin, customColor, regenerate },
        this.context(settings, palette),
      );
      return { data: outcome.registry, changed: outcome.changed, result: outcome };
    });

    if (!pin || pin.key !== key || pin.color !== result.auto) {
      await this.state.update({
        autoColor: { key, color: result.auto, colorSource: settings.colorSource },
      });
    }
    this.log(key, result);
    return {
      color: {
        auto: result.auto,
        custom: customColor,
        active: result.active,
        source: customColor ? 'custom' : 'auto',
        theme: buildStatusBarTheme(result.active, {
          supportsInactiveBackground: versionAtLeast(
            vscode.version,
            INACTIVE_BACKGROUND_MIN_VERSION.major,
            INACTIVE_BACKGROUND_MIN_VERSION.minor,
          ),
          colorWhileDebugging: settings.colorWhileDebugging,
        }),
      },
      moved:
        result.reason === 'moved' && result.movedFrom
          ? {
              from: result.movedFrom,
              to: result.auto,
              conflictWith: result.conflictWith ?? 'another window',
            }
          : undefined,
    };
  }

  /** Records whether the status bar actually shows the color (or a color set by someone else). */
  async reportVisibility(key: string, visibility: Visibility): Promise<void> {
    await this.store.update((data) => {
      const outcome = planVisibility(data, key, visibility);
      return { data: outcome.registry, changed: outcome.changed, result: undefined };
    });
  }

  /** Marks the window as still showing the project (throttled inside). */
  async touch(key: string): Promise<void> {
    await this.store.update((data) => {
      const outcome = planTouch(data, key, process.pid, Date.now(), isProcessAlive);
      return { data: outcome.registry, changed: outcome.changed, result: undefined };
    });
  }

  /** Forgets that this window shows `key` (the window switched to another project). */
  async release(key: string): Promise<void> {
    await this.store.update((data) => {
      const outcome = planRelease(data, key, process.pid);
      return { data: outcome.registry, changed: outcome.changed, result: undefined };
    });
  }

  /** Read-only check: would this window move its color right now? */
  async needsReassignment(key: string, settings: NameplateSettings): Promise<boolean> {
    const data = await this.store.read();
    return needsReassignment(
      data,
      key,
      process.pid,
      this.context(settings, resolveAutoPalette(settings.palette)),
    );
  }

  private context(settings: NameplateSettings, palette: readonly string[]): ClaimContext {
    return {
      now: Date.now(),
      palette,
      isAlive: isProcessAlive,
      avoidCollisions: settings.avoidColorCollisions,
    };
  }

  /** Seeds the registry file with the `globalState` registry of version 0.1.0, once. */
  private migrateOnce(): Promise<void> {
    this.migrated ??= (async () => {
      const legacy = migrateLegacyRegistry(this.legacy.read());
      const keys = Object.keys(legacy);
      if (keys.length === 0) {
        return;
      }
      try {
        const added = await this.store.update((data) => {
          const missing = keys.filter((key) => !(key in data.entries));
          const entries = { ...data.entries };
          for (const key of missing) {
            const entry = legacy[key];
            if (entry) {
              entries[key] = entry;
            }
          }
          return {
            data: { version: 2, entries },
            changed: missing.length > 0,
            result: missing.length,
          };
        });
        await this.legacy.clear();
        this.logger.info(`Migrated ${added} project color(s) from the previous registry`);
      } catch (error) {
        this.logger.warn(`Migrating the previous registry failed: ${String(error)}`);
      }
    })();
    return this.migrated;
  }

  private log(key: string, result: ClaimResult): void {
    const others =
      result.openColors.length > 0 ? ` (other open windows: ${result.openColors.join(', ')})` : '';
    switch (result.reason) {
      case 'assigned':
        this.logger.info(`Assigned automatic color ${result.auto} for ${key}${others}`);
        return;
      case 'regenerated':
        this.logger.info(`Regenerated automatic color ${result.auto} for ${key}${others}`);
        return;
      case 'moved':
        this.logger.info(
          `Moved ${key} from ${result.movedFrom ?? '?'} to ${result.auto}: ${colorDisplayName(result.movedFrom ?? '')} ` +
            `looks the same as ${result.conflictWith ?? 'another open window'}${others}`,
        );
        return;
      case 'known':
        this.logger.info(
          `Using the color this project already has on this machine: ${result.auto}`,
        );
        return;
      case 'carried-over':
        this.logger.info(`Identity changed to ${key}; keeping color ${result.auto}`);
        return;
      case 'pinned':
        this.logger.debug(`Pinned color ${result.auto} for ${key}${others}`);
        return;
    }
  }

  private scheduleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    // A little jitter keeps all windows from re-checking in the same millisecond.
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = undefined;
        this.changeEmitter.fire();
      },
      250 + Math.floor(Math.random() * 250),
    );
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher.close();
    this.changeEmitter.dispose();
  }
}
