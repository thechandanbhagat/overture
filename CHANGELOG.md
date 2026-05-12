# Changelog

All notable changes to Overture are documented here.

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
