/**
 * Translates a project color into the `workbench.colorCustomizations` entries
 * Nameplate manages.
 */
import { pickForeground } from './contrast';
import { normalizeHexColor } from './hex';

export const STATUS_BAR_BACKGROUND = 'statusBar.background';
export const STATUS_BAR_FOREGROUND = 'statusBar.foreground';
/**
 * Added in VS Code 1.138 (September 2026). All current default themes define it,
 * so without this key the project color would vanish whenever the window is
 * not focused, which is exactly when you glance at a window to identify it.
 */
export const STATUS_BAR_INACTIVE_BACKGROUND = 'statusBar.inactiveBackground';
export const STATUS_BAR_DEBUGGING_BACKGROUND = 'statusBar.debuggingBackground';
export const STATUS_BAR_DEBUGGING_FOREGROUND = 'statusBar.debuggingForeground';

/** Every color key Nameplate may ever write, used when cleaning up. */
export const ALL_MANAGED_COLOR_KEYS: readonly string[] = [
  STATUS_BAR_BACKGROUND,
  STATUS_BAR_FOREGROUND,
  STATUS_BAR_INACTIVE_BACKGROUND,
  STATUS_BAR_DEBUGGING_BACKGROUND,
  STATUS_BAR_DEBUGGING_FOREGROUND,
];

export interface StatusBarThemeOptions {
  /** Whether the running editor knows `statusBar.inactiveBackground`. */
  readonly supportsInactiveBackground: boolean;
  /** Keep the project color while debugging. */
  readonly colorWhileDebugging: boolean;
}

export interface StatusBarTheme {
  readonly background: string;
  readonly foreground: string;
  readonly contrast: number;
  /** The color customizations to write, in a stable key order. */
  readonly colors: Readonly<Record<string, string>>;
}

export function buildStatusBarTheme(color: string, options: StatusBarThemeOptions): StatusBarTheme {
  const background = normalizeHexColor(color);
  if (!background) {
    throw new TypeError(`Invalid status bar color: ${color}`);
  }
  const { foreground, contrast } = pickForeground(background);
  const colors: Record<string, string> = {
    [STATUS_BAR_BACKGROUND]: background,
    [STATUS_BAR_FOREGROUND]: foreground,
  };
  if (options.supportsInactiveBackground) {
    colors[STATUS_BAR_INACTIVE_BACKGROUND] = background;
  }
  if (options.colorWhileDebugging) {
    colors[STATUS_BAR_DEBUGGING_BACKGROUND] = background;
    colors[STATUS_BAR_DEBUGGING_FOREGROUND] = foreground;
  }
  return { background, foreground, contrast, colors };
}
