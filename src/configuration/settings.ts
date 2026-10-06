import * as vscode from 'vscode';
import type { NamePreference } from '../core/identity/detectProjectName';
import { TEXT_TRANSFORMS, type TextTransform } from '../core/identity/formatName';
import type { ColorSource } from '../core/identity/identityKey';
import { CONFIG_SECTION } from '../constants';

export interface NameplateSettings {
  readonly enabled: boolean;
  readonly showProjectName: boolean;
  readonly colorStatusBar: boolean;
  readonly icon: string;
  readonly showBranch: boolean;
  readonly textTransform: TextTransform;
  readonly nameSource: NamePreference;
  readonly colorSource: ColorSource;
  readonly avoidColorCollisions: boolean;
  readonly palette: readonly string[];
  readonly colorWhileDebugging: boolean;
  readonly keepColorsOutOfGit: boolean;
  readonly statusBarPriority: number;
  readonly showFirstRunNotification: boolean;
}

const NAME_SOURCES: readonly NamePreference[] = ['auto', 'folder', 'manifest', 'repository'];
const COLOR_SOURCES: readonly ColorSource[] = ['auto', 'path', 'name'];

/** Reads and validates the settings; invalid values fall back to their defaults. */
export function readSettings(): NameplateSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: config.get<boolean>('enabled', true),
    showProjectName: config.get<boolean>('showProjectName', true),
    colorStatusBar: config.get<boolean>('colorStatusBar', true),
    icon: sanitizeIcon(config.get<string>('icon', 'folder')),
    showBranch: config.get<boolean>('showBranch', false),
    textTransform: oneOf(config.get<string>('textTransform'), TEXT_TRANSFORMS, 'auto'),
    nameSource: oneOf(config.get<string>('nameSource'), NAME_SOURCES, 'auto'),
    colorSource: oneOf(config.get<string>('colorSource'), COLOR_SOURCES, 'auto'),
    avoidColorCollisions: config.get<boolean>('avoidColorCollisions', true),
    palette: config.get<unknown[]>('palette', []).filter((v): v is string => typeof v === 'string'),
    colorWhileDebugging: config.get<boolean>('colorWhileDebugging', false),
    keepColorsOutOfGit: config.get<boolean>('keepColorsOutOfGit', true),
    statusBarPriority: finiteNumber(config.get<number>('statusBarPriority'), 1_000_000),
    showFirstRunNotification: config.get<boolean>('showFirstRunNotification', true),
  };
}

export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(CONFIG_SECTION);
}

export function affectsColorCustomizations(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('workbench.colorCustomizations');
}

export function updateGlobalSetting(key: string, value: unknown): Thenable<void> {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeIcon(value: string | undefined): string {
  const icon = (value ?? '').trim();
  return /^[a-z0-9-]*$/.test(icon) ? icon : 'folder';
}
