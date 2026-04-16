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

---

## Installation

Install from the `.vsix` file:

```
code --install-extension overture-1.0.3.vsix
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

| Button | Action |
|--------|--------|
| ▶▶ | Start all enabled apps |
| ⏹ | Stop all running apps |
| ↺ | Refresh / reload config |
| ⚙ | Open config file |
| 🔍 | Scan workspace for Node.js projects |

### Per-app inline buttons

Right-click any app or use the inline icons:

| Button | Condition | Action |
|--------|-----------|--------|
| ▶ | Stopped | Start this app |
| ⏹ | Running | Stop this app |
| ↺ | Running | Restart this app |
| ⊟ | Any | Show terminal output |
| ⊘ | Any | Toggle enable / disable |

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
| Overture: Create Config | Create an empty config and open the scanner |

---

## Status Bar

The bottom-left status bar shows the running count:

- `▶ Overture` — nothing running, click to start all
- `● 2/3 running` — 2 of 3 enabled apps are running, click to start remaining
