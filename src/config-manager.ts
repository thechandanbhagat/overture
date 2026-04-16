import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { AppConfig, ProfileConfig, RunMultipleAppsConfig } from "./types";

// @group Configuration : Load, watch, and mutate .conductor/config.json
export class ConfigManager implements vscode.Disposable {
  private _config: RunMultipleAppsConfig | undefined;
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _onDidChange = new vscode.EventEmitter<RunMultipleAppsConfig>();

  readonly onDidChange = this._onDidChange.event;
  readonly configPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.configPath = path.join(workspaceRoot, ".conductor", "config.json");
    this._setupWatcher();
  }

  // @group Configuration : Watch config file for external edits
  private _setupWatcher(): void {
    const pattern = new vscode.RelativePattern(this.workspaceRoot, ".conductor/config.json");
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      try {
        const config = await this.load();
        this._onDidChange.fire(config);
      } catch { /* ignore transient errors */ }
    };

    this._watcher.onDidChange(reload);
    this._watcher.onDidCreate(reload);
    this._watcher.onDidDelete(() =>
      this._onDidChange.fire({ retentionDays: 7, profiles: {}, apps: [] })
    );
  }

  // @group Configuration : Parse and return the current config
  async load(): Promise<RunMultipleAppsConfig> {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Config not found at ${this.configPath}`);
    }

    const raw = fs.readFileSync(this.configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RunMultipleAppsConfig>;

    // Migrate old profile format (string[] → ProfileConfig)
    const rawProfiles = (parsed.profiles ?? {}) as Record<string, string[] | ProfileConfig>;
    const profiles: Record<string, ProfileConfig> = {};
    for (const [name, value] of Object.entries(rawProfiles)) {
      profiles[name] = Array.isArray(value)
        ? { apps: value }
        : (value as ProfileConfig);
    }

    this._config = {
      retentionDays: parsed.retentionDays ?? 7,
      profiles,
      apps: (parsed.apps ?? []).map((a) => ({
        name: a.name ?? "unnamed",
        path: a.path ?? ".",
        command: a.command ?? "npm run dev",
        enabled: a.enabled !== false,
        archived: a.archived === true,
      })),
    };

    return this._config;
  }

  // @group Configuration : Check if config file exists
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  // @group Configuration : Create a blank config file
  createDefault(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    const blank: RunMultipleAppsConfig = { retentionDays: 7, profiles: {}, apps: [] };
    fs.writeFileSync(this.configPath, JSON.stringify(blank, null, 2));
  }

  // @group Configuration : Return profiles map from cached config
  getProfiles(): Record<string, ProfileConfig> {
    return this._config?.profiles ?? {};
  }

  // @group Configuration : Append new apps, skipping duplicates by name
  async addApps(apps: AppConfig[]): Promise<void> {
    let config: RunMultipleAppsConfig;
    if (this.exists()) {
      config = this._config ?? (await this.load());
    } else {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      config = { retentionDays: 7, profiles: {}, apps: [] };
    }
    const existing = new Set(config.apps.map((a) => a.name));
    let added = 0;
    for (const app of apps) {
      if (!existing.has(app.name)) { config.apps.push(app); added++; }
    }
    if (added > 0) { this._save(); }
  }

  // @group Configuration : Toggle the enabled flag for a named app
  async toggleEnable(appName: string): Promise<void> {
    const app = this._config?.apps.find((a: AppConfig) => a.name === appName);
    if (!app) { return; }
    app.enabled = !app.enabled;
    this._save();
  }

  // @group Configuration : Toggle archived flag for a named app
  toggleArchive(appName: string): void {
    const app = this._config?.apps.find((a) => a.name === appName);
    if (!app) { return; }
    app.archived = !app.archived;
    if (app.archived) { app.enabled = false; } // ensure it won't auto-start
    this._save();
  }

  // @group Configuration : Save a new or updated profile
  createProfile(name: string, appNames: string[]): void {
    if (!this._config) { return; }
    this._config.profiles[name] = {
      apps: appNames,
      favorite: this._config.profiles[name]?.favorite ?? false,
    };
    this._save();
  }

  // @group Configuration : Update profile name and/or apps (handles rename)
  editProfile(oldName: string, newName: string, appNames: string[]): void {
    if (!this._config) { return; }
    const existing = this._config.profiles[oldName];
    if (oldName !== newName) {
      delete this._config.profiles[oldName];
    }
    this._config.profiles[newName] = {
      apps: appNames,
      favorite: existing?.favorite ?? false,
    };
    this._save();
  }

  // @group Configuration : Toggle the favorite flag on a profile
  toggleFavoriteProfile(name: string): void {
    if (!this._config?.profiles[name]) { return; }
    this._config.profiles[name].favorite = !this._config.profiles[name].favorite;
    this._save();
  }

  // @group Configuration : Remove a profile by name
  deleteProfile(name: string): void {
    if (!this._config) { return; }
    delete this._config.profiles[name];
    this._save();
  }

  private _save(): void {
    if (!this._config) { return; }
    fs.writeFileSync(this.configPath, JSON.stringify(this._config, null, 2));
  }

  dispose(): void {
    this._watcher?.dispose();
    this._onDidChange.dispose();
  }
}
