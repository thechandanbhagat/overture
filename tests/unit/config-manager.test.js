const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load compiled config-manager without a VS Code extension host.
// ConfigManager's constructor wires up a file watcher immediately, so the stub needs working
// EventEmitter/RelativePattern/createFileSystemWatcher shapes — not just an empty object.
// The watcher itself is never triggered here: reacting to external file edits needs the real
// extension host, so that's left to manual/integration testing. These tests drive the same
// load/save/mutate methods the watcher would otherwise call into.
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

class FakeRelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

function fakeWatcher() {
  return {
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  };
}

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {
      EventEmitter: FakeEventEmitter,
      RelativePattern: FakeRelativePattern,
      workspace: { createFileSystemWatcher: () => fakeWatcher() },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ConfigManager } = require(path.join(__dirname, "..", "..", "out", "config-manager"));

Module._load = originalLoad;

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "overture-config-manager-"));
}

function writeFixture(manager, config) {
  fs.mkdirSync(path.dirname(manager.configPath), { recursive: true });
  fs.writeFileSync(manager.configPath, JSON.stringify(config));
}

function readRaw(manager) {
  return JSON.parse(fs.readFileSync(manager.configPath, "utf8"));
}

const baseApp = (over) => ({ name: "a", path: "./a", command: "npm run dev", enabled: true, ...over });

