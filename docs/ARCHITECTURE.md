# Architecture

Nameplate is small on purpose. This page explains how the pieces fit, where state lives, and which invariants the code relies on.

## Layers

```
src/
  extension.ts            composition root: creates services, registers commands, starts the controller
  controller.ts           the refresh pipeline and all user actions (serialized through one queue)
  model.ts                the read model (ProjectSnapshot) shared by UI and commands
  constants.ts

  core/                   pure TypeScript without `vscode` or Node built-ins (enforced by ESLint), unit-tested
    colors/               hex, WCAG contrast, palette, deterministic assignment, status bar theme,
                          ownership-aware colorCustomizations planning, write policy
    git/                  remote URL normalization, .git/config + HEAD + gitdir parsing,
                          repository discovery over an injected file system, .git/info/exclude editing
    identity/             manifests, generic names, name detection chain, formatting, identity key, project type
    registry/             the cross-window color registry: claims, priorities, visibility, migration
    util/                 hash, posix paths, semver, text

  configuration/          typed settings reader; workspaceState store; reader for the 0.1.0 registry
  workspace/              workspace description, file access through workspace.fs, root manifest scanning
  git/                    GitService (metadata + watchers), GitExtensionBridge (git path, tracked/ignored, working tree)
  gitFilter/              cleanFilter.ts, the program Git runs as a clean filter (bundled to dist/git-clean-filter.js)
  colors/                 StatusBarColorizer (config API), SettingsFileGuard (Git classification, exclude, filter, cleanup),
                          GitFilter (installs/removes the clean filter, refreshes Git's index),
                          ColorCoordinator (pin + shared registry → this window's colors)
  registry/               RegistryFile (JSON file + cross-process lock + watcher), process liveness (Node only)
  identity/               identityResolver: candidates → IdentitySnapshot
  ui/                     status bar item, actions menu, color picker, project information, prompts, notifications
  commands/               command registration
```

The rule of thumb: if it can be expressed as a function from plain data to plain data, it goes in `core/` and gets a unit test. The VS Code layer should read like glue.

## The refresh pipeline

Every change (activation, settings, workspace folders, Git `HEAD`/`config`, root manifests, user actions) ends up in `NameplateController.requestRefresh()`, which debounces by 50 ms and runs `refresh()` on a serial queue:

1. `describeWorkspace()`: folder / multi-root / none, the primary folder, the saved workspace file.
2. `GitService.read(primary)` and `scanWorkspaceFolder(primary)` in parallel: `.git` metadata through `workspace.fs`, one directory listing plus the manifests that exist.
3. `resolveIdentity()`: name candidates → `detectProjectName()`, formatting, `buildIdentityKey()`, `detectProjectType()`.
4. The status bar item is rendered immediately with the name (colors may take longer).
5. `ColorCoordinator.claim(key)`: under the registry lock: the pinned automatic color (moved if an open window with priority looks the same) or a fresh choice that looks different from all open windows; custom color on top; `buildStatusBarTheme()`.
6. `syncColors()`: `decideWrite()` over the `SettingsFileGuard` classification says whether to write and how to keep it out of Git (exclude a created file, filter a committed one). The plan is made first, the filter learns which lines are Nameplate's _before_ they are written, then `StatusBarColorizer.commit()` writes, and `GitFilter.refreshIndex()` lets Git notice that, filtered, nothing changed.
7. `ColorCoordinator.reportVisibility()`: record whether the status bar shows the color, or a foreign color (Peacock, the user) that other windows must avoid.
8. Publish the `ProjectSnapshot`; show the first-run or tracked-file notification, or a status bar message when the color moved.

Besides these events, the registry file is watched: when another window changes it (and on window focus), each window runs the read-only `needsReassignment()` check and refreshes only if its color has to move.

User actions mutate `workspaceState` and then request a refresh, usually with `explicit: true`, which is the only thing that lets Nameplate replace foreign color values (after backing them up) or write into a Git-tracked settings file.

## State

