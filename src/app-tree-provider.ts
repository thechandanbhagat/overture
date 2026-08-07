import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { AppRunner } from "./app-runner";
import { appResourceUri, changeSummary } from "./git-decoration-provider";
import {
  ProfileConfig,
  AppState,
  AppStatus,
  GitStatus,
  collectNamespaces,
  namespaceOf,
} from "./types";

// @group Types : Section header node
export class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: "favorites" | "profiles" | "apps" | "archived",
    label: string,
    description: string,
    collapsed = false
  ) {
    super(
      label,
      collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.description = description;
    this.contextValue = `section-${sectionId}`;
    this.iconPath = new vscode.ThemeIcon(
      sectionId === "favorites" ? "star-full" :
      sectionId === "profiles"  ? "layers" :
      sectionId === "archived"  ? "archive" :
      "list-unordered"
    );
  }
}

// @group Types : Namespace group node — only rendered when apps span more than one namespace
export class NamespaceItem extends vscode.TreeItem {
  constructor(
    public readonly namespace: string,
    appCount: number,
    runningCount: number
  ) {
    super(namespace, vscode.TreeItemCollapsibleState.Expanded);
    this.description = runningCount > 0 ? `${runningCount}/${appCount} running` : `${appCount}`;
    this.contextValue = "namespace";
    this.iconPath = new vscode.ThemeIcon("symbol-namespace");
  }
}

// @group Types : Profile node
export class ProfileItem extends vscode.TreeItem {
  constructor(
    public readonly profileName: string,
    public readonly profileConfig: ProfileConfig
  ) {
    super(profileName, vscode.TreeItemCollapsibleState.Collapsed);
    const count = profileConfig.apps.length;
    this.description = `${count} app${count !== 1 ? "s" : ""}`;
    this.contextValue = profileConfig.favorite ? "profile-favorite" : "profile";
    this.iconPath = new vscode.ThemeIcon(
      profileConfig.favorite ? "star-full" : "layers-dot",
      profileConfig.favorite ? new vscode.ThemeColor("charts.yellow") : undefined
    );
    this.tooltip = new vscode.MarkdownString(
      `**${profileName}**\n\n${profileConfig.apps.map((n) => `- ${n}`).join("\n")}`
    );
  }

  get appNames(): string[] {
    return this.profileConfig.apps;
  }
}

