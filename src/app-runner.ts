import * as vscode from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AppConfig, AppState, AppStatus, GitStatus, collectNamespaces, namespaceOf } from "./types";
import { LogManager } from "./log-manager";
import { StateManager } from "./state-manager";
import { RESTART_LINK, STOP_LINK } from "./terminal-links";

// @group Utilities : Parse the branch header of `git status --branch` output.
//                    Handles "main...origin/main [ahead 1]", "main", "HEAD (no branch)"
//                    (detached) and "No commits yet on main" (fresh repo).
function parseBranchHeader(header: string): string | undefined {
  const noCommits = header.match(/^No commits yet on (.+)$/);
  const branch = noCommits ? noCommits[1].trim() : header.split('...')[0].split(' ')[0];
  return !branch || branch === 'HEAD' ? undefined : branch;
}

// @group Utilities : Parse `git status --porcelain=v1 --branch` into branch + change counts.
//                    Exported for unit tests — the XY status columns are positional and easy to
//                    misread (X = index, Y = worktree, either being "U" means a merge conflict).
export function parseGitStatus(output: string): GitStatus {
  const status: GitStatus = { staged: 0, modified: 0, untracked: 0, conflicted: 0 };

  for (const line of output.split(/\r?\n/)) {
    if (line.length < 2) { continue; }
    if (line.startsWith('## ')) {
      status.branch = parseBranchHeader(line.slice(3).trim());
      continue;
    }
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') { status.untracked++; continue; }
    if (x === '!') { continue; } // ignored — only listed when explicitly requested
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      status.conflicted++;
      continue;
    }
    if (x !== ' ') { status.staged++; }
    if (y !== ' ') { status.modified++; }
  }

  return status;
}

// @group Utilities : Read branch + working-tree changes for the given directory. Runs off the main
//                    thread via execFile so it never blocks the extension host — setApps()
//                    calls this once per app on every config reload, and a blocking execSync
//                    here previously froze the whole extension for seconds at a time.
export function getGitStatus(dirPath: string): Promise<GitStatus | undefined> {
  return new Promise((resolve) => {
    // In a monorepo, running `git status` from an app subdir still reports changes from the
    // whole repository. Resolve the worktree root first, then limit the status to the app path.
    child_process.execFile(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd: dirPath, timeout: 3000, maxBuffer: 1 * 1024 * 1024, windowsHide: true },
      (err, topLevel) => {
        if (err) { resolve(undefined); return; }

        const repoRoot = path.normalize(topLevel.trim());
        const rel = path.relative(repoRoot, dirPath).replace(/\\/g, '/');
        const args = ['status', '--porcelain=v1', '--branch'];
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          args.push('--', rel);
        }

        child_process.execFile(
          'git',
          args,
          // A repo mid-rebase or with a huge untracked tree can outgrow the 1 MB default buffer,
          // which would surface as an error and silently drop the decoration.
          { cwd: repoRoot, timeout: 3000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
          (err2, stdout) => {
            resolve(err2 ? undefined : parseGitStatus(stdout));
          }
        );
      }
    );
  });
}

// @group Utilities : Strip ANSI escape codes for clean log file output
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

