/**
 * Folder and package names that say nothing about *which* project this is.
 * When the folder name is one of these, Nameplate looks at other sources
 * (manifests, the Git repository) before settling for it.
 */
const GENERIC_NAMES: ReadonlySet<string> = new Set([
  'app',
  'apps',
  'application',
  'src',
  'source',
  'sources',
  'code',
  'repo',
  'repos',
  'repository',
  'project',
  'projects',
  'workspace',
  'workspaces',
  'work',
  'dev',
  'development',
  'main',
  'master',
  'trunk',
  'develop',
  'frontend',
  'front-end',
  'front',
  'backend',
  'back-end',
  'back',
  'client',
  'server',
  'web',
  'website',
  'site',
  'www',
  'api',
  'mobile',
  'ios',
  'android',
  'desktop',
  'ui',
  'docs',
  'doc',
  'documentation',
  'test',
  'tests',
  'testing',
  'tmp',
  'temp',
  'new',
  'untitled',
  'demo',
  'example',
  'examples',
  'sample',
  'samples',
  'starter',
  'template',
  'boilerplate',
  'lib',
  'libs',
  'library',
  'pkg',
  'package',
  'packages',
  'service',
  'services',
  'core',
  'common',
  'shared',
  'infra',
  'infrastructure',
  'deploy',
  'build',
  'dist',
  'public',
  'root',
  'home',
  'user',
  'my-app',
  'myapp',
  'my-project',
  'myproject',
  'hello-world',
  'monorepo',
  'scratch',
  'playground',
  'sandbox',
  'default',
  'misc',
  'other',
  'stuff',
  'files',
  'folder',
  'directory',
  'git',
  'github',
  'gitlab',
]);

/** True when a name is too generic to identify a project on its own. */
export function isGenericName(name: string | undefined): boolean {
  if (!name) {
    return true;
  }
  const normalized = name.trim().toLowerCase();
  if (normalized.length <= 1) {
    return true;
  }
  if (GENERIC_NAMES.has(normalized)) {
    return true;
  }
  // tmp.x7Fq2, temp-123, untitled-1, project2, test3 …
  if (/^(tmp|temp|untitled|project|test|new)[-_.]?[a-z0-9]*$/.test(normalized)) {
    return true;
  }
  // Purely numeric or hash-like names.
  if (/^[0-9]+$/.test(normalized) || /^[0-9a-f]{12,}$/.test(normalized)) {
    return true;
  }
  return false;
}