(async () => {
  // @group UnitTests : load — defaults, coercion, and namespace normalization
  await test("load throws when config.json doesn't exist", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      await assert.rejects(() => manager.load(), /Config not found/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("load fills in defaults for missing fields", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      writeFixture(manager, { apps: [{ name: "x" }] });
      const config = await manager.load();

      assert.equal(config.retentionDays, 7);
      assert.deepEqual(config.profiles, {});
      const app = config.apps[0];
      assert.equal(app.path, ".");
      assert.equal(app.command, "npm run dev");
      assert.equal(app.enabled, true);
      assert.equal(app.archived, false);
      assert.ok(!("namespace" in app));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("load respects explicit enabled: false / archived: true and drops a blank namespace", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      writeFixture(manager, { apps: [{ name: "y", enabled: false, archived: true, namespace: "   " }] });
      const config = await manager.load();
      const app = config.apps[0];
      assert.equal(app.enabled, false);
      assert.equal(app.archived, true);
      assert.ok(!("namespace" in app));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("load trims and keeps a non-default namespace", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      writeFixture(manager, { apps: [{ name: "z", namespace: " media " }] });
      const config = await manager.load();
      assert.equal(config.apps[0].namespace, "media");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("load migrates legacy string-array profiles into ProfileConfig objects", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      writeFixture(manager, {
        apps: [],
        profiles: {
          web: ["api", "ui"],
          infra: { apps: ["db"], favorite: true },
        },
      });
      const config = await manager.load();
      assert.deepEqual(config.profiles.web, { apps: ["api", "ui"] });
      assert.deepEqual(config.profiles.infra, { apps: ["db"], favorite: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : exists / createDefault
  await test("exists reflects whether config.json is present", () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      assert.equal(manager.exists(), false);
      manager.createDefault();
      assert.equal(manager.exists(), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("createDefault writes a blank config with a 7-day retention default", () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      manager.createDefault();
      assert.deepEqual(readRaw(manager), { retentionDays: 7, profiles: {}, apps: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : addApps
  await test("addApps creates config.json on first use when none exists", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      await manager.addApps([baseApp({ name: "solo" })]);
      assert.equal(manager.exists(), true);
      assert.equal(readRaw(manager).apps.length, 1);
      assert.equal(readRaw(manager).apps[0].name, "solo");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("addApps skips apps whose name already exists, keeping the original", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      await manager.addApps([baseApp({ name: "a", path: "./orig" })]);
      await manager.addApps([baseApp({ name: "a", path: "./new" }), baseApp({ name: "b" })]);

      const apps = readRaw(manager).apps;
      assert.equal(apps.length, 2);
      assert.equal(apps.find((a) => a.name === "a").path, "./orig");
      assert.ok(apps.some((a) => a.name === "b"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : toggleEnable / toggleArchive
  await test("toggleEnable flips the enabled flag and is a no-op for an unknown app", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      await manager.addApps([baseApp({ name: "a", enabled: true })]);

      await manager.toggleEnable("a");
      assert.equal(readRaw(manager).apps[0].enabled, false);

      await manager.toggleEnable("a");
      assert.equal(readRaw(manager).apps[0].enabled, true);

      await assert.doesNotReject(() => manager.toggleEnable("does-not-exist"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("toggleArchive force-disables the app when archiving, but doesn't restore enabled on unarchive", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      await manager.addApps([baseApp({ name: "a", enabled: true })]);

      manager.toggleArchive("a");
      let app = readRaw(manager).apps[0];
      assert.equal(app.archived, true);
      assert.equal(app.enabled, false, "archiving must force the app off");

      manager.toggleArchive("a");
      app = readRaw(manager).apps[0];
      assert.equal(app.archived, false);
      assert.equal(app.enabled, false, "unarchiving does not restore the previous enabled state");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : profile management
  await test("createProfile creates a profile and preserves favorite when overwritten", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      manager.createDefault();
      await manager.load(); // createDefault only writes disk — load() hydrates _config
      manager.createProfile("web", ["a", "b"]);
      assert.deepEqual(readRaw(manager).profiles.web, { apps: ["a", "b"], favorite: false });

      manager.toggleFavoriteProfile("web");
      manager.createProfile("web", ["a", "b", "c"]);
      assert.deepEqual(readRaw(manager).profiles.web, { apps: ["a", "b", "c"], favorite: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("editProfile renames a profile, preserving its favorite flag", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      manager.createDefault();
      await manager.load();
      manager.createProfile("old", ["a"]);
      manager.toggleFavoriteProfile("old");

      manager.editProfile("old", "new", ["a", "b"]);
      const profiles = readRaw(manager).profiles;
      assert.ok(!("old" in profiles));
      assert.deepEqual(profiles.new, { apps: ["a", "b"], favorite: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("editProfile with matching old/new name just updates the app list in place", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      manager.createDefault();
      await manager.load();
      manager.createProfile("web", ["a"]);
      manager.editProfile("web", "web", ["a", "b"]);
      assert.deepEqual(readRaw(manager).profiles.web.apps, ["a", "b"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("toggleFavoriteProfile is a no-op for an unknown profile, even before any config exists", () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root); // _config is still unset — nothing loaded or created
      assert.doesNotThrow(() => manager.toggleFavoriteProfile("nope"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("deleteProfile removes a profile, and no-ops before any config exists", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      assert.doesNotThrow(() => manager.deleteProfile("nope")); // no _config yet

      manager.createDefault();
      await manager.load();
      manager.createProfile("web", ["a"]);
      manager.deleteProfile("web");
      assert.deepEqual(readRaw(manager).profiles, {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : replaceConfig
  await test("replaceConfig overwrites the whole config and recreates a deleted .overture directory", () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      manager.createDefault();
      fs.rmSync(path.join(root, ".overture"), { recursive: true, force: true });
      assert.equal(manager.exists(), false);

      manager.replaceConfig({ retentionDays: 3, profiles: {}, apps: [baseApp({ name: "solo" })] });

      assert.equal(manager.exists(), true);
      const raw = readRaw(manager);
      assert.equal(raw.retentionDays, 3);
      assert.equal(raw.apps.length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : getProfiles reads from the in-memory cache populated by load()
  await test("getProfiles returns {} before load and the cached profiles afterward", async () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      assert.deepEqual(manager.getProfiles(), {});

      writeFixture(manager, { apps: [], profiles: { p: { apps: ["a"] } } });
      await manager.load();
      assert.deepEqual(manager.getProfiles(), { p: { apps: ["a"] } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group EdgeCases : dispose
  await test("dispose does not throw", () => {
    const root = tmpWorkspace();
    try {
      const manager = new ConfigManager(root);
      assert.doesNotThrow(() => manager.dispose());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
})();
