/**
 * Where Nameplate keeps its state:
 *
 * - `workspaceState` (per workspace, lives in VS Code's own storage, never in
 *   the repository): custom name, custom color, label, the pinned automatic
 *   color, the ownership record of the color keys and small bookkeeping flags.
 * - A registry file in the extension's global storage directory (per machine
 *   and profile): which project uses which color and which windows are open,
 *   shared by all windows (see `src/registry/registryFile.ts`).
 * - Workspace settings: only the `workbench.colorCustomizations` keys that make
 *   VS Code paint the status bar; there is no other way to color one window.
 */
import type * as vscode from 'vscode';
import { normalizeHexColor } from '../core/colors/hex';
import type { OwnershipRecord } from '../core/colors/colorCustomizations';
import type { ColorSource } from '../core/identity/identityKey';
import { STATE_KEYS } from '../constants';

export interface PinnedAutoColor {
  readonly key: string;
  readonly color: string;
  readonly colorSource: ColorSource;
}

export interface WorkspaceIdentityState {
  readonly version: 1;
  readonly customName?: string;
  readonly customColor?: string;
  readonly label?: string;
  /** Per-workspace coloring toggle; `undefined` follows the `colorStatusBar` setting. */
  readonly coloringEnabled?: boolean;
  readonly autoColor?: PinnedAutoColor;
  readonly firstRunShown?: boolean;
  /** Nameplate created the settings file (so it may delete it again when empty). */
  readonly createdSettingsFile?: boolean;
  /** Pattern Nameplate added to `.git/info/exclude`, with the exclude file it lives in. */
  readonly excludePattern?: string;
  readonly excludeFileUri?: string;
  /** Repository and file for which Nameplate installed its Git clean filter. */
  readonly gitFilter?: {
    readonly root: string;
    readonly gitDir: string;
    readonly commonDir: string;
    readonly relativePath: string;
  };
}

const EMPTY_STATE: WorkspaceIdentityState = { version: 1 };

export class WorkspaceStateStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(): WorkspaceIdentityState {
    const raw = this.memento.get<Partial<WorkspaceIdentityState>>(STATE_KEYS.workspace);
    if (!raw || typeof raw !== 'object') {
      return EMPTY_STATE;
    }
    return {
      ...raw,
      version: 1,
      customColor: normalizeHexColor(raw.customColor),
      customName:
        typeof raw.customName === 'string' && raw.customName.trim() ? raw.customName : undefined,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : undefined,
    };
  }

  /** Merges a patch into the state; `undefined` values delete their keys. */
  async update(patch: Partial<WorkspaceIdentityState>): Promise<WorkspaceIdentityState> {
    const next: Record<string, unknown> = { ...this.get(), ...patch, version: 1 };
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) {
        delete next[key];
      }
    }
    await this.memento.update(STATE_KEYS.workspace, next);
    return next as unknown as WorkspaceIdentityState;
  }

  async reset(): Promise<void> {
    await this.memento.update(STATE_KEYS.workspace, undefined);
  }

  getColorRecord(): OwnershipRecord | undefined {
    const raw = this.memento.get<OwnershipRecord>(STATE_KEYS.colorRecord);
    if (!raw || typeof raw !== 'object' || typeof raw.applied !== 'object') {
      return undefined;
    }
    return {
      version: 1,
      applied: { ...raw.applied },
      previous: { ...(raw.previous ?? {}) },
      containerExisted: raw.containerExisted === true,
    };
  }

  setColorRecord(record: OwnershipRecord | undefined): Thenable<void> {
    return this.memento.update(STATE_KEYS.colorRecord, record);
  }
}

/**
 * Version 0.1.0 kept the registry in `globalState`, which is not safe for
 * concurrent windows. It is read once to seed the registry file, then removed.
 */
export class LegacyRegistry {
  constructor(private readonly memento: vscode.Memento) {}

  read(): unknown {
    return this.memento.get(STATE_KEYS.registry);
  }

  clear(): Thenable<void> {
    return this.memento.update(STATE_KEYS.registry, undefined);
  }
}
