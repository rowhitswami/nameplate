/**
 * The project name item at the far left of the status bar. It tells you which
 * project the window belongs to and opens the actions menu when clicked.
 * Everything else is in the tooltip.
 */
import * as vscode from 'vscode';
import { formatContrast } from '../core/colors/contrast';
import { describeColor } from '../core/colors/palette';
import { escapeMarkdown, escapeStatusBarText } from '../core/util/text';
import type { NameplateSettings } from '../configuration/settings';
import { COMMANDS, EXTENSION_NAME, STATUS_BAR_ITEM_ID } from '../constants';
import type { ProjectSnapshot } from '../model';
import { displayPath } from '../workspace/fileAccess';

export class ProjectStatusBarItem implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private priority: number;

  constructor(
    priority: number,
    private readonly homeDir: string | undefined,
  ) {
    this.priority = priority;
    this.item = this.create(priority);
  }

  render(snapshot: ProjectSnapshot | undefined, settings: NameplateSettings): void {
    if (settings.statusBarPriority !== this.priority) {
      // Priority is fixed at creation time; recreate the item to move it.
      this.item.dispose();
      this.priority = settings.statusBarPriority;
      this.item = this.create(this.priority);
    }
    if (!snapshot || !settings.showProjectName) {
      this.item.hide();
      return;
    }
    this.item.text = buildText(snapshot, settings);
    this.item.tooltip = buildTooltip(snapshot, this.homeDir);
    this.item.accessibilityInformation = {
      label: `Project ${snapshot.identity.displayName}. Opens the project actions menu.`,
      role: 'button',
    };
    this.item.show();
  }

  private create(priority: number): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(
      STATUS_BAR_ITEM_ID,
      vscode.StatusBarAlignment.Left,
      priority,
    );
    item.name = `${EXTENSION_NAME}: Project Name`;
    item.command = COMMANDS.showMenu;
    return item;
  }

  dispose(): void {
    this.item.dispose();
  }
}

export function buildText(snapshot: ProjectSnapshot, settings: NameplateSettings): string {
  const parts: string[] = [];
  if (settings.icon) {
    parts.push(`$(${settings.icon})`);
  }
  let label = escapeStatusBarText(snapshot.identity.displayName);
  if (snapshot.identity.label) {
    label += ` • ${escapeStatusBarText(snapshot.identity.label)}`;
  }
  if (settings.showBranch && snapshot.git?.headLabel) {
    label += ` • ${escapeStatusBarText(snapshot.git.headLabel)}`;
  }
  parts.push(label);
  return parts.join(' ');
}

export function buildTooltip(
  snapshot: ProjectSnapshot,
  homeDir: string | undefined,
): vscode.MarkdownString {
  const { identity, git, color, coloring, workspace } = snapshot;
  const md = new vscode.MarkdownString(undefined, true);
  md.supportHtml = true;
  md.isTrusted = false;

  const title = identity.label
    ? `${escapeMarkdown(identity.displayName)} • ${escapeMarkdown(identity.label)}`
    : escapeMarkdown(identity.displayName);
  md.appendMarkdown(`**${title}**`);
  if (identity.customName) {
    md.appendMarkdown(`  \n_Custom name · detected as ${escapeMarkdown(identity.detectedName)}_`);
  }
  md.appendMarkdown('\n\n');

  const rows: [string, string][] = [];
  if (git?.remote?.path) {
    rows.push(['Repository', escapeMarkdown(git.remote.path)]);
  }
  if (git?.headLabel) {
    rows.push(['Branch', escapeMarkdown(git.headLabel)]);
  }
  if (git?.remote?.sanitizedUrl) {
    rows.push(['Remote', escapeMarkdown(git.remote.sanitizedUrl)]);
  }
  if (git?.worktreeName) {
    rows.push(['Worktree', escapeMarkdown(git.worktreeName)]);
  }
  if (workspace.primary) {
    const path = displayPath(workspace.primary.uri, homeDir);
    const suffix = workspace.folders.length > 1 ? ` (+${workspace.folders.length - 1} more)` : '';
    rows.push(['Path', `${escapeMarkdown(path)}${suffix}`]);
  }
  if (color) {
    const swatch = `<span style="background-color:${color.theme.background};color:${color.theme.foreground};">&nbsp;${escapeMarkdown(describeColor(color.active))}&nbsp;</span>`;
    const origin = color.source === 'custom' ? 'custom' : 'automatic';
    rows.push(['Color', `${swatch} ${origin}, ${formatContrast(color.theme.contrast)} contrast`]);
  }
  if (identity.projectType) {
    rows.push(['Type', escapeMarkdown(identity.projectType.label)]);
  }
  const status = describeColoringStatus(coloring);
  if (status) {
    rows.push(['Status bar', escapeMarkdown(status)]);
  }
  md.appendMarkdown('| | |\n|---|---|\n');
  for (const [label, value] of rows) {
    md.appendMarkdown(`| ${label} | ${value} |\n`);
  }
  md.appendMarkdown('\n$(gear) Click for project actions');
  return md;
}

export function describeColoringStatus(coloring: ProjectSnapshot['coloring']): string | undefined {
  switch (coloring.kind) {
    case 'active':
    case 'pending':
      return undefined;
    case 'off':
      return coloring.reason === 'workspace'
        ? 'Coloring is turned off for this project'
        : 'Coloring is turned off (nameplate.colorStatusBar)';
    case 'external':
      return 'Not colored: workspace settings already set a status bar color';
    case 'blocked':
      return `Not colored: ${coloring.file} is ${coloring.reason === 'tracked' ? '' : 'possibly '}tracked by Git and the color cannot be kept out of Git here`;
    case 'error':
      return `Could not write the color: ${coloring.message}`;
  }
}
