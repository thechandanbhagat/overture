# Changelog

All notable changes to Overture are documented here.

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
