# Changelog

All notable changes to Nameplate are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-06

### Changed

- **Colors never reach Git, and Nameplate never asks.** In a settings file that a repository already commits, Nameplate now registers a local Git clean filter (`.git/config` + `.git/info/attributes`, both never committed) that hides its lines from `git status`, `git diff` and commits, while your own edits stay visible. Checkout, pull, stash and rebase keep working. The filter runs on VS Code's built-in Node runtime. Everything is removed when Nameplate stops coloring the project.
- The "settings file is tracked by Git" question is gone; `nameplate.gitTrackedSettings` and `nameplate.hideSettingsFromGit` are replaced by `nameplate.keepColorsOutOfGit` (default on).
- The welcome notification appears once per machine instead of once per window.
- Turning Nameplate off hides the project name immediately, then removes the colors.
- Works in more editors built on VS Code: the minimum version is now VS Code 1.85.

### Fixed

- `git status` no longer lists a committed settings file as modified after Nameplate changed its size (Git skips filters when a file's size changes; Nameplate refreshes Git's cache for that one file when nothing really changed).
- The bundled extension no longer depends on `jsonc-parser`'s UMD build, which cannot be bundled.

## [0.1.1] - 2026-10-06

### Fixed

- **Windows that opened at the same time could get the same color.** When several windows activated together (on startup, or right after installing), each one read a stale copy of the color registry: VS Code syncs `globalState` between windows only after a delay, and every window writes the whole object back, so they dropped each other's entries. The registry now lives in a single file in Nameplate's global storage folder, changed only under a cross-process lock.
- **Clashing colors stayed forever.** A window whose automatic color looks like that of another open window now moves to a free color by itself (the window that got the color later moves; custom colors and colors set by others never move). Existing clashes from 0.1.0 heal on the first start of this version.

### Changed

- Colors are now compared by how they look (OKLab distance), not by hex value: near-twins such as teal and green count as a clash, and close relatives such as blue and indigo are avoided when a better color is free.
- The automatic palette uses lime instead of olive, which was almost indistinguishable from green. Projects that had olive get a new color.
- Windows showing a color set by someone else (for example Peacock) are taken into account, so no other window picks a look-alike.

### Added

- `npm run test:multiwindow`: opens six windows of an isolated VS Code at once and checks that they all get clearly different colors.

## [0.1.0] - 2026-10-06

Initial release.

### Added

- Project name in the status bar, detected from the workspace, folder, manifests (`package.json`, Expo `app.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, `composer.json`) and the Git remote, with casing adopted from any source that spells it deliberately.
- Deterministic status bar color per project derived from the Git remote (or the workspace path), with a curated WCAG-AA palette, computed text color and local collision avoidance between recently used projects.
- Management of `statusBar.background`, `statusBar.foreground` and (on VS Code ≥ 1.138) `statusBar.inactiveBackground` only, with exact preservation and restoration of unrelated and pre-existing values.
- Git-aware storage: created `.vscode/settings.json` files are hidden via `.git/info/exclude`; tracked settings files are never modified without asking.
- Click menu with rename, color picker (live preview, custom hex), environment label, resets, copy path/remote, open folder/repository, toggle coloring and project information.
- Commands under the **Nameplate** category, settings under `nameplate.*`, one-time first-run notification, Output channel log.
- Support for multi-root workspaces, `.code-workspace` files, linked worktrees, submodules, monorepo sub-folders and remote windows (runs in the local extension host).
