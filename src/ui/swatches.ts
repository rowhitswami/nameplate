import * as vscode from 'vscode';
import { normalizeHexColor } from '../core/colors/hex';

const cache = new Map<string, vscode.Uri>();

/** A small round color swatch as a data-URI SVG, usable as a QuickPick icon. */
export function swatchIcon(hex: string): vscode.Uri | undefined {
  const color = normalizeHexColor(hex);
  if (!color) {
    return undefined;
  }
  let uri = cache.get(color);
  if (!uri) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
      `<circle cx="8" cy="8" r="6.5" fill="${color}" stroke="rgba(128,128,128,0.45)" stroke-width="1"/></svg>`;
    uri = vscode.Uri.parse(`data:image/svg+xml;base64,${btoa(svg)}`);
    cache.set(color, uri);
  }
  return uri;
}
