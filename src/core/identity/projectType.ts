/**
 * Lightweight project/framework detection from root manifests only. It is
 * table-driven and conservative: a type is reported only when a manifest
 * declares it unambiguously. The result is informational (tooltip and
 * project information), never used for naming or coloring.
 */
import type { PackageJsonInfo, PyprojectInfo } from './manifests';

export interface ProjectType {
  readonly id: string;
  readonly label: string;
}

export interface ProjectSignals {
  readonly packageJson?: PackageJsonInfo;
  readonly expoAppJson?: boolean;
  readonly pyproject?: PyprojectInfo;
  readonly requirements?: ReadonlySet<string>;
  readonly hasManagePy?: boolean;
  readonly hasSetupPy?: boolean;
  readonly hasPipfile?: boolean;
  readonly hasGoMod?: boolean;
  readonly hasCargoToml?: boolean;
  readonly pubspec?: { readonly isFlutter: boolean };
  readonly composerDependencies?: ReadonlySet<string>;
  readonly hasGemfile?: boolean;
  readonly hasRailsBin?: boolean;
  readonly hasPomXml?: boolean;
  readonly hasGradle?: boolean;
  readonly hasDotnetProject?: boolean;
  readonly hasPackageSwift?: boolean;
  readonly hasDenoJson?: boolean;
  readonly hasMixExs?: boolean;
}

const JS_FRAMEWORKS: readonly { dependency: string; id: string; label: string }[] = [
  { dependency: 'expo', id: 'expo', label: 'Expo' },
  { dependency: 'react-native', id: 'react-native', label: 'React Native' },
  { dependency: 'next', id: 'nextjs', label: 'Next.js' },
  { dependency: 'nuxt', id: 'nuxt', label: 'Nuxt' },
  { dependency: '@angular/core', id: 'angular', label: 'Angular' },
  { dependency: '@sveltejs/kit', id: 'sveltekit', label: 'SvelteKit' },
  { dependency: 'svelte', id: 'svelte', label: 'Svelte' },
  { dependency: 'astro', id: 'astro', label: 'Astro' },
  { dependency: '@remix-run/react', id: 'remix', label: 'Remix' },
  { dependency: '@nestjs/core', id: 'nestjs', label: 'NestJS' },
  { dependency: 'electron', id: 'electron', label: 'Electron' },
  { dependency: 'vue', id: 'vue', label: 'Vue' },
  { dependency: 'react', id: 'react', label: 'React' },
];

const PYTHON_FRAMEWORKS: readonly { dependency: string; id: string; label: string }[] = [
  { dependency: 'django', id: 'django', label: 'Django' },
  { dependency: 'fastapi', id: 'fastapi', label: 'FastAPI' },
  { dependency: 'flask', id: 'flask', label: 'Flask' },
];

export function detectProjectType(signals: ProjectSignals): ProjectType | undefined {
  const pkg = signals.packageJson;
  if (pkg) {
    if (pkg.isVsCodeExtension) {
      return { id: 'vscode-extension', label: 'VS Code Extension' };
    }
    for (const framework of JS_FRAMEWORKS) {
      if (pkg.dependencies.has(framework.dependency)) {
        return { id: framework.id, label: framework.label };
      }
    }
    if (signals.expoAppJson) {
      return { id: 'expo', label: 'Expo' };
    }
  }

  const pythonDeps = new Set<string>([
    ...(signals.pyproject?.dependencies ?? []),
    ...(signals.requirements ?? []),
  ]);
  const isPython =
    signals.pyproject !== undefined ||
    signals.requirements !== undefined ||
    signals.hasSetupPy === true ||
    signals.hasPipfile === true ||
    signals.hasManagePy === true;
  if (isPython) {
    if (signals.hasManagePy || pythonDeps.has('django')) {
      return { id: 'django', label: 'Django' };
    }
    for (const framework of PYTHON_FRAMEWORKS) {
      if (pythonDeps.has(framework.dependency)) {
        return { id: framework.id, label: framework.label };
      }
    }
  }

  if (signals.hasGoMod) {
    return { id: 'go', label: 'Go' };
  }
  if (signals.hasCargoToml) {
    return { id: 'rust', label: 'Rust' };
  }
  if (signals.pubspec) {
    return signals.pubspec.isFlutter
      ? { id: 'flutter', label: 'Flutter' }
      : { id: 'dart', label: 'Dart' };
  }
  if (signals.composerDependencies) {
    return signals.composerDependencies.has('laravel/framework')
      ? { id: 'laravel', label: 'Laravel' }
      : { id: 'php', label: 'PHP' };
  }
  if (signals.hasGemfile) {
    return signals.hasRailsBin
      ? { id: 'rails', label: 'Ruby on Rails' }
      : { id: 'ruby', label: 'Ruby' };
  }
  if (signals.hasPomXml) {
    return { id: 'maven', label: 'Java (Maven)' };
  }
  if (signals.hasGradle) {
    return { id: 'gradle', label: 'Gradle' };
  }
  if (signals.hasDotnetProject) {
    return { id: 'dotnet', label: '.NET' };
  }
  if (signals.hasPackageSwift) {
    return { id: 'swift', label: 'Swift' };
  }
  if (signals.hasMixExs) {
    return { id: 'elixir', label: 'Elixir' };
  }
  if (signals.hasDenoJson) {
    return { id: 'deno', label: 'Deno' };
  }
  if (isPython) {
    return { id: 'python', label: 'Python' };
  }
  if (pkg) {
    return { id: 'nodejs', label: 'Node.js' };
  }
  return undefined;
}
