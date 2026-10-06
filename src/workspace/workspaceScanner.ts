/**
 * Collects the name candidates and project-type signals from the root of a
 * workspace folder: one directory listing plus the handful of manifests that
 * actually exist.
 */
import * as vscode from 'vscode';
import { isGenericName } from '../core/identity/genericNames';
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
} from '../core/identity/manifests';
import type { ProjectSignals } from '../core/identity/projectType';
import { readDirectoryNames, readTextFile } from './fileAccess';

export interface WorkspaceScan {
  /** Human-facing names (Expo app name, displayName, productName). */
  readonly manifestDisplayNames: readonly string[];
  /** Package names from manifests, in priority order. */
  readonly manifestNames: readonly string[];
  readonly signals: ProjectSignals;
}

/** Files at the workspace root that influence detection; a change triggers a refresh. */
export const WATCHED_ROOT_FILES: readonly string[] = [
  'package.json',
  'app.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pubspec.yaml',
  'composer.json',
  '.git',
];

export async function scanWorkspaceFolder(folder: vscode.Uri): Promise<WorkspaceScan> {
  const entries = await readDirectoryNames(folder);
  const has = (name: string): boolean => entries.has(name);
  const read = (name: string): Promise<string | undefined> =>
    has(name) ? readTextFile(vscode.Uri.joinPath(folder, name)) : Promise.resolve(undefined);

  const [
    packageText,
    appText,
    pyprojectText,
    requirementsText,
    cargoText,
    goModText,
    pubspecText,
    composerText,
  ] = await Promise.all([
    read('package.json'),
    read('app.json'),
    read('pyproject.toml'),
    read('requirements.txt'),
    read('Cargo.toml'),
    read('go.mod'),
    read('pubspec.yaml'),
    read('composer.json'),
  ]);

  const packageJson = packageText ? parsePackageJson(packageText) : undefined;
  const appJson = appText ? parseAppJson(appText) : undefined;
  const pyproject = pyprojectText ? parsePyproject(pyprojectText) : undefined;
  const cargo = cargoText ? parseCargoToml(cargoText) : undefined;
  const goMod = goModText ? parseGoMod(goModText) : undefined;
  const pubspec = pubspecText ? parsePubspec(pubspecText) : undefined;
  const composer = composerText ? parseComposerJson(composerText) : undefined;

  const manifestDisplayNames = compact([
    appJson?.isExpo ? appJson.name : undefined,
    packageJson?.displayName,
    packageJson?.productName,
  ]);
  const manifestNames = compact([
    packageJson?.name ? unscopePackageName(packageJson.name, isGenericName) : undefined,
    pyproject?.name,
    cargo?.name,
    goMod?.name,
    pubspec?.name,
    composer?.name,
  ]);

  const names = [...entries.keys()];
  const signals: ProjectSignals = {
    packageJson,
    expoAppJson: appJson?.isExpo === true,
    pyproject,
    requirements: requirementsText !== undefined ? parseRequirements(requirementsText) : undefined,
    hasManagePy: has('manage.py'),
    hasSetupPy: has('setup.py') || has('setup.cfg'),
    hasPipfile: has('Pipfile'),
    hasGoMod: has('go.mod'),
    hasCargoToml: has('Cargo.toml'),
    pubspec: pubspec ? { isFlutter: pubspec.isFlutter } : undefined,
    composerDependencies: composer?.dependencies,
    hasGemfile: has('Gemfile'),
    hasRailsBin: has('config.ru'),
    hasPomXml: has('pom.xml'),
    hasGradle:
      has('build.gradle') ||
      has('build.gradle.kts') ||
      has('settings.gradle') ||
      has('settings.gradle.kts'),
    hasDotnetProject: names.some((n) => /\.(csproj|fsproj|vbproj|sln|slnx)$/i.test(n)),
    hasPackageSwift: has('Package.swift'),
    hasDenoJson: has('deno.json') || has('deno.jsonc'),
    hasMixExs: has('mix.exs'),
  };

  return { manifestDisplayNames, manifestNames, signals };
}

function compact(values: readonly (string | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}