// @group Utilities : Convert bare \n to \r\n for proper terminal rendering
function toTerminalLines(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

// @group BusinessLogic : Custom PTY — runs the child process inside a VS Code terminal
//                        and simultaneously writes timestamped lines to a log file
class AppPseudoTerminal implements vscode.Pseudoterminal {
  private _writeEmitter = new vscode.EventEmitter<string>();
  private _closeEmitter = new vscode.EventEmitter<number | void>();

  readonly onDidWrite = this._writeEmitter.event;
  readonly onDidClose = this._closeEmitter.event;

  private _proc: child_process.ChildProcess | undefined;
  private _logStream: fs.WriteStream | undefined;
  private _closedByUs = false;

  constructor(
    private readonly config: AppConfig,
    private readonly appPath: string,
    private readonly logManager: LogManager,
    private readonly on: {
      start: (pid: number | undefined) => void;
      exit: (code: number | null) => void;
      error: (msg: string) => void;
    }
  ) {}

  // @group BusinessLogic : Called by VS Code when the terminal tab becomes visible
  open(): void {
    this._logStream = this.logManager.openLogStream(this.config.name);
    this._emit(
      `\x1b[1;36m▶  ${this.config.name}\x1b[0m\r\n` +
      `\x1b[2m${this.config.command}\x1b[0m\r\n` +
      `\x1b[2m${RESTART_LINK}  ${STOP_LINK}\x1b[0m\r\n` +
      `\x1b[2m${"─".repeat(60)}\x1b[0m\r\n\r\n`,
      false  // header is decorative — don't write to log
    );

    const isWin = process.platform === "win32";
    this._proc = child_process.spawn(this.config.command, [], {
      cwd: this.appPath,
      shell: true,
      env: process.env,
      detached: !isWin, // new process group so we can kill the whole tree
    });

    this.on.start(this._proc.pid);

    this._proc.stdout?.on("data", (data: Buffer) => {
      this._emit(data.toString());
    });

    this._proc.stderr?.on("data", (data: Buffer) => {
      this._emit(data.toString());
    });

    this._proc.on("exit", (code, signal) => {
      const reason = signal ? `killed by signal ${signal}` : `exited with code ${code}`;
      this._emit(`\r\n\x1b[2m■  ${reason}\x1b[0m\r\n`, false);
      if (code !== 0 && !signal) {
        this._emit(`\x1b[33mCheck the output above to diagnose the failure.\x1b[0m\r\n`, false);
      }
      // The tab survives a crash, so leave a way to relaunch without going back to the sidebar.
      // On a deliberate stop the tab is about to close, so the link would only flash past.
      if (!this._closedByUs) {
        this._emit(`\x1b[2m${RESTART_LINK}\x1b[0m\r\n`, false);
      }
      this._logStream?.write(`[exit] ${reason}\n`);
      this._logStream?.end();
      this._logStream = undefined;
      this._proc = undefined;
      // Only close the terminal tab when we deliberately killed or closed it.
      // When the process exits naturally (crash / error), keep the tab open so
      // the user can read the full output before the terminal disappears.
      if (this._closedByUs) {
        // Fire a clean close (no code) rather than the process's real exit code —
        // a force-kill (taskkill/SIGTERM) commonly yields a non-zero code, which
        // VS Code's terminal.integrated.showExitAlert would otherwise surface as
        // an "unexpected" termination even though this stop was intentional.
        this._closeEmitter.fire(undefined);
      }
      this.on.exit(code);
    });

    this._proc.on("error", (err) => {
      this._emit(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
      this.on.error(err.message);
    });
  }

  // @group BusinessLogic : Called by VS Code when user closes the terminal tab
  close(): void {
    this._closedByUs = true;
    if (this._proc) {
      this._kill(); // exit handler will fire _closeEmitter
    } else {
      this._closeEmitter.fire(undefined); // process already gone, close tab now
    }
  }

  // @group BusinessLogic : Forward keystrokes into the process stdin (interactive support)
  handleInput(data: string): void {
    this._proc?.stdin?.write(data);
  }

  // @group BusinessLogic : Kill the process externally (stop button)
  kill(): void {
    this._closedByUs = true;
    if (this._proc) {
      this._kill(); // exit handler will fire _closeEmitter
    } else {
      this._closeEmitter.fire(undefined); // process already gone, close tab now
    }
  }

  private _kill(): void {
    if (this._proc && !this._proc.killed) {
      const pid = this._proc.pid;
      if (pid) {
        if (process.platform === "win32") {
          // /T kills the entire process tree, /F forces termination
          try {
            child_process.execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
          } catch { /* process may have already exited */ }
        } else {
          // Kill the entire process group to avoid orphaned children
          try {
            process.kill(-pid, "SIGTERM");
          } catch { /* group may have already exited */ }
        }
      } else {
        this._proc.kill("SIGTERM");
      }
    }
  }

  // @group Utilities : Write to terminal display and optionally to the log file
  private _emit(text: string, log = true): void {
    this._writeEmitter.fire(toTerminalLines(text));

    if (log && this._logStream?.writable) {
      const ts = new Date().toISOString().substring(11, 19); // HH:MM:SS
      const clean = stripAnsi(text);
      const lines = clean.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          this._logStream.write(`[${ts}] ${line}\n`);
        }
      }
    }
  }
}

