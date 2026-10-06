import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colorDistance, MIN_DISTINCT_DISTANCE } from '../../src/core/colors/distance';
import { EMPTY_REGISTRY, type RegistryData } from '../../src/core/registry/colorRegistry';
import { isProcessAlive } from '../../src/registry/processAlive';
import { InMemoryRegistry, RegistryFile } from '../../src/registry/registryFile';

const sample: RegistryData = {
  version: 2,
  entries: { k: { color: '#2563eb', visible: true, claimedAt: 1, lastSeen: 1, pids: [] } },
};

describe('registry file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nameplate-registry-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads an empty registry when the file is missing or corrupt', async () => {
    const warnings: string[] = [];
    const store = new RegistryFile({ dir, onWarning: (m) => warnings.push(m) });
    assert.deepEqual(await store.read(), EMPTY_REGISTRY);
    writeFileSync(join(dir, 'registry.json'), '{ not json');
    assert.deepEqual(await store.read(), EMPTY_REGISTRY);
    assert.equal(warnings.length, 1);
  });

  it('writes atomically, only when changed, and releases the lock', async () => {
    const store = new RegistryFile({ dir: join(dir, 'nested') });
    const result = await store.update(() => ({ data: sample, changed: true, result: 42 }));
    assert.equal(result, 42);
    assert.deepEqual(await store.read(), sample);
    await store.update((data) => ({ data, changed: false, result: undefined }));
    const files = readdirSync(join(dir, 'nested'));
    assert.deepEqual(files, ['registry.json'], 'no lock or temp files are left behind');
    assert.ok(readFileSync(join(dir, 'nested', 'registry.json'), 'utf8').endsWith('}\n'));
  });

  it('serializes concurrent updates within one process', async () => {
    const store = new RegistryFile({ dir });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((data) => ({
          data: {
            version: 2,
            entries: {
              ...data.entries,
              [`k${i}`]: { color: '#2563eb', visible: true, claimedAt: i, lastSeen: i, pids: [] },
            },
          },
          changed: true,
          result: undefined,
        })),
      ),
    );
    assert.equal(Object.keys((await store.read()).entries).length, 20, 'no update was lost');
  });

  it('breaks a stale lock left behind by a crashed process', async () => {
    const lock = join(dir, 'registry.lock');
    writeFileSync(lock, 'crashed');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const warnings: string[] = [];
    const store = new RegistryFile({ dir, onWarning: (m) => warnings.push(m) });
    await store.update(() => ({ data: sample, changed: true, result: undefined }));
    assert.deepEqual(await store.read(), sample);
    assert.ok(warnings.some((w) => w.includes('stale')));
  });

  it('continues without the lock when a live lock never goes away', async () => {
    writeFileSync(join(dir, 'registry.lock'), 'busy');
    const warnings: string[] = [];
    const store = new RegistryFile({
      dir,
      acquireTimeoutMs: 100,
      onWarning: (m) => warnings.push(m),
    });
    await store.update(() => ({ data: sample, changed: true, result: undefined }));
    assert.deepEqual(await store.read(), sample);
    assert.ok(warnings.some((w) => w.includes('Timed out')));
    assert.equal(
      readFileSync(join(dir, 'registry.lock'), 'utf8'),
      'busy',
      "someone else's lock is left alone",
    );
  });

  it('notifies watchers about changes', async () => {
    const store = new RegistryFile({ dir });
    let calls = 0;
    const watcher = store.watch(() => calls++);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await store.update(() => ({ data: sample, changed: true, result: undefined }));
    for (let i = 0; i < 40 && calls === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    watcher.close();
    assert.ok(calls > 0);
  });

  it('gives simultaneously activating processes clearly different colors', async function () {
    this.timeout(30_000);
    // Six "windows" whose canonical colors are all the same, starting in the same millisecond.
    const keys = ['demo-0', 'demo-3', 'demo-8', 'demo-10', 'demo-23', 'demo-36'].map(
      (name) => `git:github.com/acme/${name}`,
    );
    const startAt = Date.now() + 1500;
    const workers = keys.map((key) =>
      fork(join(__dirname, 'helpers', 'claimWorker.js'), [dir, key, String(startAt)], {
        stdio: 'inherit',
      }),
    );
    try {
      const results = await Promise.all(
        workers.map(
          (worker) =>
            new Promise<{ key: string; color?: string; error?: string }>((resolve, reject) => {
              worker.once('message', (message) =>
                resolve(message as { key: string; color?: string }),
              );
              worker.once('exit', (code) => reject(new Error(`worker exited with ${code}`)));
            }),
        ),
      );
      for (const result of results) {
        assert.equal(result.error, undefined, `worker for ${result.key}: ${result.error ?? ''}`);
      }
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const a = results[i];
          const b = results[j];
          const distance = colorDistance(a?.color ?? '', b?.color ?? '');
          assert.ok(
            distance >= MIN_DISTINCT_DISTANCE,
            `${a?.key} ${a?.color} and ${b?.key} ${b?.color} look the same (${distance.toFixed(3)})`,
          );
        }
      }
      const registry = await new RegistryFile({ dir }).read();
      assert.equal(Object.keys(registry.entries).length, keys.length, 'no claim was lost');
    } finally {
      for (const worker of workers) {
        if (worker.connected) {
          worker.send('bye');
        }
      }
    }
  });
});

describe('in-memory registry', () => {
  it('implements the store interface', async () => {
    const store = new InMemoryRegistry();
    await store.update(() => ({ data: sample, changed: true, result: undefined }));
    assert.deepEqual(await store.read(), sample);
    store.watch().close();
  });
});

describe('process liveness', () => {
  it('detects live and dead processes', () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(-1), false);
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive(2 ** 22 + 12345), false);
  });
});
