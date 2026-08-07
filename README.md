# Overture

Run and manage multiple app processes from a single VS Code sidebar panel — with per-app terminals, live logs, and automatic project detection.

---

## Features

- **Sidebar panel** — view all your apps at a glance with live status indicators
- **Per-app terminals** — each process runs in its own VS Code terminal tab with full color and interactivity
- **Log files** — output is simultaneously written to `.overture/logs/<app>-YYYY-MM-DD.log` (ANSI stripped, timestamped)
- **Auto-scan** — detects all Node.js projects in your workspace and lists their npm scripts
- **Enable / Disable** — toggle apps on or off without removing them from config
- **Log retention** — old logs are auto-cleaned after a configurable number of days (default: 7)
- **Git branch display** — each app shows its current git branch in the sidebar (`⎇ main`) and hover tooltip
- **Git change indicators** — apps with uncommitted work are colored like the file explorer (modified / untracked / conflicting) with a badge counting pending changes
- **Namespaces** — group apps into namespaces and scope the sidebar, Start All, and Stop All to one of them
- **First-run welcome panel** — guided empty-state panel with inline action buttons when no apps are configured yet
- **File explorer in the sidebar** — expand an app's **Path** node to browse its folder tree and open files directly, no need to switch to the main Explorer view
- **Log file browser** — expand **Details → Logs** to see every retained dated log file for an app and open it in one click
- **Hide/show disabled apps** — declutter the sidebar with a title-bar toggle or the `overture.showDisabledApps` setting
- **Settings panel** — a form-based UI (`Overture: Open Settings`) for editing retention days, apps, and profiles without hand-editing JSON

---

## Installation

Install from the `.vsix` file:

```
code --install-extension overture-1.3.0.vsix
```

Or via VS Code: **Extensions → ··· → Install from VSIX**

---

## Quick Start

1. Open your project folder in VS Code
2. Click the **Overture** icon in the activity bar (left sidebar)
3. Click **Create Config** — this immediately opens a scanner to detect your projects
4. Select the scripts you want to run and confirm
5. Click **Start All** (▶▶ icon) to launch everything

---

## Config File

The extension reads `.overture/config.json` from your workspace root.

```json
{
  "retentionDays": 7,
  "apps": [
    {
      "name": "frontend",
      "path": "./packages/frontend",
      "command": "npm run dev",
      "enabled": true
    },
    {
      "name": "backend",
      "path": "./packages/backend",
      "command": "npm run dev",
      "enabled": true
    },
    {
      "name": "worker",
      "path": "./packages/worker",
      "command": "npm run dev",
      "enabled": false
    }
  ]
}
```

| Field          | Type    | Description                                      |
|----------------|---------|--------------------------------------------------|
| `retentionDays`| number  | Days to keep log files (default: 7)              |
| `name`         | string  | Display name shown in the sidebar                |
| `path`         | string  | Path to the project folder, relative to workspace root |
| `command`      | string  | Command to run (e.g. `npm run dev`, `yarn start`)|
| `enabled`      | boolean | Whether this app starts with Start All           |
| `namespace`    | string  | Group this app belongs to (default: `default`)   |

The file is watched — changes take effect immediately without reloading VS Code.

---

## Sidebar Panel

Click the **Overture** icon in the activity bar to open the panel.

### Status indicators

| Icon | Meaning |
|------|---------|
| Green filled circle | Running |
| Grey outline circle | Stopped |
| Slash circle | Disabled |
| Red filled circle | Exited with error |

### Toolbar buttons

| Button | Shown | Action |
|--------|-------|--------|
| ▶▶ | Always | Start all enabled apps |
| ⏹ | While apps are running | Stop all running apps |
| ↺ | While apps are running | Restart the running apps |
| ⚱ | With more than one namespace | Filter the sidebar by namespace |

Everything else lives under the `…` overflow menu: Refresh, Toggle Disabled Apps, Create Profile, Scan for Projects, Open Settings, and Open config.json.

### Per-app inline buttons

Right-click any app or use the inline icons:

| Button | Condition | Action |
|--------|-----------|--------|
| ▶ | Stopped | Start this app |
| ⏹ | Running | Stop this app |
| ↺ | Running | Restart this app |
| ⊟ | Any | Show terminal output |
| ⊘ | Any | Toggle enable / disable |

