/**
 * A stand-in for one VS Code window in the multi-process registry test: waits
 * for a common start time, claims a color through the real lock and registry
 * file, reports it, and stays alive (its process id marks the "window" as open)
 * until the parent says goodbye.
 */
import { AUTO_PALETTE } from '../../../src/core/colors/palette';
import { planClaim } from '../../../src/core/registry/colorRegistry';
import { isProcessAlive } from '../../../src/registry/processAlive';
import { RegistryFile } from '../../../src/registry/registryFile';

const [dir = '', key = '', startAt = '0'] = process.argv.slice(2);

async function main(): Promise<void> {
  const store = new RegistryFile({ dir });
  // Busy-wait so that all workers hit the lock in the same millisecond.
  while (Date.now() < Number(startAt)) {
    // spin
  }
  const color = await store.update((data) => {
    const outcome = planClaim(
      data,
      { key, name: key, pid: process.pid },
      { now: Date.now(), palette: AUTO_PALETTE, isAlive: isProcessAlive, avoidCollisions: true },
    );
    return { data: outcome.registry, changed: outcome.changed, result: outcome.active };
  });
  process.send?.({ key, color });
}

process.on('message', () => process.exit(0));
main().catch((error: unknown) => {
  process.send?.({ key, error: String(error) });
  process.exit(1);
});
