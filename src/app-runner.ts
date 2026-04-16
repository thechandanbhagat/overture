import * as vscode from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AppConfig, AppState, AppStatus } from "./types";
import { LogManager } from "./log-manager";
import { StateManager } from "./state-manager";

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
      `\x1b[2m${"─".repeat(60)}\x1b[0m\r\n\r\n`,
      false  // header is decorative — don't write to log
    );

    this._proc = child_process.spawn(this.config.command, [], {
      cwd: this.appPath,
      shell: true,
      env: process.env,
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
      this._logStream?.write(`[exit] ${reason}\n`);
      this._logStream?.end();
      this._logStream = undefined;
      this._proc = undefined;
      this._closeEmitter.fire(code ?? undefined);
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
    this._kill();
  }

  // @group BusinessLogic : Forward keystrokes into the process stdin (interactive support)
  handleInput(data: string): void {
    this._proc?.stdin?.write(data);
  }

  // @group BusinessLogic : Kill the process externally (stop button)
  kill(): void {
    this._closedByUs = true;
    this._kill();
  }

  private _kill(): void {
    if (this._proc && !this._proc.killed) {
      this._proc.kill("SIGTERM");
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

// @group Types : Internal per-app tracking entry
interface AppEntry {
  config: AppConfig;
  status: AppStatus;
  pid?: number;
  pty?: AppPseudoTerminal;
  terminal?: vscode.Terminal;
  resumed?: boolean; // true = process detected from previous session, no PTY
}

// @group BusinessLogic : Spawn, track, and stop child processes for each app
export class AppRunner implements vscode.Disposable {
  private _apps = new Map<string, AppEntry>();
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
      } else {
        this._apps.set(config.name, {
          config,
          status: config.archived ? "archived" : config.enabled ? "stopped" : "disabled",
        });
      }
    }
  }

  getAllStates(): AppState[] {
    return Array.from(this._apps.values()).map((e) => ({
      config: e.config,
      status: e.status,
      pid: e.pid,
      resumed: e.resumed,
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

  async startAll(): Promise<void> {
    for (const entry of this._apps.values()) {
      if (entry.config.enabled && !entry.config.archived && entry.status !== "running") {
        await this._startEntry(entry);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const entry of this._apps.values()) {
      if (entry.status === "running") {
        this._killEntry(entry);
      }
    }
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
    const { config } = entry;
    const appPath = path.resolve(this.workspaceRoot, config.path);

    if (!fs.existsSync(appPath)) {
      vscode.window.showErrorMessage(
        `Conductor: Path not found for "${config.name}": ${appPath}`
      );
      entry.status = "error";
      this._onDidChangeState.fire();
      return;
    }

    // Kill and dispose any previous terminal for this app
    entry.pty?.kill();
    entry.terminal?.dispose();

    const pty = new AppPseudoTerminal(config, appPath, this.logManager, {
      start: (pid) => {
        entry.pid = pid;
        if (pid) { this.stateManager.save(config.name, pid, config.command); }
        this._onDidChangeState.fire();
      },
      exit: (code) => {
        this.stateManager.remove(config.name);
        entry.status = code === 0 ? "stopped" : "error";
        entry.pid    = undefined;
        entry.pty    = undefined;
        this._onDidChangeState.fire();
      },
      error: () => {
        this.stateManager.remove(config.name);
        entry.status = "error";
        entry.pid    = undefined;
        entry.pty    = undefined;
        this._onDidChangeState.fire();
      },
    });

    const terminal = vscode.window.createTerminal({
      name: `▶ ${config.name}`,
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
  }

  dispose(): void {
    for (const entry of this._apps.values()) {
      this._killEntry(entry);
      entry.terminal?.dispose();
    }
    this._onDidChangeState.dispose();
  }
}
