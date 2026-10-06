import assert from 'node:assert/strict';
import { detectProjectName, upgradeCasing } from '../../src/core/identity/detectProjectName';
import {
  canonicalName,
  formatDisplayName,
  hasDistinctiveCasing,
  splitWords,
  truncateName,
} from '../../src/core/identity/formatName';
import { isGenericName } from '../../src/core/identity/genericNames';
import { buildIdentityKey } from '../../src/core/identity/identityKey';
import {
  parseAppJson,
  parseCargoToml,
  parseComposerJson,
  parseGoMod,
  parsePackageJson,
  parsePubspec,
  parsePyproject,
  parseRequirements,
  unscopePackageName,
} from '../../src/core/identity/manifests';
import { detectProjectType } from '../../src/core/identity/projectType';

describe('generic names', () => {
  it('flags names that do not identify a project', () => {
    for (const name of [
      'app',
      'SRC',
      'frontend',
      'tmp.x7Fq2',
      'untitled-1',
      'project2',
      '42',
      'a',
      '',
      'deadbeefdeadbeef',
    ]) {
      assert.equal(isGenericName(name), true, name);
    }
    for (const name of [
      'brightdesk',
      'TrailMix',
      'nameplate',
      'my-shop',
      'api-gateway',
      'docs-site',
    ]) {
      assert.equal(isGenericName(name), false, name);
    }
    assert.equal(isGenericName(undefined), true);
  });
});

describe('project name detection', () => {
  it('uses a meaningful folder name first', () => {
    assert.deepEqual(
      detectProjectName({ folderName: 'brightdesk-mobile', manifestNames: ['other'] }),
      {
        raw: 'brightdesk-mobile',
        source: 'folder',
      },
    );
  });

  it('uses the workspace file name for saved workspaces', () => {
    assert.deepEqual(
      detectProjectName({ workspaceFileName: 'brightdesk-all', folderName: 'mobile' }),
      {
        raw: 'brightdesk-all',
        source: 'workspace-file',
      },
    );
    assert.equal(
      detectProjectName({ workspaceFileName: 'workspace', folderName: 'brightdesk' }).raw,
      'brightdesk',
    );
  });

  it('falls through generic folder names to manifests', () => {
    assert.deepEqual(
      detectProjectName({
        folderName: 'app',
        manifestDisplayNames: ['BrightDesk'],
        manifestNames: ['brightdesk-app'],
      }),
      { raw: 'BrightDesk', source: 'manifest' },
    );
    assert.deepEqual(detectProjectName({ folderName: 'src', manifestNames: ['app', 'trailmix'] }), {
      raw: 'trailmix',
      source: 'manifest',
    });
  });

  it('combines repository and folder for generic sub-folders of a repository', () => {
    assert.deepEqual(
      detectProjectName({
        folderName: 'frontend',
        manifestNames: ['frontend'],
        repositoryName: 'brightdesk',
        relativePathInRepo: 'frontend',
      }),
      { raw: 'brightdesk frontend', source: 'folder-in-repository' },
    );
  });

  it('uses the repository name for a generically named clone', () => {
    assert.deepEqual(
      detectProjectName({ folderName: 'app', repositoryName: 'billing', relativePathInRepo: '' }),
      { raw: 'billing', source: 'repository' },
    );
    assert.deepEqual(detectProjectName({ folderName: 'app', repositoryDirName: 'acme' }), {
      raw: 'acme',
      source: 'repository',
    });
  });

  it('falls back to the generic folder name and finally to Untitled', () => {
    assert.deepEqual(detectProjectName({ folderName: 'app' }), { raw: 'app', source: 'folder' });
    assert.deepEqual(detectProjectName({}), { raw: 'Untitled', source: 'fallback' });
  });

  it('adopts deliberate casing from any other source', () => {
    assert.equal(
      detectProjectName({ folderName: 'brightdesk', repositoryName: 'BrightDesk' }).raw,
      'BrightDesk',
    );
    assert.equal(
      detectProjectName({ folderName: 'trail-mix', manifestDisplayNames: ['TrailMix'] }).raw,
      'TrailMix',
    );
    assert.equal(
      detectProjectName({ folderName: 'brightdesk', manifestDisplayNames: ['Bright Desk'] }).raw,
      'Bright Desk',
    );
    // Different names are not confused.
    assert.equal(
      detectProjectName({ folderName: 'brightdesk', manifestDisplayNames: ['BrightDesk Mobile'] })
        .raw,
      'brightdesk',
    );
    assert.equal(upgradeCasing('BrightDesk', { folderName: 'BRIGHTDESK' }), 'BrightDesk');
    assert.equal(upgradeCasing('---', { folderName: 'X' }), '---');
  });

  it('honours the preferred source and falls back to the automatic chain', () => {
    const candidates = {
      folderName: 'app',
      manifestNames: ['brightdesk-app'],
      repositoryName: 'brightdesk',
      relativePathInRepo: 'app',
    };
    assert.deepEqual(detectProjectName(candidates, 'folder'), { raw: 'app', source: 'folder' });
    assert.deepEqual(detectProjectName(candidates, 'manifest'), {
      raw: 'brightdesk-app',
      source: 'manifest',
    });
    assert.deepEqual(detectProjectName(candidates, 'repository'), {
      raw: 'brightdesk app',
      source: 'folder-in-repository',
    });
    assert.deepEqual(
      detectProjectName({ folderName: 'clone', repositoryName: 'billing' }, 'repository'),
      {
        raw: 'billing',
        source: 'repository',
      },
    );
    assert.deepEqual(detectProjectName({ folderName: 'clone' }, 'manifest'), {
      raw: 'clone',
      source: 'folder',
    });
    assert.deepEqual(detectProjectName({ manifestNames: ['billing'] }, 'folder'), {
      raw: 'billing',
      source: 'manifest',
    });
  });
});

