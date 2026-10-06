/**
 * Applies and removes the managed `workbench.colorCustomizations` keys through
 * the official configuration API, at the Workspace target (the only target
 * that colors one window and not all of them).
 *
 * All decisions are made by the pure planner in `core/colors/colorCustomizations`;
 * this class only reads the current workspace-level value, writes the planned
 * one and persists the ownership record.
 */
import * as vscode from 'vscode';
import {
  isOwning,
  planApply,
  planRelease,
  type ColorCustomizations,
  type ColorPlan,
} from '../core/colors/colorCustomizations';
import type { WorkspaceStateStore } from '../configuration/persistence';
import type { Logger } from '../logging/logger';

const SECTION = 'workbench';
const KEY = 'colorCustomizations';

/**
 * More *automatic* writes than this within the window means something is
 * fighting us (another extension, a sync tool); stop rather than loop.
 * Writes caused directly by a user action are never throttled.
 */
const MAX_AUTOMATIC_WRITES_PER_WINDOW = 10;
const WRITE_WINDOW_MS = 30_000;

export interface CommitOptions {
  /** Replace foreign values (after backing them up). Only for explicit user actions. */
  readonly takeover: boolean;
  /** The write is the direct result of a user action. */
  readonly explicit: boolean;
}

export class StatusBarColorizer {
  private writeTimestamps: number[] = [];

  constructor(
    private readonly state: WorkspaceStateStore,
    private readonly logger: Logger,
  ) {}

  /** The workspace-level value only (never the merged user+workspace value). */
  readWorkspaceValue(): ColorCustomizations | undefined {
    const inspected = vscode.workspace.getConfiguration(SECTION).inspect<ColorCustomizations>(KEY);
    const value = inspected?.workspaceValue;
    return isRecord(value) ? value : undefined;
  }

  /** The effective (merged) value, used only for diagnostics. */
  readEffectiveValue(): ColorCustomizations | undefined {
    const value = vscode.workspace.getConfiguration(SECTION).get<ColorCustomizations>(KEY);
    return isRecord(value) ? value : undefined;
  }

  isOwning(): boolean {
    return isOwning(this.readWorkspaceValue(), this.state.getColorRecord());
  }

  planApply(desired: Readonly<Record<string, string>>, takeover: boolean): ColorPlan {
    return planApply(this.readWorkspaceValue(), this.state.getColorRecord(), desired, { takeover });
  }

  async apply(
    desired: Readonly<Record<string, string>>,
    options: CommitOptions,
  ): Promise<ColorPlan> {
    const plan = this.planApply(desired, options.takeover);
    await this.commit(plan, options.explicit);
    return plan;
  }

  async release(options: { readonly explicit: boolean }): Promise<ColorPlan> {
    const plan = planRelease(this.readWorkspaceValue(), this.state.getColorRecord());
    await this.commit(plan, options.explicit);
    return plan;
  }

  /** Writes a plan made by {@link planApply} (or a release) and persists its ownership record. */
  async commit(plan: ColorPlan, explicit: boolean): Promise<void> {
    if (plan.changed) {
      if (!explicit && !this.allowAutomaticWrite()) {
        throw new Error(
          'Too many writes to workbench.colorCustomizations in a short time; another extension or process may be changing the same keys. Nameplate paused to avoid a loop.',
        );
      }
      this.logger.info(
        `Writing workbench.colorCustomizations (${plan.outcome}): ${JSON.stringify(plan.next)}`,
      );
      await vscode.workspace
        .getConfiguration(SECTION)
        .update(KEY, plan.next, vscode.ConfigurationTarget.Workspace);
    }
    const current = this.state.getColorRecord();
    if (JSON.stringify(current) !== JSON.stringify(plan.record)) {
      await this.state.setColorRecord(plan.record);
    }
  }

  private allowAutomaticWrite(): boolean {
    const now = Date.now();
    this.writeTimestamps = this.writeTimestamps.filter((t) => now - t < WRITE_WINDOW_MS);
    if (this.writeTimestamps.length >= MAX_AUTOMATIC_WRITES_PER_WINDOW) {
      return false;
    }
    this.writeTimestamps.push(now);
    return true;
  }
}

function isRecord(value: unknown): value is ColorCustomizations {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
