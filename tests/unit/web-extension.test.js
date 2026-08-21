const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load the esbuild browser bundle without a real VS Code extension host.
// out/web/extension.js is still plain CJS with `vscode` left external (esbuild's `external`
// option doesn't touch it), so the same Module._load stub trick the other tests use against
// tsc's out/*.js works unmodified here. This is the primary automated gate for the web entry
// point: it can't verify a real browser host, but it does catch import-time and activation-time
// crashes fast, deterministically, with no network or Playwright dependency (see the plan's
// verification section for why @vscode/test-web is a manual/CI nice-to-have instead).

class FakeEventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      this._listeners.push(listener);
      return { dispose: () => { this._listeners = this._listeners.filter((l) => l !== listener); } };
    };
  }
  fire(value) { this._listeners.slice().forEach((l) => l(value)); }
  dispose() { this._listeners = []; }
}

class FakeTreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class FakeUri {
  constructor(fsPath) { this.path = fsPath; this.fsPath = fsPath; }
  toString() { return `file://${this.path}`; }
  static file(p) { return new FakeUri(p); }
  static joinPath(base, ...parts) {
    return new FakeUri([base.path, ...parts].join("/").replace(/\/+/g, "/"));
  }
}

function fakeWatcher() {
  return {
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  };
}

// path -> JSON string, simulating vscode.workspace.fs against a workspace's config.json
const fakeFiles = new Map();

const registeredCommands = new Map();
const contextValues = {};
const infoMessages = [];
const warnMessages = [];
const errorMessages = [];
let lastOpenedUri;
let nextQuickPick; // set per-test to control showQuickPick's return value

function resetFakes() {
  fakeFiles.clear();
  registeredCommands.clear();
  for (const key of Object.keys(contextValues)) { delete contextValues[key]; }
  infoMessages.length = 0;
  warnMessages.length = 0;
  errorMessages.length = 0;
  lastOpenedUri = undefined;
  nextQuickPick = undefined;
}

