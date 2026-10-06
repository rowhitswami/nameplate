/**
 * Native color picking: a QuickPick of the curated palette with swatch icons
 * and live preview, plus a validated hex input for custom colors.
 */
import * as vscode from 'vscode';
import { showNoProjectMessage } from './messages';
import { formatContrast, pickForeground } from '../core/colors/contrast';
import { normalizeHexColor } from '../core/colors/hex';
import { BUILTIN_PALETTE, colorDisplayName } from '../core/colors/palette';
import { buildStatusBarTheme } from '../core/colors/statusBarTheme';
import { versionAtLeast } from '../core/util/semver';
import type { NameplateController } from '../controller';
import type { StatusBarColorizer } from '../colors/statusBarColorizer';
import { INACTIVE_BACKGROUND_MIN_VERSION } from '../constants';
import { readSettings } from '../configuration/settings';
import type { Logger } from '../logging/logger';
import { swatchIcon } from './swatches';

interface ColorItem extends vscode.QuickPickItem {
  readonly action: 'automatic' | 'pick' | 'custom';
  readonly hex?: string;
}

export async function pickProjectColor(
  controller: NameplateController,
  colorizer: StatusBarColorizer,
  logger: Logger,
): Promise<void> {
  const snapshot = controller.snapshot;
  if (!snapshot?.color) {
    showNoProjectMessage();
    return;
  }
  const { color, identity } = snapshot;
  const current = color.active;

  const items: ColorItem[] = [
    {
      action: 'automatic',
      label: `$(sparkle) Automatic`,
      description: `${colorDisplayName(color.auto)} · ${color.auto}${color.source === 'auto' ? ' · current' : ''}`,
      iconPath: swatchIcon(color.auto),
    },
    { action: 'pick', label: 'Palette', kind: vscode.QuickPickItemKind.Separator },
    ...BUILTIN_PALETTE.map<ColorItem>((entry) => ({
      action: 'pick',
      hex: entry.hex,
      label: entry.name,
      description: `${entry.hex}${entry.hex === current ? ' · current' : ''}${entry.auto ? '' : ' · manual only'}`,
      iconPath: swatchIcon(entry.hex),
    })),
    { action: 'pick', label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      action: 'custom',
      label: '$(edit) Custom Color…',
      description: 'Enter a hex value such as #2563eb',
    },
  ];

  const picker = vscode.window.createQuickPick<ColorItem>();
  picker.title = `Color for ${identity.displayName}`;
  picker.placeholder = 'Pick a status bar color (Esc to keep the current one)';
  picker.matchOnDescription = true;
  picker.items = items;
  picker.activeItems = items
    .filter(
      (item) => item.hex === current || (item.action === 'automatic' && color.source === 'auto'),
    )
    .slice(0, 1);

  // Live preview only when Nameplate already owns the color keys: previewing
  // must never be the first write into a settings file.
  const canPreview = colorizer.isOwning() && snapshot.coloring.kind === 'active';
  const previewOptions = {
    supportsInactiveBackground: versionAtLeast(
      vscode.version,
      INACTIVE_BACKGROUND_MIN_VERSION.major,
      INACTIVE_BACKGROUND_MIN_VERSION.minor,
    ),
    colorWhileDebugging: readSettings().colorWhileDebugging,
  };
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewed = false;
  const preview = (hex: string | undefined): void => {
    if (!canPreview || !hex) {
      return;
    }
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(() => {
      previewed = true;
      colorizer
        .apply(buildStatusBarTheme(hex, previewOptions).colors, { takeover: false, explicit: true })
        .catch((error: unknown) => logger.warn(`Color preview failed: ${String(error)}`));
    }, 150);
  };

  const choice = await new Promise<ColorItem | undefined>((resolve) => {
    picker.onDidChangeActive((active) => {
      const item = active[0];
      preview(item?.action === 'automatic' ? color.auto : item?.hex);
    });
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    picker.show();
  });
  if (previewTimer) {
    clearTimeout(previewTimer);
  }

  if (!choice) {
    if (previewed) {
      await controller.requestRefresh('color preview cancelled');
    }
    return;
  }
  switch (choice.action) {
    case 'automatic':
      await controller.resetColor();
      return;
    case 'pick':
      if (choice.hex) {
        await controller.setCustomColor(choice.hex);
      }
      return;
    case 'custom': {
      const hex = await promptForHexColor(current);
      if (hex) {
        await controller.setCustomColor(hex);
      } else if (previewed) {
        await controller.requestRefresh('color preview cancelled');
      }
      return;
    }
  }
}

export async function promptForHexColor(current: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Custom Project Color',
    prompt: 'Hex color, e.g. #2563eb or #26e',
    value: current,
    valueSelection: [1, current.length],
    validateInput: (input): vscode.InputBoxValidationMessage | undefined => {
      const hex = normalizeHexColor(input);
      if (!hex) {
        return {
          message: 'Enter a hex color such as #2563eb (3 or 6 hex digits).',
          severity: vscode.InputBoxValidationSeverity.Error,
        };
      }
      const choice = pickForeground(hex);
      return {
        message: `${hex} with ${choice.kind === 'light' ? 'white' : 'black'} text, contrast ${formatContrast(choice.contrast)}.`,
        severity: vscode.InputBoxValidationSeverity.Info,
      };
    },
  });
  return value === undefined ? undefined : normalizeHexColor(value);
}
