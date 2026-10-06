import assert from 'node:assert/strict';
import { decideWrite } from '../../src/core/colors/writePolicy';
import {
  osPathToUriPath,
  posixBasename,
  posixDirname,
  posixJoin,
  posixNormalize,
  posixRelativeInside,
} from '../../src/core/util/path';
import { versionAtLeast } from '../../src/core/util/semver';
import { escapeMarkdown, escapeStatusBarText, sanitizeUserText } from '../../src/core/util/text';

describe('write policy', () => {
  const local = { keepOutOfGit: true, canFilter: true, explicit: false };

  it('colors without touching Git outside repositories and in untitled workspaces', () => {
    for (const status of ['internal', 'no-repository'] as const) {
      assert.deepEqual(decideWrite({ ...local, status }), {
        kind: 'allow',
        exclude: false,
        filter: false,
      });
    }
  });

  it('never asks in a local repository: exclude what it creates, filter what Git may track', () => {
    assert.deepEqual(decideWrite({ ...local, status: 'absent' }), {
      kind: 'allow',
      exclude: true,
      filter: true,
    });
    assert.deepEqual(decideWrite({ ...local, status: 'tracked' }), {
      kind: 'allow',
      exclude: false,
      filter: true,
    });
    assert.deepEqual(decideWrite({ ...local, status: 'unknown' }), {
      kind: 'allow',
      exclude: false,
      filter: true,
    });
    assert.deepEqual(decideWrite({ ...local, status: 'untracked' }), {
      kind: 'allow',
      exclude: false,
      filter: true,
    });
    assert.deepEqual(decideWrite({ ...local, status: 'ignored' }), {
      kind: 'allow',
      exclude: false,
      filter: false,
    });
  });

  it('only shows the name when a tracked file cannot be filtered (remote windows)', () => {
    const remote = { ...local, canFilter: false };
    assert.deepEqual(decideWrite({ ...remote, status: 'tracked' }), {
      kind: 'deny',
      reason: 'tracked',
    });
    assert.deepEqual(decideWrite({ ...remote, status: 'unknown' }), {
      kind: 'deny',
      reason: 'unknown',
    });
    assert.deepEqual(decideWrite({ ...remote, status: 'absent' }), {
      kind: 'allow',
      exclude: true,
      filter: false,
    });
    // An explicit color choice is consent to write anyway.
    assert.deepEqual(decideWrite({ ...remote, status: 'tracked', explicit: true }), {
      kind: 'allow',
      exclude: false,
      filter: false,
    });
  });

  it('writes plainly when keeping colors out of Git is turned off', () => {
    assert.deepEqual(decideWrite({ ...local, keepOutOfGit: false, status: 'tracked' }), {
      kind: 'allow',
      exclude: false,
      filter: false,
    });
  });
});

describe('path helpers', () => {
  it('handles basename, dirname and join', () => {
    assert.equal(posixBasename('/a/b/c'), 'c');
    assert.equal(posixBasename('/a/b/c/'), 'c');
    assert.equal(posixBasename('c'), 'c');
    assert.equal(posixDirname('/a/b/c'), '/a/b');
    assert.equal(posixDirname('/a'), '/');
    assert.equal(posixDirname('a'), '.');
    assert.equal(posixJoin('/a', 'b', '../c'), '/a/c');
    assert.equal(posixNormalize('/a//b/./c/../d/'), '/a/b/d');
    assert.equal(posixNormalize('../x'), '../x');
    assert.equal(posixNormalize(''), '.');
    assert.equal(posixNormalize('/..'), '/');
  });

  it('computes relative paths inside a base', () => {
    assert.equal(posixRelativeInside('/a/b', '/a/b'), '');
    assert.equal(posixRelativeInside('/a/b', '/a/b/c/d'), 'c/d');
    assert.equal(posixRelativeInside('/a/b', '/a/bc'), undefined);
    assert.equal(posixRelativeInside('/', '/x'), 'x');
  });

  it('converts OS paths', () => {
    assert.equal(osPathToUriPath('C:\\Users\\me'), '/C:/Users/me');
    assert.equal(osPathToUriPath('/home/me'), '/home/me');
    assert.equal(osPathToUriPath('../rel'), '../rel');
  });
});

describe('semver', () => {
  it('compares versions', () => {
    assert.equal(versionAtLeast('1.139.1', 1, 138), true);
    assert.equal(versionAtLeast('1.138.0', 1, 138), true);
    assert.equal(versionAtLeast('1.137.9', 1, 138), false);
    assert.equal(versionAtLeast('1.140.0-insider', 1, 138), true);
    assert.equal(versionAtLeast('2.0', 1, 138), true);
    assert.equal(versionAtLeast('garbage', 1, 138), false);
    assert.equal(versionAtLeast('1.138.1', 1, 138, 2), false);
  });
});

describe('text helpers', () => {
  it('escapes codicons and markdown', () => {
    assert.equal(escapeStatusBarText('my $(rocket) app'), 'my \\$(rocket) app');
    assert.equal(escapeMarkdown('a*b_c[d]'), 'a\\*b\\_c\\[d\\]');
  });

  it('sanitizes user text', () => {
    assert.equal(sanitizeUserText('  a\u0000b\n\nc  '), 'a b c');
  });
});
