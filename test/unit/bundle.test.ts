/**
 * The bundles must load: a dependency that only works unbundled (like the UMD
 * build of jsonc-parser) would otherwise crash activation or the Git filter.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import Module from 'node:module';

const DIST = resolve(__dirname, '..', '..', '..', 'dist');

describe('bundles', () => {
  it('loads the Git filter bundle', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const filter = require(resolve(DIST, 'git-clean-filter.js')) as { filter?: unknown };
    assert.equal(typeof filter.filter, 'function');
  });

  it('loads the extension bundle (with a stub for the vscode module)', () => {
    const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
    const original = loader._load;
    loader._load = function (request: string, ...rest: unknown[]) {
      if (request === 'vscode') {
        return new Proxy({}, { get: () => () => undefined });
      }
      return original.call(this, request, ...rest);
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const extension = require(resolve(DIST, 'extension.js')) as { activate?: unknown };
      assert.equal(typeof extension.activate, 'function');
    } finally {
      loader._load = original;
    }
  });
});
