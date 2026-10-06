/**
 * Whether a process exists. Every VS Code window runs its own extension host
 * process, so "the process that claimed this color is alive" means "that window
 * is still open", without heartbeats or polling.
 */
export function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
