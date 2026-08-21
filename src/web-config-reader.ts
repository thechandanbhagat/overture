import * as vscode from "vscode";
import { AppConfig, ProfileConfig, RunMultipleAppsConfig } from "./types";

// @group Configuration : Read-only .overture/config.json access for the browser (web worker)
//                        extension host — vscode.workspace.fs works against any FileSystemProvider,
//                        unlike the desktop path's raw Node `fs`, but there's no real process to run
//                        apps with in that host, so this never grew a write path. Mutations still go
//                        through the desktop/remote extension via ConfigManager.
export class WebConfigReader implements vscode.Disposable {
  readonly configUri: vscode.Uri;
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _onDidChange = new vscode.EventEmitter<RunMultipleAppsConfig | undefined>();

  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly workspaceRoot: vscode.Uri) {
    this.configUri = vscode.Uri.joinPath(workspaceRoot, ".overture", "config.json");
    this._setupWatcher();
  }

  private _setupWatcher(): void {
    const pattern = new vscode.RelativePattern(this.workspaceRoot, ".overture/config.json");
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      try {
        this._onDidChange.fire(await this.load());
      } catch { /* ignore transient errors */ }
    };

    this._watcher.onDidChange(reload);
    this._watcher.onDidCreate(reload);
    this._watcher.onDidDelete(() => this._onDidChange.fire(undefined));
  }

  async exists(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.configUri);
      return true;
    } catch {
      return false;
    }
  }

  // @group Configuration : Parse config.json — mirrors ConfigManager.load()'s normalization
  //                        (default retentionDays, string[] -> ProfileConfig migration, app
  //                        defaults). Duplicated rather than shared since ConfigManager pulls in
  //                        Node's `fs`, which doesn't exist in the browser extension host.
  async load(): Promise<RunMultipleAppsConfig> {
    const bytes = await vscode.workspace.fs.readFile(this.configUri);
    const raw = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(raw) as Partial<RunMultipleAppsConfig>;

    const rawProfiles = (parsed.profiles ?? {}) as Record<string, string[] | ProfileConfig>;
    const profiles: Record<string, ProfileConfig> = {};
    for (const [name, value] of Object.entries(rawProfiles)) {
      profiles[name] = Array.isArray(value) ? { apps: value } : (value as ProfileConfig);
    }

    return {
      retentionDays: parsed.retentionDays ?? 7,
      profiles,
      apps: (parsed.apps ?? []).map((a): AppConfig => ({
        name: a.name ?? "unnamed",
        path: a.path ?? ".",
        command: a.command ?? "npm run dev",
        enabled: a.enabled !== false,
        archived: a.archived === true,
        ...(a.namespace?.trim() ? { namespace: a.namespace.trim() } : {}),
      })),
    };
  }

  dispose(): void {
    this._watcher?.dispose();
    this._onDidChange.dispose();
  }
}
