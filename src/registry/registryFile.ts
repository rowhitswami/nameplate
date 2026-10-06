/**
 * The registry shared by all windows: one small JSON file in the extension's
 * global storage directory, changed only inside an exclusive cross-process
 * lock, written atomically (temp file + rename).
 *
 * Why not `globalState`: every window keeps its own in-memory copy that VS Code
 * syncs between windows only after a delay, and each window writes the whole
 * object back, so concurrent writers silently drop each other's entries. When
 * several windows activate at once (after installing the extension, or on
 * startup) they would all see an empty registry and pick the same color.
 *
 * This module uses Node APIs only (no `vscode`), so it can be exercised from
 * several real processes in the unit tests.
 */
import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EMPTY_REGISTRY,
  sanitizeRegistryData,
  type RegistryData,
} from '../core/registry/colorRegistry';

export const REGISTRY_FILE_NAME = 'registry.json';
const LOCK_FILE_NAME = 'registry.lock';

export interface RegistryFileOptions {
  /** Directory that holds the registry (created on demand). */
  readonly dir: string;
  /** A lock older than this is assumed to be left behind by a crashed process. */
  readonly staleLockMs?: number;
  /** Give up waiting for the lock after this long and continue without it. */
  readonly acquireTimeoutMs?: number;
  readonly onWarning?: (message: string) => void;
}

export interface RegistryMutation<T> {
  readonly data: RegistryData;
  readonly changed: boolean;
  readonly result: T;
}

/** The interface the extension depends on; also implemented by an in-memory fallback. */
export interface RegistryStore {
  read(): Promise<RegistryData>;
  update<T>(mutate: (data: RegistryData) => RegistryMutation<T>): Promise<T>;
  /** Calls `onChange` (possibly several times) when another window changed the registry. */
  watch(onChange: () => void): { close(): void };
}

export class RegistryFile implements RegistryStore {
  readonly filePath: string;
  private readonly lockPath: string;
  private readonly staleLockMs: number;
  private readonly acquireTimeoutMs: number;
  private ensured: Promise<void> | undefined;

  constructor(private readonly options: RegistryFileOptions) {
    this.filePath = join(options.dir, REGISTRY_FILE_NAME);
    this.lockPath = join(options.dir, LOCK_FILE_NAME);
    this.staleLockMs = options.staleLockMs ?? 10_000;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 5_000;
  }

  /** Reads the registry without locking (writes are atomic renames, so a read never sees half a file). */
  async read(): Promise<RegistryData> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.warn(`Could not read ${this.filePath}: ${String(error)}`);
      }
      return EMPTY_REGISTRY;
    }
    try {
      return sanitizeRegistryData(JSON.parse(text));
    } catch {
      this.warn(`Ignoring a corrupt registry file at ${this.filePath}`);
      return EMPTY_REGISTRY;
    }
  }

  /** Read-modify-write under the lock. */
  async update<T>(mutate: (data: RegistryData) => RegistryMutation<T>): Promise<T> {
    await this.ensureDir();
    const token = await this.acquire();
    try {
      const outcome = mutate(await this.read());
      if (outcome.changed) {
        await this.write(outcome.data);
      }
      return outcome.result;
    } finally {
      if (token) {
        await this.release(token);
      }
    }
  }

  watch(onChange: () => void): { close(): void } {
    let watcher: FSWatcher | undefined;
    let closed = false;
    void this.ensureDir().then(() => {
      if (closed) {
        return;
      }
      try {
        watcher = watch(this.options.dir, { persistent: false }, (_event, filename) => {
          if (!filename || filename.toString() === REGISTRY_FILE_NAME) {
            onChange();
          }
        });
        watcher.on('error', (error) => {
          this.warn(`Stopped watching the registry: ${String(error)}`);
          watcher?.close();
        });
      } catch (error) {
        this.warn(`Could not watch the registry: ${String(error)}`);
      }
    });
    return {
      close: () => {
        closed = true;
        watcher?.close();
      },
    };
  }

  private ensureDir(): Promise<void> {
    this.ensured ??= mkdir(this.options.dir, { recursive: true }).then(() => undefined);
    return this.ensured;
  }

  private async write(data: RegistryData): Promise<void> {
    const temp = `${this.filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(temp, this.filePath);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  /** Returns the lock token, or `undefined` when the lock could not be taken in time. */
  private async acquire(): Promise<string | undefined> {
    const token = `${process.pid}:${randomBytes(6).toString('hex')}`;
    const deadline = Date.now() + this.acquireTimeoutMs;
    let wait = 4;
    for (;;) {
      try {
        const handle = await open(this.lockPath, 'wx');
        try {
          await handle.writeFile(token, 'utf8');
        } finally {
          await handle.close();
        }
        return token;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          this.warn(`Could not create the registry lock: ${String(error)}`);
          return undefined;
        }
      }
      if (await this.breakStaleLock()) {
        continue;
      }
      if (Date.now() > deadline) {
        this.warn('Timed out waiting for the registry lock; continuing without it');
        return undefined;
      }
      await sleep(wait + Math.random() * wait);
      wait = Math.min(wait * 2, 64);
    }
  }

  /** Removes a lock left behind by a crashed process. Returns true when the caller should retry at once. */
  private async breakStaleLock(): Promise<boolean> {
    try {
      const info = await stat(this.lockPath);
      if (Date.now() - info.mtimeMs < this.staleLockMs) {
        return false;
      }
      // Renaming is atomic: of several processes breaking the same stale lock, one wins.
      const grave = `${this.lockPath}.${process.pid}.${randomBytes(4).toString('hex')}.stale`;
      await rename(this.lockPath, grave);
      await rm(grave, { force: true });
      this.warn('Removed a stale registry lock');
      return true;
    } catch {
      // The lock disappeared in the meantime: try again right away.
      return true;
    }
  }

  private async release(token: string): Promise<void> {
    try {
      // Only remove the lock if it is still ours (it may have been broken as stale).
      if ((await readFile(this.lockPath, 'utf8')) === token) {
        await rm(this.lockPath, { force: true });
      }
    } catch {
      // Already gone.
    }
  }

  private warn(message: string): void {
    this.options.onWarning?.(message);
  }
}

/** Fallback when the global storage directory is not on a local file system: no cross-window coordination. */
export class InMemoryRegistry implements RegistryStore {
  private data: RegistryData = EMPTY_REGISTRY;

  read(): Promise<RegistryData> {
    return Promise.resolve(this.data);
  }

  update<T>(mutate: (data: RegistryData) => RegistryMutation<T>): Promise<T> {
    const outcome = mutate(this.data);
    if (outcome.changed) {
      this.data = outcome.data;
    }
    return Promise.resolve(outcome.result);
  }

  watch(): { close(): void } {
    return { close: () => undefined };
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
