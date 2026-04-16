import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";

// @group Types : Shape of a single persisted process entry
interface ProcessRecord {
  pid: number;
  command: string;
  startedAt: string;
}

type StateFile = Record<string, ProcessRecord>;

// @group BusinessLogic : Persist process PIDs to disk so they survive VS Code restarts
export class StateManager {
  private readonly _statePath: string;

  constructor(workspaceRoot: string) {
    this._statePath = path.join(workspaceRoot, ".overture", ".state.json");
  }

  // @group BusinessLogic : Write a PID entry for a running app
  save(appName: string, pid: number, command: string): void {
    const state = this._read();
    state[appName] = { pid, command, startedAt: new Date().toISOString() };
    this._write(state);
  }

  // @group BusinessLogic : Remove the PID entry when an app stops
  remove(appName: string): void {
    const state = this._read();
    if (appName in state) {
      delete state[appName];
      this._write(state);
    }
  }

  // @group BusinessLogic : Return all saved entries (alive or not)
  getAll(): StateFile {
    return this._read();
  }

  // @group BusinessLogic : Remove stale entries and return only the alive ones
  pruneAndGetAlive(): StateFile {
    const state = this._read();
    const alive: StateFile = {};
    let changed = false;

    for (const [name, record] of Object.entries(state)) {
      if (StateManager.isAlive(record.pid)) {
        alive[name] = record;
      } else {
        delete state[name];
        changed = true;
      }
    }

    if (changed) { this._write(state); }
    return alive;
  }

  // @group Utilities : Cross-platform check whether a PID is still running
  static isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // signal 0 = existence check only
      return true;
    } catch (e: unknown) {
      // EPERM means process exists but we lack permission — still alive
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  // @group Utilities : Cross-platform kill by PID (used for resumed processes)
  static killPid(pid: number): void {
    try {
      if (process.platform === "win32") {
        // /T kills the process tree, /F forces termination
        child_process.execSync(`taskkill /F /PID ${pid} /T`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // Process may have already exited — ignore
    }
  }

  private _read(): StateFile {
    try {
      if (!fs.existsSync(this._statePath)) { return {}; }
      return JSON.parse(fs.readFileSync(this._statePath, "utf8")) as StateFile;
    } catch {
      return {};
    }
  }

  private _write(state: StateFile): void {
    try {
      const dir = path.dirname(this._statePath);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      fs.writeFileSync(this._statePath, JSON.stringify(state, null, 2));
    } catch {
      // Non-fatal — state is best-effort
    }
  }
}
