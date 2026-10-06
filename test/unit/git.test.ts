import assert from 'node:assert/strict';
import { parseRemoteUrl, sanitizeRemoteUrl } from '../../src/core/git/remoteUrl';
import { parseGitRemotes, selectPrimaryRemote } from '../../src/core/git/gitConfig';
import { describeGitHead, parseGitHead } from '../../src/core/git/gitHead';
import {
  isSubmoduleGitDir,
  parseGitDirFile,
  resolveGitPath,
  worktreeNameFromGitDir,
} from '../../src/core/git/gitDir';
import {
  addExcludeBlock,
  EXCLUDE_MARKER,
  excludeHasPattern,
  removeExcludeBlock,
  toExcludePattern,
} from '../../src/core/git/gitExclude';
import { findGitRepository, type GitFileSystem } from '../../src/core/git/repositoryReader';

describe('remote URL parsing', () => {
  it('normalizes the common GitHub forms to one canonical identity', () => {
    const forms = [
      'git@github.com:Acme/BrightDesk.git',
      'https://github.com/acme/brightdesk.git',
      'https://github.com/acme/brightdesk',
      'ssh://git@github.com/acme/brightdesk.git',
      'git://github.com/acme/brightdesk.git',
      'ssh://git@github.com:22/acme/brightdesk.git/',
      'GitHub.com:acme/brightdesk',
    ];
    for (const url of forms) {
      assert.equal(parseRemoteUrl(url)?.canonical, 'github.com/acme/brightdesk', url);
    }
  });

  it('keeps the original casing for display and extracts owner/repo', () => {
    const parsed = parseRemoteUrl('git@github.com:Acme/BrightDesk.git');
    assert.equal(parsed?.protocol, 'ssh');
    assert.equal(parsed?.host, 'github.com');
    assert.equal(parsed?.path, 'Acme/BrightDesk');
    assert.equal(parsed?.owner, 'Acme');
    assert.equal(parsed?.repo, 'BrightDesk');
    assert.equal(parsed?.webUrl, 'https://github.com/Acme/BrightDesk');
    assert.equal(parsed?.sanitizedUrl, 'git@github.com:Acme/BrightDesk.git');
  });

  it('handles nested GitLab groups and sourcehut-style owners', () => {
    const gitlab = parseRemoteUrl('git@gitlab.com:group/subgroup/repo.git');
    assert.equal(gitlab?.owner, 'group/subgroup');
    assert.equal(gitlab?.repo, 'repo');
    assert.equal(gitlab?.canonical, 'gitlab.com/group/subgroup/repo');
    const srht = parseRemoteUrl('git@git.sr.ht:~user/repo');
    assert.equal(srht?.owner, '~user');
    assert.equal(srht?.webUrl, 'https://git.sr.ht/~user/repo');
  });

  it('strips credentials but keeps plain usernames', () => {
    const parsed = parseRemoteUrl('https://alice:s3cret@github.com/alice/repo.git');
    assert.equal(parsed?.sanitizedUrl, 'https://alice@github.com/alice/repo.git');
    assert.equal(
      sanitizeRemoteUrl('https://alice:s3cret@github.com/alice/repo.git'),
      'https://alice@github.com/alice/repo.git',
    );
    assert.equal(
      sanitizeRemoteUrl('https://oauth2:token@gitlab.com/a/b.git'),
      'https://oauth2@gitlab.com/a/b.git',
    );
    assert.equal(sanitizeRemoteUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  });

  it('understands Azure DevOps SSH and HTTPS forms', () => {
    const https = parseRemoteUrl('https://org@dev.azure.com/org/project/_git/repo');
    const ssh = parseRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo');
    assert.equal(https?.canonical, 'dev.azure.com/org/project/repo');
    assert.equal(ssh?.canonical, 'dev.azure.com/org/project/repo');
    assert.equal(https?.repo, 'repo');
    assert.equal(ssh?.webUrl, 'https://dev.azure.com/org/project/_git/repo');
    assert.equal(https?.sanitizedUrl, 'https://org@dev.azure.com/org/project/_git/repo');
    const legacy = parseRemoteUrl(
      'https://org.visualstudio.com/DefaultCollection/project/_git/repo',
    );
    assert.equal(legacy?.canonical, 'org.visualstudio.com/project/repo');
    assert.equal(legacy?.webUrl, 'https://org.visualstudio.com/project/_git/repo');
  });

  it('keeps non-standard ports and http scheme in the web URL', () => {
    const parsed = parseRemoteUrl('http://git.example.com:8080/team/repo.git');
    assert.equal(parsed?.webUrl, 'http://git.example.com:8080/team/repo');
    assert.equal(parsed?.canonical, 'git.example.com/team/repo');
    const ssh = parseRemoteUrl('ssh://git@git.example.com:2222/team/repo.git');
    assert.equal(ssh?.webUrl, 'https://git.example.com/team/repo');
  });

  it('treats local paths as remotes without identity', () => {
    for (const url of [
      '/srv/git/repo.git',
      '../repo',
      'C:\\repos\\thing',
      'file:///srv/git/repo.git',
    ]) {
      const parsed = parseRemoteUrl(url);
      assert.equal(parsed?.protocol, 'file', url);
      assert.equal(parsed?.canonical, undefined, url);
      assert.equal(parsed?.webUrl, undefined, url);
    }
    assert.equal(parseRemoteUrl('/srv/git/repo.git')?.repo, 'repo');
    assert.equal(parseRemoteUrl('')?.canonical, undefined);
    assert.equal(parseRemoteUrl('   '), undefined);
  });
});

describe('git config', () => {
  it('extracts remotes with comments, quoting and continuations', () => {
    const config = [
      '[core]',
      '\trepositoryformatversion = 0 ; trailing',
      '[remote "origin"]',
      '\turl = git@github.com:a/b.git # fetch url',
      '\tpushurl = git@github.com:a/b-push.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[remote "upstream"]',
      '\turl = "https://github.com/c/d.git"',
      '[remote "weird name"]',
      '\turl = https://example.com/\\',
      'continued/repo.git',
      '[remote.dotted]',
      '\tURL = https://example.com/dotted.git',
      '[remote "empty"]',
      '\tfetch = x',
    ].join('\n');
    const remotes = parseGitRemotes(config);
    assert.deepEqual(remotes, [
      { name: 'origin', url: 'git@github.com:a/b.git' },
      { name: 'upstream', url: 'https://github.com/c/d.git' },
      { name: 'weird name', url: 'https://example.com/continued/repo.git' },
      { name: 'dotted', url: 'https://example.com/dotted.git' },
    ]);
  });

  it('prefers origin, then upstream, then the first remote', () => {
    assert.equal(
      selectPrimaryRemote([
        { name: 'fork', url: 'f' },
        { name: 'origin', url: 'o' },
      ])?.name,
      'origin',
    );
    assert.equal(
      selectPrimaryRemote([
        { name: 'fork', url: 'f' },
        { name: 'upstream', url: 'u' },
      ])?.name,
      'upstream',
    );
    assert.equal(selectPrimaryRemote([{ name: 'fork', url: 'f' }])?.name, 'fork');
    assert.equal(selectPrimaryRemote([]), undefined);
  });
});

describe('git HEAD', () => {
  it('parses branches, detached commits and other refs', () => {
    assert.deepEqual(parseGitHead('ref: refs/heads/main\n'), { kind: 'branch', name: 'main' });
    assert.deepEqual(parseGitHead('ref: refs/heads/feature/x'), {
      kind: 'branch',
      name: 'feature/x',
    });
    assert.deepEqual(parseGitHead('ref: refs/remotes/origin/x'), {
      kind: 'ref',
      ref: 'refs/remotes/origin/x',
    });
    const sha = 'a'.repeat(40);
    assert.deepEqual(parseGitHead(sha), { kind: 'detached', commit: sha });
    assert.deepEqual(parseGitHead('b'.repeat(64)), { kind: 'detached', commit: 'b'.repeat(64) });
    assert.deepEqual(parseGitHead(''), { kind: 'unknown' });
    assert.deepEqual(parseGitHead(undefined), { kind: 'unknown' });
    assert.deepEqual(parseGitHead('garbage'), { kind: 'unknown' });
  });

  it('describes heads', () => {
    assert.equal(describeGitHead({ kind: 'branch', name: 'main' }), 'main');
    assert.equal(
      describeGitHead({ kind: 'detached', commit: 'abcdef0123456789' }),
      'abcdef0 (detached)',
    );
    assert.equal(describeGitHead({ kind: 'ref', ref: 'refs/x' }), 'refs/x');
    assert.equal(describeGitHead({ kind: 'unknown' }), undefined);
  });
});

describe('git dir files', () => {
  it('parses gitdir files and resolves paths', () => {
    assert.equal(parseGitDirFile('gitdir: ../.git/modules/lib\n'), '../.git/modules/lib');
    assert.equal(parseGitDirFile('nothing'), undefined);
    assert.equal(resolveGitPath('/repo/wt', '../.git/worktrees/wt'), '/repo/.git/worktrees/wt');
    assert.equal(resolveGitPath('/repo/wt', '/abs/.git/worktrees/wt'), '/abs/.git/worktrees/wt');
    assert.equal(
      resolveGitPath('/repo/wt', 'C:\\repo\\.git\\worktrees\\wt'),
      '/C:/repo/.git/worktrees/wt',
    );
  });

  it('recognizes worktrees and submodules', () => {
    assert.equal(worktreeNameFromGitDir('/repo/.git/worktrees/feature-x'), 'feature-x');
    assert.equal(worktreeNameFromGitDir('/repo/.git'), undefined);
    assert.equal(isSubmoduleGitDir('/super/.git/modules/lib'), true);
    assert.equal(isSubmoduleGitDir('/repo/.git'), false);
  });
});

describe('repository reader', () => {
  function memoryFs(files: Record<string, string>, dirs: string[]): GitFileSystem {
    return {
      readText: (path) => Promise.resolve(files[path]),
      stat: (path) =>
        Promise.resolve(path in files ? 'file' : dirs.includes(path) ? 'directory' : undefined),
    };
  }

  it('reads a plain repository', async () => {
    const fs = memoryFs(
      {
        '/home/me/proj/.git/HEAD': 'ref: refs/heads/main',
        '/home/me/proj/.git/config': '[remote "origin"]\n\turl = git@github.com:me/proj.git',
      },
      ['/home/me/proj/.git'],
    );
    const repo = await findGitRepository(fs, '/home/me/proj');
    assert.equal(repo?.root, '/home/me/proj');
    assert.equal(repo?.gitDir, '/home/me/proj/.git');
    assert.equal(repo?.commonDir, '/home/me/proj/.git');
    assert.deepEqual(repo?.head, { kind: 'branch', name: 'main' });
    assert.equal(repo?.remotes[0]?.url, 'git@github.com:me/proj.git');
    assert.equal(repo?.relativePath, '');
    assert.equal(repo?.worktreeName, undefined);
    assert.equal(repo?.isSubmodule, false);
  });

  it('walks up from a sub-folder and reports the relative path', async () => {
    const fs = memoryFs({ '/r/.git/HEAD': 'ref: refs/heads/dev' }, ['/r/.git']);
    const repo = await findGitRepository(fs, '/r/packages/web');
    assert.equal(repo?.root, '/r');
    assert.equal(repo?.relativePath, 'packages/web');
    assert.deepEqual(repo?.remotes, []);
  });

  it('resolves linked worktrees through the .git file and commondir', async () => {
    const fs = memoryFs(
      {
        '/main/.git/config': '[remote "origin"]\n\turl = https://github.com/me/proj.git',
        '/main/.git/worktrees/feature/HEAD': 'ref: refs/heads/feature',
        '/main/.git/worktrees/feature/commondir': '../..\n',
        '/wt/feature/.git': 'gitdir: /main/.git/worktrees/feature\n',
      },
      ['/main/.git', '/main/.git/worktrees/feature'],
    );
    const repo = await findGitRepository(fs, '/wt/feature');
    assert.equal(repo?.root, '/wt/feature');
    assert.equal(repo?.gitDir, '/main/.git/worktrees/feature');
    assert.equal(repo?.commonDir, '/main/.git');
    assert.equal(repo?.worktreeName, 'feature');
    assert.deepEqual(repo?.head, { kind: 'branch', name: 'feature' });
    assert.equal(repo?.remotes[0]?.url, 'https://github.com/me/proj.git');
  });

  it('resolves submodules', async () => {
    const fs = memoryFs(
      {
        '/super/lib/.git': 'gitdir: ../.git/modules/lib',
        '/super/.git/modules/lib/HEAD': 'ref: refs/heads/main',
        '/super/.git/modules/lib/config': '[remote "origin"]\n\turl = git@github.com:me/lib.git',
      },
      ['/super/.git', '/super/.git/modules/lib'],
    );
    const repo = await findGitRepository(fs, '/super/lib');
    assert.equal(repo?.isSubmodule, true);
    assert.equal(repo?.commonDir, '/super/.git/modules/lib');
    assert.equal(repo?.remotes[0]?.url, 'git@github.com:me/lib.git');
  });

  it('returns undefined outside any repository and respects maxDepth', async () => {
    const fs = memoryFs({ '/a/.git/HEAD': 'ref: refs/heads/main' }, ['/a/.git']);
    assert.equal(await findGitRepository(fs, '/x/y/z'), undefined);
    assert.equal(await findGitRepository(fs, '/a/b/c/d', { maxDepth: 1 }), undefined);
    assert.equal((await findGitRepository(fs, '/a/b/c/d', { maxDepth: 3 }))?.root, '/a');
  });
});

describe('git exclude', () => {
  const pattern = '/.vscode/settings.json';

  it('builds anchored, escaped patterns', () => {
    assert.equal(toExcludePattern('.vscode/settings.json'), '/.vscode/settings.json');
    assert.equal(
      toExcludePattern('apps/web/.vscode/settings.json'),
      '/apps/web/.vscode/settings.json',
    );
    assert.equal(toExcludePattern('#weird [dir]/x*?.json'), '/\\#weird \\[dir\\]/x\\*\\?.json');
  });

  it('adds a marked block once and detects existing patterns', () => {
    const once = addExcludeBlock('', pattern);
    assert.ok(once.startsWith(EXCLUDE_MARKER));
    assert.ok(once.endsWith(`${pattern}\n`));
    assert.equal(addExcludeBlock(once, pattern), once);
    assert.equal(excludeHasPattern(once, pattern), true);
    assert.equal(excludeHasPattern('# /.vscode/settings.json', pattern), false);
    const existing = 'node_modules/';
    assert.ok(addExcludeBlock(existing, pattern).startsWith('node_modules/\n#'));
    assert.ok(addExcludeBlock('a\r\nb\r\n', pattern).includes('\r\n/.vscode/settings.json\r\n'));
  });

  it('removes only its own block', () => {
    const base = '# user comment\n*.log\n';
    const withBlock = addExcludeBlock(base, pattern);
    assert.equal(removeExcludeBlock(withBlock, pattern), base);
    const manual = `${base}${pattern}\n`;
    assert.equal(removeExcludeBlock(manual, pattern), manual);
    assert.equal(removeExcludeBlock('', pattern), '');
  });
});