// @group Constants : Debounce window for git status re-reads triggered by file saves
const GIT_REFRESH_DEBOUNCE_MS = 800;

// @group Types : Internal per-app tracking entry
interface AppEntry {
  config: AppConfig;
  status: AppStatus;
  pid?: number;
  pty?: AppPseudoTerminal;
  terminal?: vscode.Terminal;
  resumed?: boolean; // true = process detected from previous session, no PTY
  gitBranch?: string;
  gitStatus?: GitStatus;
}

// @group BusinessLogic : Spawn, track, and stop child processes for each app
export class AppRunner implements vscode.Disposable {
  private _apps = new Map<string, AppEntry>();
  private _gitTimers = new Map<string, NodeJS.Timeout>();
  private _onDidChangeState = new vscode.EventEmitter<void>();

  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(
    private readonly logManager: LogManager,
    private readonly workspaceRoot: string,
    private readonly stateManager: StateManager
  ) {}

  // @group Configuration : Sync in-memory app map with the latest config
  setApps(configs: AppConfig[]): void {
    for (const [name, entry] of this._apps) {
      if (!configs.find((c) => c.name === name)) {
        this._killEntry(entry);
        entry.terminal?.dispose();
        this._apps.delete(name);
      }
    }

    for (const config of configs) {
      const existing = this._apps.get(config.name);
      if (existing) {
        existing.config = config;
        // Stop if archived or disabled while running
        if ((config.archived || !config.enabled) && existing.status === "running") {
          this._killEntry(existing);
        }
        if (config.archived) {
          existing.status = "archived";
        } else if (config.enabled && existing.status === "disabled") {
          existing.status = "stopped";
        } else if (!config.enabled && existing.status !== "running") {
          existing.status = "disabled";
        }
        this._refreshGitStatus(existing);
      } else {
        const entry: AppEntry = {
          config,
          status: config.archived ? "archived" : config.enabled ? "stopped" : "disabled",
        };
        this._apps.set(config.name, entry);
        this._refreshGitStatus(entry);
      }
    }
  }

  // @group BusinessLogic : Look up an app's git branch and working-tree changes in the background
  //                        and refresh the tree when they resolve, without blocking the extension host.
  private _refreshGitStatus(entry: AppEntry): void {
    const appPath = path.resolve(this.workspaceRoot, entry.config.path);
    if (!fs.existsSync(appPath)) {
      entry.gitBranch = undefined;
      entry.gitStatus = undefined;
      return;
    }
    getGitStatus(appPath).then((status) => {
      // Entry may have been replaced or removed while the lookup was in flight
      if (this._apps.get(entry.config.name) !== entry) {
        return;
      }
      entry.gitStatus = status;
      // Running apps keep the branch captured at start time, so the row always reports the
      // branch the process is actually running — even if the worktree has since been switched.
      if (entry.status !== "running") {
        entry.gitBranch = status?.branch;
      }
      this._onDidChangeState.fire();
    });
  }