### Namespaces

Give apps a `namespace` (in the settings panel or `config.json`) to group them — for example `media`, `billing`, `infra`. Apps without one belong to `default`.

- Once more than one namespace is in use, the **APPS** section nests apps under a row per namespace.
- **Overture: Filter by Namespace** (⚱ in the title bar) narrows the sidebar to one namespace. Start All, Stop All, and Restart All then apply only to it, and the section header shows the active filter (`media · 2/3 running`).
- The filter is remembered per workspace.

Profiles are independent of namespaces — a profile can contain apps from any of them.

### Git change indicators

Apps whose repository has uncommitted work are colored using the same theme colors as the file explorer, with a badge counting the pending changes:

| Color | Meaning |
|-------|---------|
| Conflicting | Unmerged paths |
| Modified | Staged or unstaged changes to tracked files |
| Untracked | Only new, untracked files |

Counts refresh when you save a file in the app's folder, when config reloads, and when an app starts. Changes made outside the editor (a commit or checkout in a terminal) are picked up on the next refresh. This honors the `explorer.decorations.colors` and `explorer.decorations.badges` settings.

### Details, Path, and Logs

Each app expands into two collapsible nodes:

- **Details** — Command, PID, and a **Logs** list of every retained dated log file for that app (click one to open it in the editor)
- **Path** — a live file explorer rooted at the app's folder; expand into subfolders and click any file to open it. Right-click **Path**, a folder, or a file for **Reveal in File Explorer**.

---

## Settings Panel

Click the **gear icon** in the title bar, or run `Overture: Open Settings`, to open a form-based settings UI:

- **General** — log retention (days)
- **Apps** — add, edit, or remove apps (name, path, command, namespace, enabled, archived) in a table
- **Profiles** — add, edit, or remove profiles, toggle favorite, and check off member apps

Click **Save** to write changes back to `.overture/config.json`, or **Open config.json** to edit the raw file directly. If the file changes on disk while you have unsaved edits open, the panel prompts you to reload rather than silently overwriting your changes.

---

## Scanning for Projects

Click the **magnifying glass** icon or run `Overture: Scan Workspace for Node.js Projects` from the Command Palette (`Ctrl+Shift+P`).

The scanner:
- Finds every `package.json` in the workspace (skips `node_modules`, `dist`, `build`, `out`)
- Lists all scripts grouped by project
- Pre-selects `dev`, `start`, `serve`, `preview`, `develop` scripts
- Marks already-configured scripts so you don't add duplicates

After confirming your selection, scripts are appended to `.overture/config.json`. You can scan multiple times safely.

---

## Terminals & Logs

Each app runs in its own VS Code terminal tab named `▶ <appname>`.

- Full ANSI color support — npm spinners, colors, etc. render correctly
- The terminal is **interactive** — you can type into it (stdin is forwarded)
- Closing the terminal tab stops the process

Log files are written to `.overture/logs/`:
- One file per app per day: `frontend-2026-04-16.log`
- ANSI codes stripped, each line prefixed with `[HH:MM:SS]`
- Files older than `retentionDays` are deleted automatically on next start

---

## Commands (Command Palette)

All commands are available via `Ctrl+Shift+P` → type **Overture**:

| Command | Description |
|---------|-------------|
| Overture: Start All Enabled Apps | Start all enabled apps |
| Overture: Stop All Apps | Stop all running apps |
| Overture: Scan Workspace for Node.js Projects | Auto-detect and add projects |
| Overture: Refresh | Reload config and sync state |
| Overture: Open Config | Open `.overture/config.json` |
| Overture: Open Settings | Open the form-based settings panel |
| Overture: Create Config | Create an empty config and open the scanner |
| Overture: Toggle Disabled Apps | Show or hide disabled apps in the sidebar |

---

## Status Bar

The bottom-left status bar shows the running count:

- `▶ Overture` — nothing running, click to start all
- `● 2/3 running` — 2 of 3 enabled apps are running, click to start remaining

---

## Contributors

| Name | Contributions |
|------|---------------|
| [Chandan Bhagat](https://github.com/thechandanbhagat) | Creator and maintainer |
| [Gayathri Polubothu](https://github.com/gayathri-polubothu) | Git branch display, first-run UX improvements, tree view refinements |
