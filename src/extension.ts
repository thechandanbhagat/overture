import * as vscode from "vscode";
import { ConfigManager } from "./config-manager";
import { AppRunner } from "./app-runner";
import {
  AppTreeProvider,
  AppTreeItem,
  ProfileItem,
  RunAppsTreeNode,
} from "./app-tree-provider";
import { LogManager } from "./log-manager";
import { StateManager } from "./state-manager";
import { RatingPrompt } from "./rating-prompt";
import {
  ProjectScanner,
  DiscoveredScript,
  generateAppName,
  PRIMARY_SCRIPTS,
} from "./project-scanner";

// @group Utilities : Managers — initialized once a workspace root is known
let configManager: ConfigManager | undefined;
let logManager: LogManager | undefined;
let stateManager: StateManager | undefined;
let appRunner: AppRunner | undefined;

// @group Configuration : Extension entry point
export function activate(context: vscode.ExtensionContext): void {
  // Proxy emitter so the tree view always has a stable data provider,
  // even before a workspace folder is open.
  const proxyEmitter = new vscode.EventEmitter<void>();
  let treeProvider: AppTreeProvider | undefined;

  const proxyDataProvider: vscode.TreeDataProvider<RunAppsTreeNode> = {
    onDidChangeTreeData: proxyEmitter.event,
    getTreeItem: (e) => e,
    getChildren: (e) => treeProvider?.getChildren(e) ?? [],
  };

  const treeView = vscode.window.createTreeView("overtureView", {
    treeDataProvider: proxyDataProvider,
    showCollapseAll: false,
  });

  // @group Utilities : Status bar item
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = "overture.startAll";
  statusBar.text = `$(play) Overture`;
  statusBar.show();

  context.subscriptions.push(treeView, statusBar, proxyEmitter);

  // @group Utilities : Get workspace root — always read fresh, never captured
  function getRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  function requireRoot(): string | undefined {
    const root = getRoot();
    if (!root) {
      vscode.window.showErrorMessage(
        "Overture: Open a workspace folder first (File → Open Folder)."
      );
    }
    return root;
  }

  function updateStatusBar(): void {
    if (!appRunner) { return; }
    const states = appRunner.getAllStates();
    const running = states.filter((s) => s.status === "running").length;
    const enabled = states.filter((s) => s.config.enabled).length;
    if (running === 0) {
      statusBar.text = `$(play) Overture`;
      statusBar.tooltip = "Click to start all enabled apps";
    } else {
      statusBar.text = `$(circle-filled) ${running}/${enabled} running`;
      statusBar.tooltip = `${running} of ${enabled} apps running`;
    }
  }

  // @group BusinessLogic : Boot or re-boot managers when a workspace is available
  async function initialize(): Promise<void> {
    const root = getRoot();
    if (!root) { return; }

    // Create managers on first initialize
    if (!configManager) {
      configManager = new ConfigManager(root);
      logManager    = new LogManager(root);
      stateManager  = new StateManager(root);
      appRunner     = new AppRunner(logManager, root, stateManager);
      treeProvider  = new AppTreeProvider(appRunner);

      // Forward tree change events through the proxy
      treeProvider.onDidChangeTreeData(() => proxyEmitter.fire());

      const ratingPrompt = new RatingPrompt(context);
      let prevRunningCount = 0;

      configManager.onDidChange(() => initialize());
      appRunner.onDidChangeState(() => {
        proxyEmitter.fire();
        updateStatusBar();

        // Fire rating prompt when a new (non-resumed) app starts
        const runningCount = appRunner!
          .getAllStates()
          .filter((s) => s.status === "running" && !s.resumed).length;
        if (runningCount > prevRunningCount) {
          ratingPrompt.onAppStarted();
        }
        prevRunningCount = runningCount;
      });

      context.subscriptions.push(
        configManager,
        treeProvider,
        { dispose: () => appRunner?.dispose() }
      );
    }

    if (!configManager.exists()) {
      vscode.commands.executeCommand("setContext", "overture.noConfig", true);
      vscode.commands.executeCommand("setContext", "overture.noApps", false);
      return;
    }

    try {
      vscode.commands.executeCommand("setContext", "overture.noConfig", false);
      const config = await configManager.load();
      const hasApps = config.apps.some((a) => !a.archived);
      vscode.commands.executeCommand("setContext", "overture.noApps", !hasApps);
      logManager!.setConfig(config);
      logManager!.cleanOldLogs(config.retentionDays);
      appRunner!.setApps(config.apps);
      appRunner!.resumeFromState();
      treeProvider!.setProfiles(config.profiles ?? {});
      proxyEmitter.fire();
      updateStatusBar();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Overture: ${msg}`);
    }
  }

  // @group BusinessLogic : Scan workspace for Node.js package scripts
  async function runScan(): Promise<void> {
    const root = requireRoot();
    if (!root) { return; }

    // Ensure managers exist so addApps works
    await initialize();

    const existingNames = new Set<string>();
    if (configManager?.exists()) {
      try {
        const cfg = await configManager.load();
        cfg.apps.forEach((a) => existingNames.add(a.name));
      } catch { /* proceed empty */ }
    }

    let discovered: DiscoveredScript[];
    try {
      discovered = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Scanning for Node.js projects…",
          cancellable: false,
        },
        () => new ProjectScanner(root).scan()
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Scan failed: ${msg}`);
      return;
    }

    if (discovered.length === 0) {
      vscode.window.showInformationMessage(
        "No Node.js projects with package scripts found in this workspace."
      );
      return;
    }

    // Build QuickPick items grouped by project path using separators
    type PickItem = vscode.QuickPickItem & { script?: DiscoveredScript };
    const items: PickItem[] = [];
    let lastPath: string | undefined;

    for (const script of discovered) {
      if (script.relativePath !== lastPath) {
        items.push({
          label: script.relativePath,
          description: script.packageName,
          kind: vscode.QuickPickItemKind.Separator,
        });
        lastPath = script.relativePath;
      }

      const generatedName = generateAppName(script);
      const alreadyAdded = existingNames.has(generatedName);
      const icon = PRIMARY_SCRIPTS.has(script.scriptName) ? "$(play)" : "$(gear)";

      items.push({
        label: `${icon} ${script.scriptName}`,
        description: script.command,
        detail: alreadyAdded
          ? "$(check) Already in config"
          : `Will be added as "${generatedName}"`,
        picked: script.isPrimary && !alreadyAdded,
        script: alreadyAdded ? undefined : script,
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: `Scan Results — ${discovered.length} scripts found across ${new Set(discovered.map((d) => d.relativePath)).size} project(s)`,
      placeHolder: "Select scripts to add — ▶ dev/start scripts are pre-selected",
      matchOnDescription: true,
    });

    if (!picked || picked.length === 0) { return; }

    const toAdd = picked.filter((p) => p.script != null).map((p) => p.script!);
    if (toAdd.length === 0) {
      vscode.window.showInformationMessage("All selected scripts are already in your config.");
      return;
    }

    await configManager!.addApps(
      toAdd.map((s) => ({
        name: generateAppName(s),
        path: s.relativePath === "." ? "." : `./${s.relativePath}`,
        command: s.command,
        enabled: s.isPrimary,
      }))
    );

    await initialize();

    const label = toAdd.length === 1
      ? `Added "${generateAppName(toAdd[0])}" to config`
      : `Added ${toAdd.length} scripts to config`;

    const action = await vscode.window.showInformationMessage(label, "Open Config");
    if (action === "Open Config") {
      vscode.window.showTextDocument(vscode.Uri.file(configManager!.configPath));
    }
  }

  // @group Exports : Register all commands — always, regardless of workspace state
  context.subscriptions.push(
    vscode.commands.registerCommand("overture.scanProjects", runScan),

    vscode.commands.registerCommand("overture.startAll", async () => {
      if (!requireRoot()) { return; }
      await appRunner?.startAll();
    }),

    vscode.commands.registerCommand("overture.stopAll", async () => {
      if (!requireRoot()) { return; }
      await appRunner?.stopAll();
    }),

    vscode.commands.registerCommand("overture.refresh", () => initialize()),

    vscode.commands.registerCommand("overture.openConfig", () => {
      if (!requireRoot()) { return; }
      if (!configManager?.exists()) {
        vscode.window.showWarningMessage('No config found. Use "Create Config" first.');
        return;
      }
      vscode.window.showTextDocument(vscode.Uri.file(configManager.configPath));
    }),

    vscode.commands.registerCommand("overture.createConfig", async () => {
      if (!requireRoot()) { return; }
      await initialize(); // ensure configManager exists
      configManager!.createDefault();
      await initialize();
      await runScan();
    }),

    vscode.commands.registerCommand("overture.startApp", (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      appRunner?.startApp(item.appName);
    }),

    vscode.commands.registerCommand("overture.stopApp", (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      appRunner?.stopApp(item.appName);
    }),

    vscode.commands.registerCommand("overture.restartApp", (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      appRunner?.restartApp(item.appName);
    }),

    vscode.commands.registerCommand("overture.toggleEnable", async (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      if (item.appStatus === "running") {
        await appRunner?.stopApp(item.appName);
      }
      await configManager?.toggleEnable(item.appName);
    }),

    vscode.commands.registerCommand("overture.showOutput", (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      appRunner?.showOutput(item.appName);
    }),

    // @group BusinessLogic : Stop all apps belonging to a profile
    vscode.commands.registerCommand("overture.stopProfile", async (item: ProfileItem) => {
      if (!requireRoot() || !item?.profileName) { return; }
      const names = new Set(item.appNames);
      const states = appRunner?.getAllStates() ?? [];
      for (const s of states) {
        if (names.has(s.config.name) && s.status === "running") {
          await appRunner?.stopApp(s.config.name);
        }
      }
    }),

    // @group BusinessLogic : Toggle favorite flag on a profile
    vscode.commands.registerCommand("overture.toggleFavoriteProfile", (item: ProfileItem) => {
      if (!requireRoot() || !item?.profileName) { return; }
      configManager?.toggleFavoriteProfile(item.profileName);
      initialize();
    }),

    // @group BusinessLogic : Toggle archived flag on an app
    vscode.commands.registerCommand("overture.toggleArchive", async (item: AppTreeItem) => {
      if (!requireRoot() || !item?.appName) { return; }
      if (item.appStatus === "running") {
        await appRunner?.stopApp(item.appName);
      }
      configManager?.toggleArchive(item.appName);
      initialize();
    }),

    // @group BusinessLogic : Edit an existing profile — re-pick apps and optionally rename
    vscode.commands.registerCommand("overture.editProfile", async (item: ProfileItem) => {
      if (!requireRoot() || !item?.profileName) { return; }
      await initialize();

      const states = appRunner?.getAllStates() ?? [];
      const currentApps = new Set(item.appNames);

      // Step 1 — re-pick apps with current selection pre-checked
      const picked = await vscode.window.showQuickPick(
        states
          .filter((s) => !s.config.archived)
          .map((s) => ({
            label: s.config.name,
            description: s.config.command,
            detail: s.config.path,
            picked: currentApps.has(s.config.name),
          })),
        {
          canPickMany: true,
          title: `Edit Profile "${item.profileName}" — Select Apps`,
          placeHolder: "Check the apps to include",
        }
      );

      if (!picked || picked.length === 0) { return; }

      // Step 2 — rename (optional, pre-filled with current name)
      const existingProfiles = configManager?.getProfiles() ?? {};
      const newName = await vscode.window.showInputBox({
        title: "Edit Profile",
        prompt: "Profile name (change to rename)",
        value: item.profileName,
        validateInput: (v) => {
          if (!v.trim()) { return "Name cannot be empty"; }
          if (v.trim() !== item.profileName && existingProfiles[v.trim()]) {
            return `"${v.trim()}" already exists`;
          }
          return null;
        },
      });

      if (!newName?.trim()) { return; }

      configManager!.editProfile(item.profileName, newName.trim(), picked.map((p) => p.label));
      await initialize();
      vscode.window.showInformationMessage(`Profile "${newName.trim()}" updated.`);
    }),

    // @group BusinessLogic : Create a named profile by picking apps with checkboxes
    vscode.commands.registerCommand("overture.createProfile", async () => {
      if (!requireRoot()) { return; }
      await initialize();

      // No config at all — offer to create one
      if (!configManager?.exists()) {
        const action = await vscode.window.showInformationMessage(
          "No Overture config found. Create one to get started.",
          "Create & Scan for Projects",
          "Create Blank Config"
        );
        if (action === "Create & Scan for Projects") {
          configManager!.createDefault();
          await initialize();
          await runScan();
        } else if (action === "Create Blank Config") {
          configManager!.createDefault();
          await initialize();
          vscode.window.showTextDocument(vscode.Uri.file(configManager!.configPath));
        }
        return;
      }

      const states = appRunner?.getAllStates() ?? [];
      const activeApps = states.filter((s) => !s.config.archived);
      if (activeApps.length === 0) {
        const action = await vscode.window.showInformationMessage(
          "No apps configured yet. Scan your workspace for projects or open the config to add apps manually.",
          "Scan for Projects",
          "Open Config"
        );
        if (action === "Scan for Projects") {
          await runScan();
        } else if (action === "Open Config") {
          vscode.window.showTextDocument(vscode.Uri.file(configManager!.configPath));
        }
        return;
      }

      // Step 1 — pick apps with checkboxes
      const picked = await vscode.window.showQuickPick(
        states.map((s) => ({
          label: s.config.name,
          description: s.config.command,
          detail: s.config.path,
          picked: false,
        })),
        {
          canPickMany: true,
          title: "Create Profile — Select Apps",
          placeHolder: "Check the apps to include in this profile",
        }
      );

      if (!picked || picked.length === 0) { return; }

      // Step 2 — name the profile
      const existingProfiles = configManager?.getProfiles() ?? {};
      const name = await vscode.window.showInputBox({
        title: "Create Profile",
        prompt: `Name for this profile (${picked.length} apps selected)`,
        placeHolder: "e.g. frontend, fullstack, backend-only",
        validateInput: (v) => {
          if (!v.trim()) { return "Name cannot be empty"; }
          if (existingProfiles[v.trim()]) { return `"${v.trim()}" already exists`; }
          return null;
        },
      });

      if (!name?.trim()) { return; }

      configManager!.createProfile(name.trim(), picked.map((p) => p.label));
      await initialize();
      vscode.window.showInformationMessage(
        `Profile "${name.trim()}" created with ${picked.length} app(s).`
      );
    }),

    // @group BusinessLogic : Start all apps that belong to a profile
    vscode.commands.registerCommand("overture.startProfile", async (item: ProfileItem) => {
      if (!requireRoot() || !item?.profileName) { return; }
      await appRunner?.startProfile(item.appNames);
    }),

    // @group BusinessLogic : Delete a profile from config
    vscode.commands.registerCommand("overture.deleteProfile", async (item: ProfileItem) => {
      if (!requireRoot() || !item?.profileName) { return; }
      const confirm = await vscode.window.showWarningMessage(
        `Delete profile "${item.profileName}"?`,
        { modal: true },
        "Delete"
      );
      if (confirm !== "Delete") { return; }
      configManager?.deleteProfile(item.profileName);
      await initialize();
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => initialize())
  );

  initialize();
}

export function deactivate(): void {
  // Ensure all child processes are terminated when the extension is deactivated
  // (e.g. VS Code exits) so they don't become orphaned and block ports.
  appRunner?.dispose();
}