const vscodeStub = {
  EventEmitter: FakeEventEmitter,
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor(value) { this.value = value; } },
  TreeItem: FakeTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  ConfigurationTarget: { Global: 1 },
  Uri: FakeUri,
  workspace: {
    workspaceFolders: undefined,
    fs: {
      async stat(uri) {
        if (!fakeFiles.has(uri.path)) { const e = new Error("FileNotFound"); e.code = "FileNotFound"; throw e; }
        return { type: 1, ctime: 0, mtime: 0, size: fakeFiles.get(uri.path).length };
      },
      async readFile(uri) {
        if (!fakeFiles.has(uri.path)) { throw new Error("FileNotFound"); }
        return Buffer.from(fakeFiles.get(uri.path), "utf8");
      },
    },
    createFileSystemWatcher: () => fakeWatcher(),
    getConfiguration: () => ({
      get: (_key, def) => def,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  },
  window: {
    createTreeView: (_id, options) => ({ ...options, dispose() {} }),
    showTextDocument: async (uri) => {
      lastOpenedUri = uri;
      const p = typeof uri === "string" ? uri : uri.path;
      if (!fakeFiles.has(p)) { throw new Error("FileNotFound"); }
    },
    showInformationMessage: async (msg) => { infoMessages.push(msg); },
    showWarningMessage: async (msg) => { warnMessages.push(msg); },
    showErrorMessage: async (msg) => { errorMessages.push(msg); },
    showQuickPick: async () => nextQuickPick,
  },
  commands: {
    registerCommand: (id, handler) => { registeredCommands.set(id, handler); return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      if (id === "setContext") { contextValues[args[0]] = args[1]; return; }
      const handler = registeredCommands.get(id);
      return handler ? handler(...args) : undefined;
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") { return vscodeStub; }
  return originalLoad.call(this, request, parent, isMain);
};

const webExtension = require(path.join(__dirname, "..", "..", "out", "web", "extension"));

Module._load = originalLoad;

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}

function fakeContext() {
  const store = new Map();
  return {
    subscriptions: [],
    workspaceState: {
      get: (key) => store.get(key),
      update: async (key, value) => { store.set(key, value); },
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) { await Promise.resolve(); }
}

(async () => {
  // @group UnitTests : activate() / deactivate() with no workspace open
  await test("activate does not throw and registers every declared command with no workspace open", async () => {
    resetFakes();
    vscodeStub.workspace.workspaceFolders = undefined;
    const context = fakeContext();

    webExtension.activate(context);
    await flush();

    assert.ok(context.subscriptions.length > 0);
    assert.equal(contextValues["overture.webUnavailable"], true);
    assert.equal(contextValues["overture.anyRunning"], false);
    assert.equal(contextValues["overture.noConfig"], true);
    assert.ok(registeredCommands.has("overture.startApp"));
    assert.ok(registeredCommands.has("overture.openConfig"));

    assert.doesNotThrow(() => webExtension.deactivate());
  });

  await test("an unavailable command (e.g. startApp) shows the backend-required message instead of throwing", async () => {
    resetFakes();
    vscodeStub.workspace.workspaceFolders = undefined;
    webExtension.activate(fakeContext());
    await flush();

    await vscodeStub.commands.executeCommand("overture.startApp");
    assert.equal(infoMessages.length, 1);
    assert.match(infoMessages[0], /needs a full VS Code backend/);
  });

  await test("openConfig with no workspace shows an error instead of throwing", async () => {
    resetFakes();
    vscodeStub.workspace.workspaceFolders = undefined;
    webExtension.activate(fakeContext());
    await flush();

    await vscodeStub.commands.executeCommand("overture.openConfig");
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /Open a workspace folder first/);
  });

  // @group UnitTests : activate() with a workspace and a real config.json
  await test("a workspace with configured apps and namespaces populates context keys and the tree", async () => {
    resetFakes();
    const root = new FakeUri("/workspace");
    vscodeStub.workspace.workspaceFolders = [{ uri: root }];
    fakeFiles.set("/workspace/.overture/config.json", JSON.stringify({
      retentionDays: 7,
      profiles: { fullstack: { apps: ["web", "api"], favorite: true } },
      apps: [
        { name: "web", path: "./web", command: "npm run dev", enabled: true },
        { name: "api", path: "./api", command: "npm start", enabled: false, namespace: "backend" },
      ],
    }));

    const context = fakeContext();
    webExtension.activate(context);
    await flush();

    assert.equal(contextValues["overture.noConfig"], false);
    assert.equal(contextValues["overture.noApps"], false);
    assert.equal(contextValues["overture.hasNamespaces"], true);

    const treeView = context.subscriptions.find((s) => "treeDataProvider" in s);
    assert.ok(treeView, "expected createTreeView's registration to be captured");
    const provider = treeView.treeDataProvider;

    const roots = provider.getChildren();
    assert.deepEqual(roots.map((r) => r.label), ["PROFILES", "APPS"]);

    const appSection = roots.find((r) => r.label === "APPS");
    const appItems = provider.getChildren(appSection);
    assert.deepEqual(appItems.map((i) => i.appName).sort(), ["api", "web"]);
    const webItem = appItems.find((i) => i.appName === "web");
    const apiItem = appItems.find((i) => i.appName === "api");
    assert.match(webItem.description, /not running \(web\)/);
    assert.match(apiItem.description, /disabled/);
    assert.match(apiItem.description, /backend/);

    const profileSection = roots.find((r) => r.label === "PROFILES");
    const profileItems = provider.getChildren(profileSection);
    assert.equal(profileItems.length, 1);
    assert.equal(profileItems[0].profileName, "fullstack");
    assert.equal(profileItems[0].contextValue, "profile-web-unavailable");
    assert.equal(webItem.contextValue, "app-web-unavailable");
  });

  await test("openConfig opens the workspace's real config.json", async () => {
    resetFakes();
    const root = new FakeUri("/workspace");
    vscodeStub.workspace.workspaceFolders = [{ uri: root }];
    fakeFiles.set("/workspace/.overture/config.json", JSON.stringify({ apps: [] }));

    webExtension.activate(fakeContext());
    await flush();

    await vscodeStub.commands.executeCommand("overture.openConfig");
    assert.equal(lastOpenedUri.path, "/workspace/.overture/config.json");
  });

  await test("selectNamespace filters the tree to the chosen namespace", async () => {
    resetFakes();
    const root = new FakeUri("/workspace");
    vscodeStub.workspace.workspaceFolders = [{ uri: root }];
    fakeFiles.set("/workspace/.overture/config.json", JSON.stringify({
      apps: [
        { name: "web", path: "./web", command: "npm run dev", enabled: true },
        { name: "api", path: "./api", command: "npm start", enabled: true, namespace: "backend" },
      ],
    }));

    const context = fakeContext();
    webExtension.activate(context);
    await flush();

    const treeView = context.subscriptions.find((s) => "treeDataProvider" in s);
    const provider = treeView.treeDataProvider;

    nextQuickPick = { label: "$(symbol-namespace) backend", namespace: "backend" };
    await vscodeStub.commands.executeCommand("overture.selectNamespace");

    const appSection = provider.getChildren().find((r) => r.label === "APPS");
    const appItems = provider.getChildren(appSection);
    assert.deepEqual(appItems.map((i) => i.appName), ["api"]);
  });

  console.log("\nAll web-extension.test.js checks passed");
})();