describe('name formatting', () => {
  it('splits separators but keeps dots', () => {
    assert.equal(splitWords('brightdesk-mobile'), 'brightdesk mobile');
    assert.equal(splitWords('trail_mix__v2'), 'trail mix v2');
    assert.equal(splitWords('three.js'), 'three.js');
    assert.equal(splitWords('  a   b '), 'a b');
  });

  it('detects distinctive casing', () => {
    assert.equal(hasDistinctiveCasing('BrightDesk'), true);
    assert.equal(hasDistinctiveCasing('iOS'), true);
    assert.equal(hasDistinctiveCasing('brightdesk'), false);
    assert.equal(hasDistinctiveCasing('BRIGHTDESK'), false);
    assert.equal(hasDistinctiveCasing('123'), false);
  });

  it('applies the auto transform', () => {
    assert.equal(
      formatDisplayName('brightdesk-mobile', 'auto', { custom: false }),
      'BRIGHTDESK MOBILE',
    );
    assert.equal(formatDisplayName('BrightDesk', 'auto', { custom: false }), 'BrightDesk');
    assert.equal(formatDisplayName('TrailMix-api', 'auto', { custom: false }), 'TrailMix api');
    assert.equal(formatDisplayName('my typed name', 'auto', { custom: true }), 'my typed name');
    assert.equal(formatDisplayName(' padded ', 'auto', { custom: true }), 'padded');
  });

  it('applies explicit transforms, also to custom names', () => {
    assert.equal(
      formatDisplayName('brightdesk-mobile', 'none', { custom: false }),
      'brightdesk-mobile',
    );
    assert.equal(formatDisplayName('BrightDesk', 'uppercase', { custom: true }), 'BRIGHTDESK');
    assert.equal(
      formatDisplayName('BrightDesk-Mobile', 'lowercase', { custom: false }),
      'brightdesk mobile',
    );
    assert.equal(
      formatDisplayName('brightdesk-mobile', 'capitalize', { custom: false }),
      'Brightdesk Mobile',
    );
    assert.equal(formatDisplayName('brightDesk', 'capitalize', { custom: false }), 'BrightDesk');
  });

  it('truncates long names with an ellipsis', () => {
    assert.equal(truncateName('short'), 'short');
    assert.equal(truncateName('a'.repeat(50), 10), 'aaaaaaaaa…');
    assert.equal(truncateName('ab cd ef', 5), 'ab c…');
  });

  it('canonicalizes names', () => {
    assert.equal(canonicalName('Bright-Desk_Mobile'), 'brightdeskmobile');
    assert.equal(canonicalName('ünïcödé Name'), 'ünïcödéname');
  });
});

