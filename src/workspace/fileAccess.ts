/**
 * Thin wrappers over `vscode.workspace.fs`. Everything goes through the VS Code
 * file system so the extension behaves identically for local, remote and
 * virtual workspaces, and never spawns processes.
 */
import * as vscode from 'vscode';
import type { FileKind, GitFileSystem } from '../core/git/repositoryReader';

/** Files larger than this are ignored (manifests are small; this guards against pathological input). */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;

const decoder = new TextDecoder('utf-8');

export async function readTextFile(
  uri: vscode.Uri,
  maxBytes: number = MAX_TEXT_FILE_BYTES,
): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory || stat.size > maxBytes) {
      return undefined;
    }
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export async function statKind(uri: vscode.Uri): Promise<FileKind | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    // A symbolic link to a directory still has the Directory bit set.
    return (stat.type & vscode.FileType.Directory) !== 0 ? 'directory' : 'file';
  } catch {
    return undefined;
  }
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  return (await statKind(uri)) !== undefined;
}

export async function readDirectoryNames(uri: vscode.Uri): Promise<Map<string, vscode.FileType>> {
  try {
    return new Map(await vscode.workspace.fs.readDirectory(uri));
  } catch {
    return new Map();
  }
}

export async function writeTextFile(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

/** Builds a URI with the scheme/authority of `base` and the given URI path. */
export function uriWithPath(base: vscode.Uri, path: string): vscode.Uri {
  return base.with({ path, query: '', fragment: '' });
}

/** Adapts `workspace.fs` to the path-based interface of the Git metadata reader. */
export function gitFileSystemFor(base: vscode.Uri): GitFileSystem {
  return {
    readText: (path) => readTextFile(uriWithPath(base, path), 256 * 1024),
    stat: (path) => statKind(uriWithPath(base, path)),
  };
}

/** A path for humans: `~/code/proj` locally, the plain path on remotes. */
export function displayPath(uri: vscode.Uri, homeDir?: string): string {
  const raw = uri.scheme === 'file' ? uri.fsPath : uri.path;
  if (
    homeDir &&
    raw.startsWith(homeDir) &&
    (raw.length === homeDir.length || raw[homeDir.length] === '/' || raw[homeDir.length] === '\\')
  ) {
    return `~${raw.slice(homeDir.length)}`;
  }
  return raw;
}
