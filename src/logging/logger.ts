import * as vscode from 'vscode';
import { EXTENSION_NAME } from '../constants';

export interface Logger extends vscode.Disposable {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  /** Reveals the output channel. */
  show(): void;
}

/** A `LogOutputChannel` wrapper: diagnostics go to the Output panel, never to notifications. */
export function createLogger(): Logger {
  const channel = vscode.window.createOutputChannel(EXTENSION_NAME, { log: true });
  return {
    trace: (message, ...args) => channel.trace(message, ...args),
    debug: (message, ...args) => channel.debug(message, ...args),
    info: (message, ...args) => channel.info(message, ...args),
    warn: (message, ...args) => channel.warn(message, ...args),
    error: (message, error) => {
      if (error === undefined) {
        channel.error(message);
      } else {
        channel.error(`${message}: ${describeError(error)}`);
      }
    },
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
