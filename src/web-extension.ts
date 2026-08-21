import * as vscode from "vscode";
import { WebConfigReader } from "./web-config-reader";
import { WebAppTreeProvider } from "./web-tree-provider";
import { namespaceOf } from "./types";

// @group Configuration : Entry point for VS Code's browser (web worker) extension host — used
//                        only when there's no Node-capable backend at all (pure vscode.dev /
//                        github.dev). Codespaces, Remote-SSH, and WSL all have a real Node
//                        extension host and keep using ./extension.ts (see "main" in package.json).
//                        Apps can't be spawned here — child_process doesn't exist in a web worker —
//                        so this shows configured apps/profiles read-only and explains why.

const UNAVAILABLE_MESSAGE =
  "Overture: running apps needs a full VS Code backend — open this workspace in GitHub Codespaces, via Remote-SSH/WSL, or in desktop VS Code.";

const REAL_COMMANDS = new Set([
  "overture.refresh",
  "overture.selectNamespace",
  "overture.toggleShowDisabledApps",
  "overture.openConfig",
]);

// Every command id declared in package.json's contributes.commands — each must resolve to
// *something*, since VS Code lists them all in the Command Palette regardless of toolbar `when`
// clauses. Anything not in REAL_COMMANDS gets the shared "needs a backend" handler below.
const ALL_COMMANDS = [
  "overture.startAll",
  "overture.stopAll",
  "overture.restartAll",
  "overture.selectNamespace",
  "overture.refresh",
  "overture.openConfig",
  "overture.openSettings",
  "overture.createConfig",
  "overture.scanProjects",
  "overture.startApp",
  "overture.stopApp",
  "overture.restartApp",
  "overture.toggleEnable",
  "overture.showOutput",
  "overture.createProfile",
  "overture.startProfile",
  "overture.stopProfile",
  "overture.editProfile",
  "overture.toggleFavoriteProfile",
  "overture.deleteProfile",
  "overture.toggleArchive",
  "overture.revealInExplorer",
  "overture.toggleShowDisabledApps",
];

export function activate(context: vscode.ExtensionContext): void {
  vscode.commands.executeCommand("setContext", "overture.webUnavailable", true);
  vscode.commands.executeCommand("setContext", "overture.anyRunning", false);

  // Persisted per workspace, same key extension.ts uses, so a filter chosen on desktop is
  // still honored if the same workspace is later opened in the browser.
  const NAMESPACE_STATE_KEY = "overture.activeNamespace";
  let activeNamespace = context.workspaceState.get<string>(NAMESPACE_STATE_KEY);

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const reader = root ? new WebConfigReader(root) : undefined;
  const treeProvider = new WebAppTreeProvider(reader);
  treeProvider.setActiveNamespace(activeNamespace);

  const treeView = vscode.window.createTreeView("overtureView", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  // @group BusinessLogic : Re-read config.json and refresh the context keys the view's
  //                        viewsWelcome/menu `when` clauses depend on
  async function refresh(): Promise<void> {
    await treeProvider.reload();
    vscode.commands.executeCommand("setContext", "overture.noConfig", !treeProvider.hasConfig());
    vscode.commands.executeCommand(
      "setContext",
      "overture.noApps",
      treeProvider.hasConfig() && !treeProvider.hasApps()
    );
    const namespaces = treeProvider.getNamespaces();
    vscode.commands.executeCommand("setContext", "overture.hasNamespaces", namespaces.length > 1);
    // A filter pointing at a namespace that no longer exists would leave the sidebar blank
    // with no obvious cause — drop it instead.
    if (activeNamespace && !namespaces.includes(activeNamespace)) {
      activeNamespace = undefined;
      await context.workspaceState.update(NAMESPACE_STATE_KEY, undefined);
      treeProvider.setActiveNamespace(undefined);
    }
  }

  context.subscriptions.push(treeView, treeProvider);
  if (reader) {
    context.subscriptions.push(reader, reader.onDidChange(() => refresh()));
  }

  for (const command of ALL_COMMANDS) {
    if (REAL_COMMANDS.has(command)) { continue; }
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        vscode.window.showInformationMessage(UNAVAILABLE_MESSAGE);
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("overture.refresh", () => refresh()),

    vscode.commands.registerCommand("overture.openConfig", async () => {
      if (!reader) {
        vscode.window.showErrorMessage(
          "Overture: Open a workspace folder first (File → Open Folder)."
        );
        return;
      }
      try {
        await vscode.window.showTextDocument(reader.configUri);
      } catch {
        vscode.window.showWarningMessage(
          "No .overture/config.json found. Create one from Codespaces, Remote-SSH/WSL, or desktop VS Code."
        );
      }
    }),

    vscode.commands.registerCommand("overture.toggleShowDisabledApps", async () => {
      const cfg = vscode.workspace.getConfiguration("overture");
      const current = cfg.get<boolean>("showDisabledApps", true);
      await cfg.update("showDisabledApps", !current, vscode.ConfigurationTarget.Global);
    }),

    // @group BusinessLogic : Pick the namespace the sidebar is scoped to — mirrors
    //                        extension.ts's command, driven by the read-only config instead
    vscode.commands.registerCommand("overture.selectNamespace", async () => {
      const namespaces = treeProvider.getNamespaces();
      const apps = treeProvider.getApps();
      const countFor = (ns: string) => apps.filter((a) => namespaceOf(a) === ns).length;
      const describe = (count: number, current: boolean) =>
        `${count} app${count === 1 ? "" : "s"}${current ? " · current" : ""}`;

      const picked = await vscode.window.showQuickPick(
        [
          {
            label: "$(list-flat) All namespaces",
            description: describe(apps.length, !activeNamespace),
            namespace: undefined as string | undefined,
          },
          ...namespaces.map((ns) => ({
            label: `$(symbol-namespace) ${ns}`,
            description: describe(countFor(ns), ns === activeNamespace),
            namespace: ns as string | undefined,
          })),
        ],
        {
          title: "Overture: Filter Apps by Namespace",
          placeHolder: activeNamespace ?? "All namespaces",
        }
      );
      if (!picked) { return; }
      activeNamespace = picked.namespace;
      await context.workspaceState.update(NAMESPACE_STATE_KEY, activeNamespace);
      treeProvider.setActiveNamespace(activeNamespace);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("overture.showDisabledApps")) {
        treeProvider.render();
      }
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh())
  );

  refresh();
}

export function deactivate(): void {
  // Nothing to tear down — there's no child process or watcher owned outside context.subscriptions.
}
