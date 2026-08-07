# Changelog

All notable changes to Overture are documented here.

---

## [1.3.0] — 2026-07-31

### Added

- **Namespaces** — apps can be grouped into namespaces via a new `namespace` field (default: `default`). The **APPS** section nests apps under their namespace once more than one is in use, and stays flat otherwise. **Overture: Filter by Namespace** scopes the sidebar to a single namespace — Start All, Stop All, and Restart All then act only on that namespace. The filter is remembered per workspace, and is dropped automatically if the namespace it points at disappears.

- **Git change indicators** — each app row is now colored with the same theme colors the file explorer uses for git state (conflicting / modified / untracked), with a badge counting pending changes and a breakdown in the hover tooltip. Refreshed on config reload, app start, and file save.

- **Restart Running Apps** — new title-bar action (and `Overture: Restart Running Apps` command) that restarts exactly the apps currently running, without starting enabled apps you had deliberately stopped.

- **Restart / stop from the terminal** — an app's terminal now opens with clickable `[⟳ restart]` and `[■ stop]` links, and reprints the restart link under the exit line when a process crashes. A **Restart** button also appears in the status bar while an app's terminal is focused.

- **Namespace column in the settings panel** — set an app's namespace alongside its name, path, and command. The default namespace is never written to `config.json`.

### Fixed

- **"The terminal process terminated with exit code: 1" on stop/restart** — stopping an app force-kills its process tree, which Windows reports as exit code 1. That code was passed straight to VS Code, which surfaced an intentional stop as an unexpected termination. Deliberate stops now close the terminal with no exit code.

### Changed

- **Decluttered title bar** — the toolbar was eight always-visible icons. It now shows Start All, plus Stop All and Restart All only while something is running, plus the namespace filter only when more than one namespace exists. Refresh, Toggle Disabled Apps, Create Profile, Scan, Open Settings, and Open config.json moved into the `…` overflow menu, grouped with separators.

- **Git branch lookups no longer block the extension host** — branch and change detection runs off the main thread via a single async `git status` per app, replacing a synchronous call that could freeze the UI for seconds on every config reload.

---

## [1.2.0] — 2026-07-16

### Added

- **File explorer in the sidebar** — the **Path** node under each app now expands into a live folder tree (folders first, then files, alphabetical), themed with your active file-icon theme. Click any file to open it in the editor. Right-click **Path**, a folder, or a file for **Reveal in File Explorer**.

- **Log file browser** — app details now include a collapsible **Logs** group listing every retained dated log file (`<app>-YYYY-MM-DD.log`, newest first). Click one to open it in the editor.

- **Reorganized app details** — Command, PID, and the new Logs list are now grouped under a collapsible **Details** node, sitting alongside **Path** as a sibling — both collapsible, so they line up visually instead of mixing leaf and expandable rows.

- **Hide/show disabled apps** — new `overture.showDisabledApps` setting (default: on), plus a title-bar eye-icon toggle, to declutter the sidebar when you have a lot of disabled apps.

- **Live status in Profiles** — apps listed under a profile now show the same running/stopped/pid/branch indicators as the main **APPS** section, and support the same inline actions (Start, Stop, Restart, Show Output, Toggle Enable, Archive) — previously profile entries were static name-only rows.

- **Settings panel** — new **Overture: Open Settings** command (gear icon in the title bar) opens a form-based settings UI for log retention, apps, and profiles — add, edit, and remove entries without hand-editing JSON. An **Open config.json** button (now its own toolbar entry) remains for direct file access. If `config.json` changes on disk while you have unsaved edits open, the panel shows a **Reload** prompt instead of silently overwriting your changes.

### Fixed

- **Marketplace icon missing** — the extension had no top-level `icon` field in `package.json`, so Marketplace installs showed the default placeholder icon instead of the Overture logo.

### Changed

- The **Open Config** toolbar button now uses a document icon; the gear icon moved to the new **Open Settings** button.

---

## [1.1.0] — 2026-05-12

### Added

- **Git branch display in sidebar** — each app in the tree now shows its current git branch next to the status, formatted as `⎇ <branch>`. The branch is also visible in the hover tooltip (`Branch: \`main\``). Branch is detected when apps load and again at process start so running apps always reflect the branch they were launched on.

- **First-run welcome panel** — when a config file exists but contains no active apps, a guided welcome panel now appears in the sidebar with inline **Scan for Projects** and **Open Config** action buttons. Previously the panel was blank with no actionable path forward.

- **Actionable empty-state messages** — the `Create Profile` command no longer shows a dead-end warning when the config is missing or empty. It now offers contextual choices: *Create and Scan* / *Create Blank Config* (no config), or *Scan for Projects* / *Open Config* (config empty).

- **Tree view improvements** — `ProfileItem` and `AppTreeItem` now start collapsed by default. New `AppDetailItem` and `ProfileAppItem` classes allow per-app detail rows to expand inside each entry.

### Fixed

- **Duplicate play icon in terminal tabs** — the `▶ ` prefix was removed from the terminal tab name since VS Code already renders the `iconPath` play icon, preventing `▶ ▶ appname` display.

### Contributors

- Gayathri Polubothu — git branch display, first-run UX improvements, tree view refinements

---

## [1.0.2] — 2026-04-16

### Fixed

- **Scan not saving projects after rename** — when no `.overture/config.json` existed yet, scanning for Node.js projects would silently fail and not save any discovered apps to the config. This affected all users migrating from Conductor (v1.0.1), since the config file no longer existed at the old `.conductor/` path. Projects now scan and save correctly in all cases.

---

## [1.0.1] — 2026-04-16

### Changed

- **Renamed from Conductor to Overture** — the extension, all commands, the sidebar view, and the config directory have been renamed from `conductor` / `.conductor` to `overture` / `.overture`.

### Migration

- Move your existing `.conductor/config.json` to `.overture/config.json` to preserve your app configuration.

---

## [1.0.0]

- Initial release.
