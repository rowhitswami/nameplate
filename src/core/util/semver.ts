/** Minimal version comparison for `vscode.version` strings such as `1.139.1` or `1.140.0-insider`. */
export function versionAtLeast(version: string, major: number, minor: number, patch = 0): boolean {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) {
    return false;
  }
  const actual = [Number(match[1]), Number(match[2]), Number(match[3] ?? '0')];
  const wanted = [major, minor, patch];
  for (let i = 0; i < 3; i++) {
    const a = actual[i] ?? 0;
    const w = wanted[i] ?? 0;
    if (a !== w) {
      return a > w;
    }
  }
  return true;
}
