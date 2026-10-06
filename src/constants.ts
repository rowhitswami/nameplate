export const EXTENSION_NAME = 'Nameplate';
export const CONFIG_SECTION = 'nameplate';
export const STATUS_BAR_ITEM_ID = 'project';

export const COMMANDS = {
  showMenu: 'nameplate.showMenu',
  renameProject: 'nameplate.renameProject',
  changeColor: 'nameplate.changeColor',
  setLabel: 'nameplate.setLabel',
  resetName: 'nameplate.resetName',
  resetColor: 'nameplate.resetColor',
  regenerateColor: 'nameplate.regenerateColor',
  resetIdentity: 'nameplate.resetIdentity',
  showInfo: 'nameplate.showInfo',
  copyPath: 'nameplate.copyPath',
  copyRemote: 'nameplate.copyRemote',
  openFolder: 'nameplate.openFolder',
  openRepository: 'nameplate.openRepository',
  toggleColoring: 'nameplate.toggleColoring',
  enable: 'nameplate.enable',
  disable: 'nameplate.disable',
  showLog: 'nameplate.showLog',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

export const STATE_KEYS = {
  /** workspaceState: per-workspace customizations and bookkeeping. */
  workspace: 'nameplate.workspace',
  /** workspaceState: which color keys Nameplate wrote and what they replaced. */
  colorRecord: 'nameplate.colorRecord',
  /** globalState: the registry of version 0.1.0, only read for migration. */
  registry: 'nameplate.registry',
} as const;

/** `statusBar.inactiveBackground` exists from this VS Code version on. */
export const INACTIVE_BACKGROUND_MIN_VERSION = { major: 1, minor: 138 } as const;
