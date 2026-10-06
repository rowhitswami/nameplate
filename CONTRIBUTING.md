# Contributing to Nameplate

Thanks for helping. This document covers the workflow and the few rules that keep the extension trustworthy.

## Setup

- Node.js 22 or newer and npm.
- `npm install`
- Open the folder in VS Code and press <kbd>F5</kbd> to run the extension in an Extension Development Host. The **Run Extension (fixture workspace)** configuration opens `test/fixtures/sample-project`.

## Scripts

| Script                         | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `npm run watch`                | Rebuild `dist/extension.js` on every change.                              |
| `npm run typecheck`            | `tsc --noEmit` over sources and tests.                                    |
| `npm run lint`                 | ESLint with type-aware rules.                                             |
| `npm run format`               | Prettier (`format:check` to verify only).                                 |
| `npm run test:unit`            | Mocha unit tests for `src/core` (fast, no VS Code needed).                |
| `npm run test:integration`     | Downloads VS Code and runs `test/integration` in a real instance.         |
| `npm run check`                | typecheck, lint, format check and unit tests (what CI runs first).        |
| `npm run package`              | Builds and creates the `.vsix`.                                           |
| `npm run test:multiwindow`     | Opens six windows of an isolated VS Code at once; checks distinct colors. |
| `node scripts/render-icon.mjs` | Regenerates `media/icon.png` from the shapes in the script.               |

## Code layout

- `src/core/**` is plain TypeScript: no `vscode`, no Node built-ins (ESLint enforces this). Everything with logic worth testing lives here and has unit tests in `test/unit`.
- Everything else under `src/` is the VS Code layer: thin adapters over the configuration API, file system, Git extension, status bar and quick picks. It is covered by `test/integration`.
- `docs/ARCHITECTURE.md` explains the pipeline and the invariants.

## Rules that must hold

1. **Never reorder, remove or recolor an entry of the automatic palette** (0.1.1 replaced olive with lime before any public release; don't do that again after publishing) in `src/core/colors/palette.ts` (`auto: true`). The automatic color of every existing project depends on that order. Add new automatic colors at the end only. A unit test freezes the current list.
2. **Never change `stableHash`, `seededPermutation` or `candidateOrder`** for the same reason. A unit test pins known key → color pairs.
3. **Only write the managed keys** of `workbench.colorCustomizations` and only through the planner in `src/core/colors/colorCustomizations.ts`. Every write must be reversible from the ownership record.
4. **No telemetry, no network, no new runtime dependencies** without a very good reason. The extension currently has none.
5. **Never guess** values shown to the user (environment labels, project types). Show nothing rather than something invented.
6. User-visible strings are plain English for now; keep them short and in the style of VS Code's own UI.

## Tests

Add or update unit tests for anything in `src/core`. Anything that touches how windows coordinate colors must also pass `npm run test:multiwindow`, which opens several real windows at once. The single-window integration tests cannot catch bugs between windows. For behaviour that depends on VS Code (settings writes, status bar, commands), extend `test/integration/extension.test.ts`. The integration suite runs against a temporary copy of the fixture workspace, so it can freely write settings.

## Pull requests

- Keep PRs focused; describe the user-visible change and update `CHANGELOG.md` under _Unreleased_.
- `npm run check` must pass. CI also runs the integration tests on Linux, macOS and Windows.
- Follow the existing style; Prettier and ESLint are the arbiters.

## Releasing

1. Update the version in `package.json` and move the _Unreleased_ notes in `CHANGELOG.md` to the new version.
2. Tag `v<version>` and push. The release workflow builds the `.vsix` and attaches it to a GitHub release. Publishing to the Marketplace / Open VSX is wired up but only runs when the `VSCE_PAT` / `OVSX_PAT` secrets exist.