// @group Types : App node
export class AppTreeItem extends vscode.TreeItem {
  constructor(
    public readonly appName: string,
    public readonly appStatus: AppStatus,
    public readonly appCommand: string,
    public readonly appPath: string,
    public readonly appPid: number | undefined,
    public readonly appResumed = false,
    public readonly gitBranch?: string,
    public readonly gitStatus?: GitStatus
  ) {
    super(appName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `app-${appStatus}`;
    this.iconPath = AppTreeItem.iconForStatus(appStatus);
    this.description = AppTreeItem.descriptionForStatus(appStatus, appPid, appResumed, gitBranch);
    this.resourceUri = appResourceUri(appName); // carries the git decoration for this app
    const changes = gitStatus ? changeSummary(gitStatus) : "";
    this.tooltip = new vscode.MarkdownString(
      [
        `**${appName}**`,
        "",
        `Command: \`${appCommand}\``,
        `Path: \`${appPath}\``,
        gitBranch ? `Branch: \`${gitBranch}\`` : "",
        changes ? `Changes: ${changes}` : "",
        `Status: ${appStatus}`,
        appPid ? `PID: ${appPid}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  static iconForStatus(status: AppStatus): vscode.ThemeIcon {
    switch (status) {
      case "running":
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.runAction"));
      case "error":
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("errorForeground"));
      case "disabled":
        return new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground"));
      case "archived":
        return new vscode.ThemeIcon("archive", new vscode.ThemeColor("disabledForeground"));
      default:
        return new vscode.ThemeIcon("circle-outline");
    }
  }

  static descriptionForStatus(
    status: AppStatus,
    pid: number | undefined,
    resumed = false,
    gitBranch?: string
  ): string {
    const branch = gitBranch ? `  ⎏ ${gitBranch}` : "";
    switch (status) {
      case "running":
        return pid
          ? `${resumed ? "↩ resumed" : "running"}  (pid ${pid})${branch}`
          : `running${branch}`;
      case "error":    return `exited with error${branch}`;
      case "disabled": return "disabled";
      case "archived": return "archived";
      default:         return gitBranch ? `⎏ ${gitBranch}` : "";
    }
  }
}

// @group Types : App detail sub-node (child of AppTreeItem). The "Path" detail is
//               expandable into a file explorer rooted at dirPath.
export class AppDetailItem extends vscode.TreeItem {
  constructor(
    label: string,
    detail: string,
    icon: string,
    public readonly dirPath?: string
  ) {
    super(
      label,
      dirPath ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.description = detail;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = dirPath ? "app-detail-path" : "app-detail";
  }
}

// @group Types : Collapsible "Details" group node (child of AppTreeItem) — Command, PID, Logs
export class AppDetailsGroupItem extends vscode.TreeItem {
  constructor(
    public readonly appName: string,
    public readonly appCommand: string,
    public readonly appPid?: number
  ) {
    super("Details", vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("list-unordered");
    this.contextValue = "app-details-group";
  }
}

// @group Types : Collapsible "Logs" group node (child of AppDetailsGroupItem)
export class AppLogsGroupItem extends vscode.TreeItem {
  constructor(public readonly appName: string) {
    super("Logs", vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("output");
    this.contextValue = "app-logs-group";
  }
}

// @group Types : Single retained log file (child of AppLogsGroupItem) — click opens it in the editor
export class AppLogFileItem extends vscode.TreeItem {
  constructor(public readonly filePath: string) {
    const uri = vscode.Uri.file(filePath);
    super(uri, vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.contextValue = "app-log-file";
    this.command = { command: "vscode.open", title: "Open Log", arguments: [uri] };
  }
}

// @group Types : File/folder node within an app's file explorer sub-tree
export class AppFileItem extends vscode.TreeItem {
  constructor(
    public readonly fsPath: string,
    public readonly isDirectory: boolean
  ) {
    const uri = vscode.Uri.file(fsPath);
    super(uri, isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.contextValue = isDirectory ? "app-folder" : "app-file";
    if (!isDirectory) {
      this.command = { command: "vscode.open", title: "Open File", arguments: [uri] };
    }
  }
}

// @group Types : Profile app sub-node (child of ProfileItem) — mirrors the app's live status
//               and contextValue so it picks up the same start/stop/restart/etc. menu actions.
export class ProfileAppItem extends vscode.TreeItem {
  constructor(
    public readonly appName: string,
    public readonly appStatus: AppStatus,
    public readonly appPid?: number,
    public readonly appResumed = false,
    public readonly gitBranch?: string
  ) {
    super(appName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `app-${appStatus}`;
    this.iconPath = AppTreeItem.iconForStatus(appStatus);
    this.description = AppTreeItem.descriptionForStatus(appStatus, appPid, appResumed, gitBranch);
    this.resourceUri = appResourceUri(appName); // carries the git decoration for this app
  }
}

export type RunAppsTreeNode =
  | SectionItem
  | NamespaceItem
  | ProfileItem
  | AppTreeItem
  | AppDetailItem
  | AppDetailsGroupItem
  | AppLogsGroupItem
  | AppLogFileItem
  | ProfileAppItem
  | AppFileItem;

// @group BusinessLogic : TreeDataProvider — Favorites → Profiles → Apps → Archived
export class AppTreeProvider
  implements vscode.TreeDataProvider<RunAppsTreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<RunAppsTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _profiles: Record<string, ProfileConfig> = {};
  private _activeNamespace: string | undefined; // undefined = show every namespace

  constructor(private readonly runner: AppRunner) {}

  setProfiles(profiles: Record<string, ProfileConfig>): void {
    this._profiles = profiles;
  }

  // @group Configuration : Narrow the tree to a single namespace (undefined = all)
  setActiveNamespace(namespace: string | undefined): void {
    this._activeNamespace = namespace;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RunAppsTreeNode): vscode.TreeItem {
    return element;
  }

  // @group BusinessLogic : Build root sections dynamically based on what exists
  getChildren(element?: RunAppsTreeNode): RunAppsTreeNode[] {
    if (!element) {
      return this._buildRootSections();
    }
    if (element instanceof SectionItem) {
      return this._childrenForSection(element.sectionId);
    }
    if (element instanceof NamespaceItem) {
      return this._appItems(
        this._activeApps().filter((s) => namespaceOf(s.config) === element.namespace)
      );
    }
    if (element instanceof AppTreeItem) {
      return this._childrenForApp(element);
    }
    if (element instanceof ProfileItem) {
      const states = this.runner.getAllStates();
      return element.appNames.map((name) => {
        const state = states.find((s) => s.config.name === name);
        return new ProfileAppItem(
          name,
          state?.status ?? "stopped",
          state?.pid,
          state?.resumed,
          state?.gitBranch
        );
      });
    }
    if (element instanceof AppDetailsGroupItem) {
      return this._childrenForDetailsGroup(element);
    }
    if (element instanceof AppLogsGroupItem) {
      return this.runner.listLogFiles(element.appName).map((f) => new AppLogFileItem(f));
    }
    if (element instanceof AppDetailItem && element.dirPath) {
      return this._readDir(element.dirPath);
    }
    if (element instanceof AppFileItem && element.isDirectory) {
      return this._readDir(element.fsPath);
    }
    return [];
  }

  // @group BusinessLogic : Build children of the "Details" group — Command, PID, Logs
  private _childrenForDetailsGroup(group: AppDetailsGroupItem): RunAppsTreeNode[] {
    const items: RunAppsTreeNode[] = [new AppDetailItem("Command", group.appCommand, "terminal")];
    if (group.appPid) {
      items.push(new AppDetailItem("PID", String(group.appPid), "info"));
    }
    items.push(new AppLogsGroupItem(group.appName));
    return items;
  }

  // @group BusinessLogic : List a directory's entries as file explorer nodes (folders first, then files, alphabetical)
  private _readDir(dirPath: string): AppFileItem[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .sort((a, b) =>
        a.isDirectory() !== b.isDirectory()
          ? a.isDirectory() ? -1 : 1
          : a.name.localeCompare(b.name)
      )
      .map((entry) => new AppFileItem(path.join(dirPath, entry.name), entry.isDirectory()));
  }

  private _visibleStates(states: AppState[]): AppState[] {
    return states.filter(
      (s) => !this._activeNamespace || namespaceOf(s.config) === this._activeNamespace
    );
  }

  // @group Utilities : Non-archived apps the sidebar should currently show
  private _activeApps(): AppState[] {
    return this._visibleStates(this.runner.getAllStates().filter((s) => !s.config.archived));
  }

  private _appItems(states: AppState[]): AppTreeItem[] {
    return states.map(
      (s) =>
        new AppTreeItem(
          s.config.name,
          s.status,
          s.config.command,
          s.config.path,
          s.pid,
          s.resumed,
          s.gitBranch,
          s.gitStatus
        )
    );
  }

  private _buildRootSections(): SectionItem[] {
    const sections: SectionItem[] = [];
    const states = this.runner.getAllStates();
    const profiles = Object.entries(this._profiles);
    const favorites = profiles.filter(([, p]) => p.favorite);
    const nonFavorites = profiles.filter(([, p]) => !p.favorite);
    const activeApps  = this._activeApps();
    const archivedApps = this._visibleStates(states.filter((s) => s.config.archived));
    const running = activeApps.filter((s) => s.status === "running").length;
    const appsCount = running > 0 ? `${running}/${activeApps.length} running` : `${activeApps.length}`;

    if (favorites.length > 0) {
      sections.push(new SectionItem("favorites", "FAVORITES", `${favorites.length}`));
    }

    sections.push(
      new SectionItem(
        "profiles",
        "PROFILES",
        nonFavorites.length === 0 ? "none" : `${nonFavorites.length}`
      )
    );

    sections.push(
      new SectionItem(
        "apps",
        "APPS",
        // Surface the filter here — otherwise a namespace-filtered tree is indistinguishable
        // from one where apps have gone missing.
        this._activeNamespace ? `${this._activeNamespace} · ${appsCount}` : appsCount
      )
    );

    if (archivedApps.length > 0) {
      sections.push(
        new SectionItem("archived", "ARCHIVED", `${archivedApps.length}`, true /* collapsed */)
      );
    }

    return sections;
  }

  private _childrenForSection(
    sectionId: "favorites" | "profiles" | "apps" | "archived"
  ): RunAppsTreeNode[] {
    if (sectionId === "favorites") {
      return Object.entries(this._profiles)
        .filter(([, p]) => p.favorite)
        .map(([name, cfg]) => new ProfileItem(name, cfg));
    }

    if (sectionId === "profiles") {
      return Object.entries(this._profiles)
        .filter(([, p]) => !p.favorite)
        .map(([name, cfg]) => new ProfileItem(name, cfg));
    }

    if (sectionId === "apps") {
      const apps = this._activeApps();
      const namespaces = collectNamespaces(apps.map((s) => s.config));
      // One namespace needs no grouping level — which also keeps the tree flat for everyone
      // who never touches namespaces, and while a namespace filter is active.
      if (namespaces.length <= 1) {
        return this._appItems(apps);
      }
      return namespaces.map((ns) => {
        const inNamespace = apps.filter((s) => namespaceOf(s.config) === ns);
        return new NamespaceItem(
          ns,
          inNamespace.length,
          inNamespace.filter((s) => s.status === "running").length
        );
      });
    }

    if (sectionId === "archived") {
      return this._appItems(
        this._visibleStates(this.runner.getAllStates().filter((s) => s.config.archived))
      );
    }

    return [];
  }

  // @group BusinessLogic : Build top-level sub-items for an app node — "Details" (Command, PID, Logs)
  //                        and "Path" (file explorer), both collapsible so they line up visually.
  private _childrenForApp(app: AppTreeItem): RunAppsTreeNode[] {
    return [
      new AppDetailsGroupItem(app.appName, app.appCommand, app.appPid),
      new AppDetailItem("Path", app.appPath, "folder", this.runner.resolveAppPath(app.appPath)),
    ];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
