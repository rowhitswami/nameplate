/**
 * Git remote URL parsing and normalization.
 *
 * The canonical form (`host/owner/repo`, lowercase, no protocol, no `.git`) is
 * what makes the same repository produce the same identity, and therefore the
 * same color, whether it was cloned over SSH or HTTPS.
 */

export type RemoteProtocol = 'ssh' | 'https' | 'http' | 'git' | 'file' | 'other';

export interface ParsedRemote {
  /** The URL with any embedded credentials removed. Safe to display and copy. */
  readonly sanitizedUrl: string;
  readonly protocol: RemoteProtocol;
  /** Lowercase host without port; absent for local paths. */
  readonly host?: string;
  /** Repository path without leading slash or `.git`, original casing (e.g. `Owner/Repo`). */
  readonly path: string;
  /** Everything before the last path segment (e.g. `owner` or `group/subgroup`). */
  readonly owner?: string;
  /** Last path segment, original casing. */
  readonly repo?: string;
  /** Stable lowercase identity, e.g. `github.com/owner/repo`. Absent for local paths. */
  readonly canonical?: string;
  /** Best-effort browser URL of the repository. */
  readonly webUrl?: string;
}

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):\/\//i;
const SCP_PATTERN = /^(?:([^@/]+)@)?([^:/]+):(.*)$/;

export function parseRemoteUrl(input: string): ParsedRemote | undefined {
  const url = input.trim();
  if (url.length === 0) {
    return undefined;
  }
  const schemeMatch = SCHEME_PATTERN.exec(url);
  if (schemeMatch) {
    return parseWithScheme(url, (schemeMatch[1] ?? '').toLowerCase());
  }
  const scp = SCP_PATTERN.exec(url);
  if (scp && !isWindowsDrive(scp[2] ?? '')) {
    const user = scp[1];
    const host = (scp[2] ?? '').toLowerCase();
    const path = cleanPath(scp[3] ?? '');
    const sanitizedUrl = user ? `${user}@${host}:${scp[3] ?? ''}` : url;
    return build({ protocol: 'ssh', host, path, sanitizedUrl, scheme: 'ssh' });
  }
  return build({ protocol: 'file', path: cleanPath(url), sanitizedUrl: url });
}

/** Removes `user:password@` credentials from a URL; returns other values unchanged. */
export function sanitizeRemoteUrl(input: string): string {
  return parseRemoteUrl(input)?.sanitizedUrl ?? input.trim();
}

function parseWithScheme(url: string, scheme: string): ParsedRemote | undefined {
  const rest = url.slice(scheme.length + 3);
  if (scheme === 'file') {
    return build({ protocol: 'file', path: cleanPath(rest), sanitizedUrl: url });
  }
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const rawPath = slash === -1 ? '' : rest.slice(slash + 1);
  const at = authority.lastIndexOf('@');
  const userInfo = at === -1 ? undefined : authority.slice(0, at);
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  const hostMatch = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
  const host = (hostMatch?.[1] ?? hostPort).toLowerCase();
  const port = hostMatch?.[2];
  if (host.length === 0) {
    return undefined;
  }
  const protocol = toProtocol(scheme);
  // Keep a plain username (git@, org@) but never a password.
  const safeUser = userInfo?.includes(':') ? userInfo.slice(0, userInfo.indexOf(':')) : userInfo;
  const safeAuthority = `${safeUser ? `${safeUser}@` : ''}${host}${port ? `:${port}` : ''}`;
  const sanitizedUrl = `${scheme}://${safeAuthority}${slash === -1 ? '' : `/${rawPath}`}`;
  return build({ protocol, host, port, path: cleanPath(rawPath), sanitizedUrl, scheme });
}

interface BuildInput {
  readonly protocol: RemoteProtocol;
  readonly host?: string;
  readonly port?: string;
  readonly path: string;
  readonly sanitizedUrl: string;
  readonly scheme?: string;
}

function build(input: BuildInput): ParsedRemote | undefined {
  const { protocol, host, port, path, sanitizedUrl, scheme } = input;
  if (path.length === 0 && !host) {
    return undefined;
  }
  if (!host) {
    const repo = lastSegment(path);
    return { sanitizedUrl, protocol, path, repo, owner: ownerOf(path) };
  }
  const { canonicalHost, canonicalPath, webPath } = normalizeHostSpecific(host, path);
  const repo = lastSegment(canonicalPath);
  const owner = ownerOf(canonicalPath);
  const canonical =
    canonicalPath.length > 0 ? `${canonicalHost}/${canonicalPath.toLowerCase()}` : canonicalHost;
  const webScheme = scheme === 'http' ? 'http' : 'https';
  const webPort = scheme === 'http' || scheme === 'https' ? (port ? `:${port}` : '') : '';
  const webUrl =
    webPath.length > 0 ? `${webScheme}://${canonicalHost}${webPort}/${webPath}` : undefined;
  return { sanitizedUrl, protocol, host, path: canonicalPath, owner, repo, canonical, webUrl };
}

function normalizeHostSpecific(
  host: string,
  path: string,
): { canonicalHost: string; canonicalPath: string; webPath: string } {
  // Azure DevOps: https://dev.azure.com/org/project/_git/repo
  //               git@ssh.dev.azure.com:v3/org/project/repo
  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com') {
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '_git');
    if (segments[0] === 'v3') {
      segments.shift();
    }
    const canonicalPath = segments.join('/');
    const webPath =
      segments.length >= 3
        ? `${segments.slice(0, -1).join('/')}/_git/${segments[segments.length - 1] ?? ''}`
        : canonicalPath;
    return { canonicalHost: 'dev.azure.com', canonicalPath, webPath };
  }
  if (host.endsWith('.visualstudio.com')) {
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '_git');
    if (segments[0]?.toLowerCase() === 'defaultcollection') {
      segments.shift();
    }
    const canonicalPath = segments.join('/');
    const webPath =
      segments.length >= 2
        ? `${segments.slice(0, -1).join('/')}/_git/${segments[segments.length - 1] ?? ''}`
        : canonicalPath;
    return { canonicalHost: host, canonicalPath, webPath };
  }
  return { canonicalHost: host, canonicalPath: path, webPath: path };
}

function cleanPath(rawPath: string): string {
  let path = rawPath.trim().replace(/\\/g, '/');
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path.toLowerCase().endsWith('.git')) {
    path = path.slice(0, -4);
  }
  return path.replace(/\/+$/, '');
}

function lastSegment(path: string): string | undefined {
  const segments = path.split('/').filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

function ownerOf(path: string): string | undefined {
  const segments = path.split('/').filter((s) => s.length > 0);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
}

function toProtocol(scheme: string): RemoteProtocol {
  switch (scheme) {
    case 'ssh':
    case 'git+ssh':
    case 'ssh+git':
      return 'ssh';
    case 'https':
      return 'https';
    case 'http':
      return 'http';
    case 'git':
      return 'git';
    default:
      return 'other';
  }
}

function isWindowsDrive(host: string): boolean {
  return /^[A-Za-z]$/.test(host);
}
