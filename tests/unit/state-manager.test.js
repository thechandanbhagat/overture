const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const child_process = require("node:child_process");

// @group TestSetup : StateManager has no vscode import, so it can be required directly
const { StateManager } = require(path.join(__dirname, "..", "..", "out", "state-manager"));

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "overture-state-manager-"));
}

// A pid this large cannot correspond to a real process — process.kill(pid, 0) reliably
// throws ESRCH (not EPERM) for it, which is what isAlive treats as "dead".
const DEAD_PID = 999999999;

async function waitUntil(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) { throw new Error("timed out waiting for condition"); }
    await new Promise((r) => setTimeout(r, 25));
  }
}

(async () => {
  // @group UnitTests : save / getAll / remove
  await test("save writes a record readable back via getAll", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      state.save("app-a", 12345, "npm run dev");
      const all = state.getAll();
      assert.equal(all["app-a"].pid, 12345);
      assert.equal(all["app-a"].command, "npm run dev");
      assert.equal(typeof all["app-a"].startedAt, "string");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("save overwrites the previous entry for the same app name", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      state.save("app-a", 111, "cmd-one");
      state.save("app-a", 222, "cmd-two");
      const all = state.getAll();
      assert.equal(Object.keys(all).length, 1);
      assert.equal(all["app-a"].pid, 222);
      assert.equal(all["app-a"].command, "cmd-two");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("remove deletes only the named entry", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      state.save("app-a", 1, "a");
      state.save("app-b", 2, "b");
      state.remove("app-a");
      const all = state.getAll();
      assert.deepEqual(Object.keys(all), ["app-b"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("remove is a no-op for an app with no saved entry", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      state.save("app-a", 1, "a");
      assert.doesNotThrow(() => state.remove("does-not-exist"));
      assert.deepEqual(Object.keys(state.getAll()), ["app-a"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("getAll returns an empty object when no state file exists yet", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      assert.deepEqual(state.getAll(), {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : isAlive
  await test("isAlive returns true for the current process", () => {
    assert.equal(StateManager.isAlive(process.pid), true);
  });

  await test("isAlive returns false for a pid that cannot exist", () => {
    assert.equal(StateManager.isAlive(DEAD_PID), false);
  });

  // @group UnitTests : pruneAndGetAlive
  await test("pruneAndGetAlive drops dead entries from disk and returns only the alive ones", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      state.save("alive-app", process.pid, "cmd");
      state.save("dead-app", DEAD_PID, "cmd");

      const alive = state.pruneAndGetAlive();
      assert.deepEqual(Object.keys(alive), ["alive-app"]);

      // The dead entry must also be gone from disk, not just from the returned map.
      const onDisk = state.getAll();
      assert.deepEqual(Object.keys(onDisk), ["alive-app"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("pruneAndGetAlive returns an empty object when the state file doesn't exist", () => {
    const root = tmpWorkspace();
    try {
      const state = new StateManager(root);
      assert.deepEqual(state.pruneAndGetAlive(), {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : killPid against a real, disposable child process
  await test("killPid terminates a real process tree", async () => {
    const child = child_process.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      await waitUntil(() => StateManager.isAlive(child.pid));
      StateManager.killPid(child.pid);
      await waitUntil(() => !StateManager.isAlive(child.pid));
    } finally {
      if (StateManager.isAlive(child.pid)) { child.kill(); } // safety net if the assertion failed
    }
  });

  await test("killPid does not throw for a pid that is already gone", () => {
    assert.doesNotThrow(() => StateManager.killPid(DEAD_PID));
  });
})();