  // @group BusinessLogic : Re-read git status for whichever app owns fsPath. Debounced because a
  //                        "save all" or a branch switch fires this once per file.
  refreshGitStatusForPath(fsPath: string): void {
    for (const entry of this._apps.values()) {
      const appPath = path.resolve(this.workspaceRoot, entry.config.path);
      const rel = path.relative(appPath, fsPath);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        this._debounceGitStatus(entry);
      }
    }
  }

  private _debounceGitStatus(entry: AppEntry): void {
    const key = entry.config.name;
    const pending = this._gitTimers.get(key);
    if (pending) { clearTimeout(pending); }
    this._gitTimers.set(
      key,
      setTimeout(() => {
        this._gitTimers.delete(key);
        this._refreshGitStatus(entry);
      }, GIT_REFRESH_DEBOUNCE_MS)
    );
  }

  // @group Utilities : Current git status for an app — O(1) lookup for the decoration provider,
  //                    which is asked for every visible row on every tree render
  getGitStatusFor(appName: string): GitStatus | undefined {
    return this._apps.get(appName)?.gitStatus;
  }

  // @group Utilities : Resolve an app's configured (possibly relative) path against the workspace root
  resolveAppPath(relativePath: string): string {
    return path.resolve(this.workspaceRoot, relativePath);
  }

  // @group Utilities : List an app's retained log files, newest first
  listLogFiles(appName: string): string[] {
    return this.logManager.listLogFiles(appName);
  }

  // @group Utilities : Find the app name that owns a given terminal, if any —
  //                    used to scope terminal context-menu actions to Overture's own terminals
  getAppNameForTerminal(terminal: vscode.Terminal): string | undefined {
    for (const [name, entry] of this._apps) {
      if (entry.terminal === terminal) { return name; }
    }
    return undefined;
  }

  getAllStates(): AppState[] {
    return Array.from(this._apps.values()).map((e) => ({
      config: e.config,
      status: e.status,
      pid: e.pid,
      resumed: e.resumed,
      gitBranch: e.gitBranch,
      gitStatus: e.gitStatus,
    }));
  }

  // @group BusinessLogic : On startup, check saved PIDs and mark still-running ones as resumed
  resumeFromState(): void {
    const alive = this.stateManager.pruneAndGetAlive();
    let anyResumed = false;

    for (const [appName, record] of Object.entries(alive)) {
      const entry = this._apps.get(appName);
      if (!entry) {
        // App removed from config — clean up saved state
        this.stateManager.remove(appName);
        continue;
      }
      if (entry.status === "running") {
        continue; // already running in this session
      }
      // Process is alive from a previous session
      entry.status  = "running";
      entry.pid     = record.pid;
      entry.resumed = true;
      anyResumed = true;
    }

    if (anyResumed) {
      this._onDidChangeState.fire();
    }
  }

  // @group BusinessLogic : Start every enabled app, limited to one namespace when the sidebar
  //                        is filtered to it (undefined = all namespaces)
  async startAll(namespace?: string): Promise<void> {
    for (const entry of this._apps.values()) {
      if (namespace && namespaceOf(entry.config) !== namespace) { continue; }
      if (entry.config.enabled && !entry.config.archived && entry.status !== "running") {
        await this._startEntry(entry);
      }
    }
  }

  async stopAll(namespace?: string): Promise<void> {
    for (const entry of this._apps.values()) {
      if (namespace && namespaceOf(entry.config) !== namespace) { continue; }
      if (entry.status === "running") {
        this._killEntry(entry);
      }
    }
  }

  // @group Utilities : Namespaces currently in use, "default" first — drives the namespace picker
  getNamespaces(): string[] {
    return collectNamespaces(Array.from(this._apps.values(), (e) => e.config));
  }

  async startApp(appName: string): Promise<void> {
    const entry = this._apps.get(appName);
    if (!entry || entry.status === "running") { return; }
    await this._startEntry(entry);
  }

  async stopApp(appName: string): Promise<void> {
    const entry = this._apps.get(appName);
    if (!entry || entry.status !== "running") { return; }
    this._killEntry(entry);
  }

  // @group BusinessLogic : Start all apps belonging to a profile by name list
  async startProfile(appNames: string[]): Promise<void> {
    const nameSet = new Set(appNames);
    for (const entry of this._apps.values()) {
      if (nameSet.has(entry.config.name) && entry.status !== "running") {
        await this._startEntry(entry);
      }
    }
  }

  async restartApp(appName: string): Promise<void> {
    await this.stopApp(appName);
    await new Promise<void>((r) => setTimeout(r, 500));
    await this.startApp(appName);
  }

  // @group BusinessLogic : Restart exactly the apps that are running — unlike stopAll + startAll,
  //                        this never starts an enabled app that the user had deliberately stopped.
  async restartAll(namespace?: string): Promise<void> {
    const running = Array.from(this._apps.values())
      .filter((e) => e.status === "running" && (!namespace || namespaceOf(e.config) === namespace))
      .map((e) => e.config.name);
    if (running.length === 0) { return; }

    for (const name of running) {
      await this.stopApp(name);
    }
    await new Promise<void>((r) => setTimeout(r, 500));
    for (const name of running) {
      await this.startApp(name);
    }
  }

  showOutput(appName: string): void {
    const entry = this._apps.get(appName);
    if (!entry) { return; }

    if (entry.terminal && !entry.resumed) {
      // Active PTY session — show the terminal tab
      entry.terminal.show();
    } else {
      // Resumed or stopped — open today's log file in the editor
      const logPath = this.logManager.getLogFilePath(appName);
      if (fs.existsSync(logPath)) {
        vscode.window.showTextDocument(vscode.Uri.file(logPath), { preview: true });
      } else {
        vscode.window.showInformationMessage(
          `No log file found for "${appName}" today.`
        );
      }
    }
  }

  // @group BusinessLogic : Spawn the child process inside a VS Code terminal via PTY
  private async _startEntry(entry: AppEntry): Promise<void> {
    if (entry.status === "running") { return; }

    const { config } = entry;
    const appPath = path.resolve(this.workspaceRoot, config.path);

    if (!fs.existsSync(appPath)) {
      vscode.window.showErrorMessage(
        `Overture: Path not found for "${config.name}": ${appPath}`
      );
      entry.status = "error";
      this._onDidChangeState.fire();
      return;
    }

    // Kill and dispose any previous terminal for this app
    entry.pty?.kill();
    entry.terminal?.dispose();

    // Capture the current branch at start time so running apps always show their start branch.
    // Resolved in the background so starting an app is never delayed by the git lookup.
    entry.gitBranch = undefined;
    entry.gitStatus = undefined;
    getGitStatus(appPath).then((status) => {
      if (this._apps.get(config.name) === entry && entry.status === "running") {
        entry.gitBranch = status?.branch;
        entry.gitStatus = status;
        this._onDidChangeState.fire();
      }
    });

    const pty = new AppPseudoTerminal(config, appPath, this.logManager, {
      start: (pid) => {
        entry.pid = pid;
        if (pid) { this.stateManager.save(config.name, pid, config.command); }
        this._onDidChangeState.fire();
      },
      exit: (code) => {
        this.stateManager.remove(config.name);
        // Guard: if _killEntry already ran it cleared entry.pty — don't override that status
        if (entry.pty === pty) {
          entry.status = code === 0 ? "stopped" : "error";
          entry.pid    = undefined;
          entry.pty    = undefined;
          this._onDidChangeState.fire();
        }
      },
      error: () => {
        this.stateManager.remove(config.name);
        // Guard: if _killEntry already ran it cleared entry.pty — don't override that status
        if (entry.pty === pty) {
          entry.status = "error";
          entry.pid    = undefined;
          entry.pty    = undefined;
          this._onDidChangeState.fire();
        }
      },
    });

    const terminal = vscode.window.createTerminal({
      name: config.name,
      pty,
      iconPath: new vscode.ThemeIcon("play"),
    });

    entry.pty      = pty;
    entry.terminal = terminal;
    entry.status   = "running";
    entry.resumed  = false;
    this._onDidChangeState.fire();

    terminal.show(true); // true = preserve focus on current editor
  }

  private _killEntry(entry: AppEntry): void {
    if (entry.resumed && entry.pid) {
      // Resumed process — no PTY handle, kill directly by PID
      StateManager.killPid(entry.pid);
      this.stateManager.remove(entry.config.name);
    } else {
      entry.pty?.kill();
    }
    entry.status  = "stopped";
    entry.pid     = undefined;
    entry.pty     = undefined;
    entry.resumed = false;
    this._onDidChangeState.fire();
  }

  dispose(): void {
    for (const timer of this._gitTimers.values()) {
      clearTimeout(timer);
    }
    this._gitTimers.clear();
    for (const entry of this._apps.values()) {
      this._killEntry(entry);
      entry.terminal?.dispose();
    }
    this._onDidChangeState.dispose();
  }
}
