import * as vscode from "vscode";
import { AppRunner } from "./app-runner";
import { appResourceUri, changeSummary } from "./git-decoration-provider";
import { ProfileConfig, AppStatus, GitStatus } from "./types";

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

// @group Types : App detail sub-node (child of AppTreeItem)
export class AppDetailItem extends vscode.TreeItem {
  constructor(label: string, detail: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = detail;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "app-detail";
  }
}

// @group Types : Profile app sub-node (child of ProfileItem)
export class ProfileAppItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("circle-outline");
    this.contextValue = "profile-app";
  }
}

export type RunAppsTreeNode = SectionItem | ProfileItem | AppTreeItem | AppDetailItem | ProfileAppItem;

// @group BusinessLogic : TreeDataProvider — Favorites → Profiles → Apps → Archived
export class AppTreeProvider
  implements vscode.TreeDataProvider<RunAppsTreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<RunAppsTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _profiles: Record<string, ProfileConfig> = {};

  constructor(private readonly runner: AppRunner) {}

  setProfiles(profiles: Record<string, ProfileConfig>): void {
    this._profiles = profiles;
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
    if (element instanceof AppTreeItem) {
      return this._childrenForApp(element);
    }
    if (element instanceof ProfileItem) {
      return element.appNames.map((name) => new ProfileAppItem(name));
    }
    return [];
  }

  private _buildRootSections(): SectionItem[] {
    const sections: SectionItem[] = [];
    const states = this.runner.getAllStates();
    const profiles = Object.entries(this._profiles);
    const favorites = profiles.filter(([, p]) => p.favorite);
    const nonFavorites = profiles.filter(([, p]) => !p.favorite);
    const activeApps  = states.filter((s) => !s.config.archived);
    const archivedApps = states.filter((s) => s.config.archived);
    const running = activeApps.filter((s) => s.status === "running").length;

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
        running > 0
          ? `${running}/${activeApps.length} running`
          : `${activeApps.length}`
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
      return this.runner
        .getAllStates()
        .filter((s) => !s.config.archived)
        .map(
          (s) =>
            new AppTreeItem(s.config.name, s.status, s.config.command, s.config.path, s.pid, s.resumed, s.gitBranch)
        );
    }

    if (sectionId === "archived") {
      return this.runner
        .getAllStates()
        .filter((s) => s.config.archived)
        .map(
          (s) =>
            new AppTreeItem(s.config.name, s.status, s.config.command, s.config.path, s.pid, s.resumed, s.gitBranch)
        );
    }

    return [];
  }

  // @group BusinessLogic : Build detail sub-items for an app node
  private _childrenForApp(app: AppTreeItem): AppDetailItem[] {
    const items: AppDetailItem[] = [
      new AppDetailItem("Command", app.appCommand, "terminal"),
      new AppDetailItem("Path", app.appPath, "folder"),
    ];
    if (app.appPid) {
      items.push(new AppDetailItem("PID", String(app.appPid), "info"));
    }
    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