describe('identity key', () => {
  const base = {
    workspaceUri: 'file:///Users/me/code/brightdesk',
    displayName: 'BrightDesk',
  };

  it('prefers the repository, including sub-path, worktree and workspace file', () => {
    assert.deepEqual(
      buildIdentityKey({ ...base, remoteCanonical: 'github.com/me/brightdesk' }, 'auto'),
      {
        key: 'git:github.com/me/brightdesk',
        source: 'repository',
      },
    );
    assert.equal(
      buildIdentityKey(
        { ...base, remoteCanonical: 'github.com/me/mono', relativePathInRepo: 'packages/web' },
        'auto',
      ).key,
      'git:github.com/me/mono/packages/web',
    );
    assert.equal(
      buildIdentityKey(
        { ...base, remoteCanonical: 'github.com/me/x', worktreeName: 'feature' },
        'auto',
      ).key,
      'git:github.com/me/x@feature',
    );
    assert.equal(
      buildIdentityKey(
        { ...base, remoteCanonical: 'github.com/me/x', workspaceFileName: 'all' },
        'auto',
      ).key,
      'git:github.com/me/x|workspace:all',
    );
  });

  it('falls back to the path and honours explicit sources', () => {
    assert.deepEqual(buildIdentityKey(base, 'auto'), {
      key: `path:${base.workspaceUri}`,
      source: 'path',
    });
    assert.deepEqual(buildIdentityKey({ ...base, remoteCanonical: 'github.com/me/x' }, 'path'), {
      key: `path:${base.workspaceUri}`,
      source: 'path',
    });
    assert.deepEqual(buildIdentityKey(base, 'name'), { key: 'name:brightdesk', source: 'name' });
  });
});

describe('manifests', () => {
  it('reads package.json', () => {
    const pkg = parsePackageJson(
      '\uFEFF{"name":"@acme/web","displayName":"Acme Web","dependencies":{"next":"1"},"devDependencies":{"typescript":"5"},"engines":{"vscode":"^1.90.0"}}',
    );
    assert.equal(pkg?.name, '@acme/web');
    assert.equal(pkg?.displayName, 'Acme Web');
    assert.equal(pkg?.dependencies.has('next'), true);
    assert.equal(pkg?.dependencies.has('typescript'), true);
    assert.equal(pkg?.isVsCodeExtension, true);
    assert.equal(parsePackageJson('not json'), undefined);
    assert.equal(parsePackageJson('[]'), undefined);
    assert.equal(parsePackageJson('{"name": "  "}')?.name, undefined);
  });

  it('unscopes package names sensibly', () => {
    const generic = (n: string) => n === 'web';
    assert.equal(unscopePackageName('@acme/web', generic), 'acme web');
    assert.equal(unscopePackageName('@acme/billing', generic), 'billing');
    assert.equal(unscopePackageName('plain', generic), 'plain');
  });

  it('reads Expo app.json', () => {
    assert.deepEqual(parseAppJson('{"expo":{"name":"BrightDesk","slug":"brightdesk"}}'), {
      name: 'BrightDesk',
      isExpo: true,
    });
    assert.deepEqual(parseAppJson('{"name":"thing"}'), { name: 'thing', isExpo: false });
    assert.equal(parseAppJson('{'), undefined);
  });

  it('reads pyproject.toml names and dependencies', () => {
    const toml = [
      '[build-system]',
      'requires = ["setuptools"]',
      '',
      '[project]',
      'name = "brightdesk-api" # the api',
      'dependencies = [',
      '  "fastapi>=0.100",',
      "  'uvicorn[standard]',",
      '  "Django_Rest-Framework ; python_version > \'3\'",',
      ']',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest"]',
      '',
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'flask = "*"',
    ].join('\n');
    const info = parsePyproject(toml);
    assert.equal(info.name, 'brightdesk-api');
    assert.deepEqual([...info.dependencies].sort(), [
      'django-rest-framework',
      'fastapi',
      'flask',
      'pytest',
      'python',
      'uvicorn',
    ]);
    assert.equal(parsePyproject('[tool.poetry]\nname = "poet"').name, 'poet');
    assert.equal(parsePyproject('').name, undefined);
  });

  it('reads requirements.txt', () => {
    assert.deepEqual(
      [...parseRequirements('Django>=4\n# comment\n-r base.txt\nfastapi[all]==1\n\n')],
      ['django', 'fastapi'],
    );
  });

  it('reads Cargo.toml, go.mod, pubspec.yaml and composer.json', () => {
    assert.equal(parseCargoToml('[package]\nname = "ripgrep"\nversion = "1"').name, 'ripgrep');
    assert.equal(parseCargoToml('[workspace]\nmembers = ["a"]').name, undefined);
    assert.deepEqual(parseGoMod('module github.com/acme/billing/v2\n\ngo 1.22'), {
      module: 'github.com/acme/billing/v2',
      name: 'billing',
    });
    assert.deepEqual(parseGoMod('module tool'), { module: 'tool', name: 'tool' });
    assert.deepEqual(parseGoMod(''), {});
    assert.deepEqual(
      parsePubspec('name: brightdesk_app\ndependencies:\n  flutter:\n    sdk: flutter\n'),
      {
        name: 'brightdesk_app',
        isFlutter: true,
      },
    );
    assert.deepEqual(parsePubspec('name: pkg\n'), { name: 'pkg', isFlutter: false });
    assert.deepEqual(
      parseComposerJson('{"name":"acme/shop","require":{"laravel/framework":"^11"}}'),
      {
        name: 'shop',
        dependencies: new Set(['laravel/framework']),
      },
    );
    assert.equal(parseComposerJson('x'), undefined);
  });
});