| Where                                             | What                                                                                                                                                                          | Why there                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceState` (`nameplate.workspace`)          | custom name, custom color, label, per-workspace coloring toggle, pinned automatic color, tracked-file answer, first-run flag, "we created the settings file", exclude pattern | Per workspace, survives restarts, never in the repository.                                                                                                                                                                         |
| `workspaceState` (`nameplate.colorRecord`)        | `OwnershipRecord`: which keys we wrote, with what values, and what they replaced                                                                                              | Needed to recognise our own values later and to restore exactly.                                                                                                                                                                   |
| `<globalStorage>/registry.json`                   | identity key → `{ name, color, auto, custom, external, visible, claimedAt, lastSeen, pids }`, capped at 200 entries; changed only under `registry.lock`                       | Keeps open windows visually apart and gives clones of a repository the same color. A file, not `globalState`: `globalState` reaches other windows late and is written back whole, so concurrent windows lose each other's entries. |
| `globalState` (`nameplate.registry`)              | the 0.1.0 registry                                                                                                                                                            | Read once to seed `registry.json`, then removed.                                                                                                                                                                                   |
| Workspace settings                                | `workbench.colorCustomizations` → `statusBar.background`, `statusBar.foreground`, `statusBar.inactiveBackground` (+ debugging keys when enabled)                              | The only mechanism VS Code offers to color one window.                                                                                                                                                                             |
| `.git/info/exclude`                               | a marked three-line block for `.vscode/settings.json`                                                                                                                         | Keeps a settings file Nameplate created out of `git status`; local, never committed.                                                                                                                                               |
| `.git/info/attributes`, `.git/config`             | `/.vscode/settings.json filter=nameplate` and `filter.nameplate.clean`                                                                                                        | Attach Nameplate's clean filter to the settings file; local, never committed.                                                                                                                                                      |
| `.git/nameplate-colors.json`                      | per settings file: the keys Nameplate wrote and what they replaced                                                                                                            | Tells the filter which lines to remove.                                                                                                                                                                                            |
| `<globalStorage>/git/clean.sh`, `clean-filter.js` | the filter program (a copy of `dist/git-clean-filter.js`) and a wrapper that runs it on VS Code's Node runtime                                                                | Referenced by the repositories' local config; falls back to `cat` if missing.                                                                                                                                                      |

Nothing is written to user settings except by the explicit _Enable_ / _Disable_ commands and the notification buttons that change a setting.

## Invariants

- **Ownership before writing.** `planApply()` classifies every managed key as `free`, `owned`, `foreign`, `changed-externally` or `removed-externally`. Foreign and externally changed keys are never overwritten without `takeover`; when one is found, Nameplate releases everything it owns (a foreground computed for a different background could be unreadable).
- **Writes are plans.** The VS Code layer never edits the customizations object directly; it writes what the planner returns and persists the record the planner returns.
- **Automatic colors are frozen.** `AUTO_PALETTE` order, `stableHash`, `seededPermutation` and `candidateOrder` define existing users' colors. Tests pin them.
- **Assignment is deterministic first, local second.** `candidateOrder(key)` is the same everywhere; `chooseAutoColor()` only walks further down that order when a candidate looks like an open window (OKLab ΔE < 0.10; < 0.12 is avoided when possible) or, softly, is used by a recent project. The result is pinned.
- **Open windows converge to distinct colors.** A window is open while one of the extension host processes recorded in its entry is alive (`process.kill(pid, 0)`), its status bar shows the color, and it was seen within 7 days (process id reuse guard). When two open windows look alike, the one without priority moves. Fixed colors (custom, or foreign like Peacock) have priority over automatic ones, then the older claim wins, then the key decides. A window only moves to a color that is clearly distinct from all open windows, so every move removes a clash without creating one, and the process terminates.
- **The registry is changed only under the lock.** `RegistryFile.update()` takes `registry.lock` with an exclusive create, reads, applies a pure plan, writes via temp file + rename, and releases the lock only if it still holds it. Locks older than 10 s are treated as left behind by a crashed process; after 5 s of waiting a window continues without the lock (logged) rather than blocking.
- **User actions are never throttled.** The anti-loop guard in `StatusBarColorizer` applies to automatic writes only.
- **Git never sees Nameplate's lines.** For a settings file in a local repository, the clean filter is installed (with the ownership record it needs) before the colors are written. The filter only removes values that still equal what Nameplate wrote; anything else in the file is passed through, and on any error it passes the whole file through, so it can never break Git. Git skips filters when a file's size changed, so after each write Nameplate runs `git diff --quiet` and, only if that is clean, `git add -u` on that one file to refresh Git's cached size. This stages nothing and never adds untracked files.
- **Fail soft.** Every event handler and command is wrapped; failures go to the `Nameplate` output channel. The name is shown even when coloring fails.

## Git without git

`core/git/repositoryReader.ts` walks up from the workspace folder looking for `.git`. A directory is the git dir; a file (`gitdir: …`) points to it (linked worktrees, submodules). `commondir` resolves the shared directory that holds `config` and `info/exclude`. Reading `HEAD` and `config` yields branch and remotes in milliseconds, before the Git extension has even scanned, which is why the color is right from the first frame. File watchers on those two files keep the information live.

The built-in Git extension API is used only where metadata cannot answer: _is this file tracked / ignored?_ (`getObjectDetails('', path)`, `checkIgnore`) and the working tree summary in Project Information. When the API is unavailable the answers degrade to "unknown" and the write policy becomes conservative.

## Extension host

`extensionKind: ["ui", "workspace"]`: on the desktop the extension runs locally even for remote windows, so it works everywhere without a remote install. Everything goes through `workspace.fs` and URIs, never `fs` or child processes, so remote and virtual file systems behave the same. The Git extension API is only reachable when both run in the same host, hence the "unknown" fallback above.
