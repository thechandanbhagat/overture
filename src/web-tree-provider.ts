import * as vscode from "vscode";
import { WebConfigReader } from "./web-config-reader";
import {
  AppConfig,
  DEFAULT_NAMESPACE,
  ProfileConfig,
  RunMultipleAppsConfig,
  collectNamespaces,
  namespaceOf,
} from "./types";

const UNAVAILABLE_TOOLTIP =
  "_Running apps needs a full VS Code backend — open this workspace in GitHub Codespaces, via Remote-SSH/WSL, or in desktop VS Code._";

// @group Types : Root grouping node — "PROFILES" and "APPS"
export class WebSectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: "apps" | "profiles",
    label: string,
    description: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = description;
    this.contextValue = `web-section-${sectionId}`;
  }
}

// @group Types : Read-only app node — deliberately distinct contextValue so none of the
//                start/stop/restart context-menu actions declared for `app-<status>` match here.
export class WebAppItem extends vscode.TreeItem {
  constructor(public readonly app: AppConfig) {
    super(app.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "app-web-unavailable";
    this.iconPath = app.enabled
      ? new vscode.ThemeIcon("circle-outline")
      : new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground"));
    const ns = namespaceOf(app);
    const nsSuffix = ns !== DEFAULT_NAMESPACE ? `  ⎏ ${ns}` : "";
    this.description = `${app.enabled ? "not running (web)" : "disabled"}${nsSuffix}`;
    this.tooltip = new vscode.MarkdownString(
      [
        `**${app.name}**`,
        "",
        `Command: \`${app.command}\``,
        `Path: \`${app.path}\``,
        "",
        UNAVAILABLE_TOOLTIP,
      ].join("\n")
    );
  }

  get appName(): string {
    return this.app.name;
  }
}

// @group Types : Read-only profile node
export class WebProfileItem extends vscode.TreeItem {
  constructor(
    public readonly profileName: string,
    public readonly profileConfig: ProfileConfig
  ) {
    super(profileName, vscode.TreeItemCollapsibleState.None);
    const count = profileConfig.apps.length;
    this.description = `${count} app${count === 1 ? "" : "s"}`;
    this.contextValue = "profile-web-unavailable";
    this.iconPath = new vscode.ThemeIcon(
      profileConfig.favorite ? "star-full" : "layers-dot",
      profileConfig.favorite ? new vscode.ThemeColor("charts.yellow") : undefined
    );
    this.tooltip = new vscode.MarkdownString(
      `**${profileName}**\n\n${profileConfig.apps.map((n) => `- ${n}`).join("\n")}`
    );
  }
}

export type WebTreeNode = WebSectionItem | WebAppItem | WebProfileItem;

// @group BusinessLogic : Read-only TreeDataProvider for the browser extension host —
//                        shows what's configured, never anything live (status, PID, git).
export class WebAppTreeProvider
  implements vscode.TreeDataProvider<WebTreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _config: RunMultipleAppsConfig | undefined;
  private _configExists = false;
  private _activeNamespace: string | undefined;

  constructor(private readonly reader: WebConfigReader | undefined) {}

  // @group BusinessLogic : Re-read config.json from disk and re-render
  async reload(): Promise<void> {
    this._configExists = this.reader ? await this.reader.exists() : false;
    this._config = this._configExists ? await this.reader!.load() : undefined;
    this._onDidChangeTreeData.fire();
  }

  // @group Configuration : Narrow the tree to a single namespace (undefined = all)
  setActiveNamespace(namespace: string | undefined): void {
    this._activeNamespace = namespace;
    this.render();
  }

  // @group BusinessLogic : Re-render from the already-loaded config, without touching disk
  render(): void {
    this._onDidChangeTreeData.fire();
  }

  hasConfig(): boolean {
    return this._configExists;
  }

  hasApps(): boolean {
    return this._config?.apps.some((a) => !a.archived) ?? false;
  }

  // @group Utilities : All non-archived apps, unfiltered by namespace or the showDisabledApps
  //                    setting — used for namespace-picker counts
  getApps(): AppConfig[] {
    return this._config?.apps.filter((a) => !a.archived) ?? [];
  }

  getNamespaces(): string[] {
    return this._config ? collectNamespaces(this.getApps()) : [];
  }

  getTreeItem(element: WebTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: WebTreeNode): WebTreeNode[] {
    if (!this._config) { return []; }

    if (!element) {
      const sections: WebTreeNode[] = [];
      const profiles = Object.entries(this._config.profiles ?? {});
      if (profiles.length > 0) {
        sections.push(new WebSectionItem("profiles", "PROFILES", `${profiles.length}`));
      }
      sections.push(new WebSectionItem("apps", "APPS", `${this._visibleApps().length}`));
      return sections;
    }

    if (element instanceof WebSectionItem) {
      return element.sectionId === "profiles"
        ? Object.entries(this._config.profiles ?? {}).map(
            ([name, cfg]) => new WebProfileItem(name, cfg)
          )
        : this._visibleApps().map((a) => new WebAppItem(a));
    }

    return [];
  }

  private _visibleApps(): AppConfig[] {
    const showDisabled = vscode.workspace
      .getConfiguration("overture")
      .get<boolean>("showDisabledApps", true);
    return this.getApps().filter(
      (a) =>
        (!this._activeNamespace || namespaceOf(a) === this._activeNamespace) &&
        (showDisabled || a.enabled)
    );
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
