// Removes build artifacts. Cross-platform replacement for `rm -rf`.
import { rmSync } from 'node:fs';

for (const dir of ['dist', 'out']) {
  rmSync(dir, { recursive: true, force: true });
}
console.log('Removed dist/ and out/');