describe('project type detection', () => {
  const pkg = (deps: string[], vscode = false) => ({
    name: 'x',
    dependencies: new Set(deps),
    isVsCodeExtension: vscode,
  });

  it('detects JavaScript frameworks by dependency, most specific first', () => {
    assert.equal(
      detectProjectType({ packageJson: pkg(['expo', 'react-native', 'react']) })?.label,
      'Expo',
    );
    assert.equal(
      detectProjectType({ packageJson: pkg(['react-native', 'react']) })?.label,
      'React Native',
    );
    assert.equal(detectProjectType({ packageJson: pkg(['next', 'react']) })?.label, 'Next.js');
    assert.equal(detectProjectType({ packageJson: pkg(['react']) })?.label, 'React');
    assert.equal(detectProjectType({ packageJson: pkg(['express']) })?.label, 'Node.js');
    assert.equal(detectProjectType({ packageJson: pkg([], true) })?.label, 'VS Code Extension');
    assert.equal(detectProjectType({ packageJson: pkg([]), expoAppJson: true })?.label, 'Expo');
  });

  it('detects Python frameworks and other ecosystems', () => {
    assert.equal(
      detectProjectType({ pyproject: { dependencies: new Set(['fastapi']) } })?.label,
      'FastAPI',
    );
    assert.equal(detectProjectType({ requirements: new Set(['django']) })?.label, 'Django');
    assert.equal(detectProjectType({ hasManagePy: true })?.label, 'Django');
    assert.equal(detectProjectType({ pyproject: { dependencies: new Set() } })?.label, 'Python');
    assert.equal(detectProjectType({ hasGoMod: true })?.label, 'Go');
    assert.equal(detectProjectType({ hasCargoToml: true })?.label, 'Rust');
    assert.equal(detectProjectType({ pubspec: { isFlutter: true } })?.label, 'Flutter');
    assert.equal(detectProjectType({ pubspec: { isFlutter: false } })?.label, 'Dart');
    assert.equal(
      detectProjectType({ composerDependencies: new Set(['laravel/framework']) })?.label,
      'Laravel',
    );
    assert.equal(detectProjectType({ composerDependencies: new Set() })?.label, 'PHP');
    assert.equal(
      detectProjectType({ hasGemfile: true, hasRailsBin: true })?.label,
      'Ruby on Rails',
    );
    assert.equal(detectProjectType({ hasGemfile: true })?.label, 'Ruby');
    assert.equal(detectProjectType({ hasPomXml: true })?.label, 'Java (Maven)');
    assert.equal(detectProjectType({ hasGradle: true })?.label, 'Gradle');
    assert.equal(detectProjectType({ hasDotnetProject: true })?.label, '.NET');
    assert.equal(detectProjectType({ hasPackageSwift: true })?.label, 'Swift');
    assert.equal(detectProjectType({ hasMixExs: true })?.label, 'Elixir');
    assert.equal(detectProjectType({ hasDenoJson: true })?.label, 'Deno');
    assert.equal(detectProjectType({}), undefined);
  });

  it('prefers a Python framework over a tooling-only package.json', () => {
    assert.equal(
      detectProjectType({
        packageJson: pkg(['prettier']),
        pyproject: { dependencies: new Set(['django']) },
      })?.label,
      'Django',
    );
  });
});
