/**
 * Nameplate's Git clean filter. Git runs it (through `clean.sh` in Nameplate's
 * global storage) whenever it reads a settings file that Nameplate colors:
 * stdin is the file as it is on disk, and stdout is what Git should see, the file
 * without Nameplate's color keys.
 *
 * It must never break Git: on any problem it passes the input through
 * unchanged. Bundled on its own (dist/git-clean-filter.js); runs on the Node
 * runtime inside VS Code, so users do not need Node installed.
 *
 * Usage: clean-filter.js <path of the file relative to the repository root>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import {
  CLEAN_RECORD_FILE_NAME,
  removeManagedColors,
  type CleanRecord,
} from '../core/git/cleanSettings';

interface RecordFile {
  readonly version: 1;
  readonly files: Readonly<Record<string, CleanRecord>>;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function readStdin(): Buffer {
  return readFileSync(0);
}

export function filter(input: string, relativePath: string): string {
  const gitDir = git(['rev-parse', '--absolute-git-dir']).trim();
  const records = JSON.parse(
    readFileSync(join(gitDir, CLEAN_RECORD_FILE_NAME), 'utf8'),
  ) as RecordFile;
  const record = records.files[relativePath.replace(/\\/g, '/')];
  if (!record) {
    return input;
  }
  const cleaned = removeManagedColors(input, record);
  if (cleaned === undefined) {
    return input;
  }
  // Safety net for formatting differences: when the cleaned text means the
  // same as the staged version, hand Git the staged bytes so it sees no change.
  try {
    const staged = git(['cat-file', 'blob', `:${relativePath}`]);
    if (JSON.stringify(parse(staged)) === JSON.stringify(parse(cleaned))) {
      return staged;
    }
  } catch {
    // Not staged yet (new file): the cleaned text is the best answer.
  }
  return cleaned;
}

function main(): void {
  const raw = readStdin();
  let output: string | Buffer = raw;
  try {
    const relativePath = process.argv[2];
    if (relativePath) {
      output = filter(raw.toString('utf8'), relativePath);
    }
  } catch {
    output = raw;
  }
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}
