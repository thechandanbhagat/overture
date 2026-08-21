const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load compiled git-decoration-provider without a VS Code extension host.
// Needs just enough of the vscode namespace for Uri.from, ThemeColor, and EventEmitter to work,
// since AppGitDecorationProvider constructs real instances of these at runtime.
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

class FakeThemeColor {
  constructor(id) { this.id = id; }
}

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {
      EventEmitter: FakeEventEmitter,
      ThemeColor: FakeThemeColor,
      Uri: {
        from: ({ scheme, path: p }) => ({ scheme, path: p, toString: () => `${scheme}:${p}` }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { AppGitDecorationProvider, appResourceUri, changeSummary } = require(
  path.join(__dirname, "..", "..", "out", "git-decoration-provider")
);

Module._load = originalLoad;

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}

const cleanStatus = { staged: 0, modified: 0, untracked: 0, conflicted: 0 };

// @group TestHelpers : Minimal stand-in for AppRunner — only the members the provider touches
function fakeRunner(overrides = {}) {
  const listeners = [];
  return {
    _fireStateChange: () => listeners.slice().forEach((l) => l()),
    onDidChangeState: (listener) => {
      listeners.push(listener);
      return { dispose() {} };
    },
    getAllStates: () => [],
    getGitStatusFor: () => undefined,
    ...overrides,
  };
}

(async () => {
  // @group UnitTests : changeSummary — pure formatting, no vscode dependency
  test("changeSummary lists only non-zero categories in conflicted/staged/modified/untracked order", () => {
    assert.equal(
      changeSummary({ conflicted: 1, staged: 2, modified: 0, untracked: 3 }),
      "1 conflicted, 2 staged, 3 untracked"
    );
  });

  test("changeSummary returns an empty string for a clean status", () => {
    assert.equal(changeSummary(cleanStatus), "");
  });

  // @group UnitTests : appResourceUri
  test("appResourceUri scopes app rows to Overture's private scheme", () => {
    const uri = appResourceUri("web");
    assert.equal(uri.scheme, "overture-app");
  });

  test("appResourceUri percent-encodes the app name and round-trips through decodeURIComponent", () => {
    const uri = appResourceUri("my app / v2");
    assert.equal(decodeURIComponent(uri.path.slice(1)), "my app / v2");
  });

  // @group UnitTests : provideFileDecoration
  test("provideFileDecoration ignores uris outside Overture's scheme", () => {
    const provider = new AppGitDecorationProvider(fakeRunner());
    const decoration = provider.provideFileDecoration({ scheme: "file", path: "/some/file.ts" });
    assert.equal(decoration, undefined);
  });

  test("provideFileDecoration returns undefined when the runner has no status for the app", () => {
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => undefined }));
    const decoration = provider.provideFileDecoration(appResourceUri("unknown-app"));
    assert.equal(decoration, undefined);
  });

  test("provideFileDecoration returns undefined for a fully clean status", () => {
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => cleanStatus }));
    const decoration = provider.provideFileDecoration(appResourceUri("web"));
    assert.equal(decoration, undefined);
  });

  // @group UnitTests : color precedence mirrors the file explorer's own precedence
  test("provideFileDecoration prefers the conflicting color even when other changes exist", () => {
    const status = { staged: 1, modified: 1, untracked: 1, conflicted: 1 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    const decoration = provider.provideFileDecoration(appResourceUri("web"));
    assert.equal(decoration.color.id, "gitDecoration.conflictingResourceForeground");
  });

  test("provideFileDecoration prefers the modified color over untracked when there's no conflict", () => {
    const status = { staged: 1, modified: 0, untracked: 1, conflicted: 0 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    const decoration = provider.provideFileDecoration(appResourceUri("web"));
    assert.equal(decoration.color.id, "gitDecoration.modifiedResourceForeground");
  });

  test("provideFileDecoration falls back to the untracked color when nothing else has changed", () => {
    const status = { staged: 0, modified: 0, untracked: 2, conflicted: 0 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    const decoration = provider.provideFileDecoration(appResourceUri("web"));
    assert.equal(decoration.color.id, "gitDecoration.untrackedResourceForeground");
  });

  // @group EdgeCases : badge is capped at two characters
  test("provideFileDecoration reports the exact change count when 9 or fewer", () => {
    const status = { staged: 4, modified: 0, untracked: 0, conflicted: 0 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    assert.equal(provider.provideFileDecoration(appResourceUri("web")).badge, "4");
  });

  test("provideFileDecoration caps the badge at 9+ for larger totals", () => {
    const status = { staged: 20, modified: 0, untracked: 0, conflicted: 0 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    assert.equal(provider.provideFileDecoration(appResourceUri("web")).badge, "9+");
  });

  test("provideFileDecoration's tooltip matches changeSummary for the same status", () => {
    const status = { staged: 1, modified: 2, untracked: 0, conflicted: 0 };
    const provider = new AppGitDecorationProvider(fakeRunner({ getGitStatusFor: () => status }));
    assert.equal(provider.provideFileDecoration(appResourceUri("web")).tooltip, changeSummary(status));
  });

  // @group UnitTests : wiring between AppRunner state changes and decoration refreshes
  test("a runner state change fires onDidChangeFileDecorations with a uri per app", () => {
    const runner = fakeRunner({
      getAllStates: () => [{ config: { name: "web" } }, { config: { name: "api" } }],
    });
    const provider = new AppGitDecorationProvider(runner);

    let fired;
    provider.onDidChangeFileDecorations((uris) => { fired = uris; });
    runner._fireStateChange();

    assert.equal(fired.length, 2);
    assert.deepEqual(fired.map((u) => u.path), [appResourceUri("web").path, appResourceUri("api").path]);
  });

  test("dispose releases both the state subscription and the decoration emitter", () => {
    let stateSubDisposeCalls = 0;
    const runnerListeners = [];
    const runner = {
      onDidChangeState: (listener) => {
        runnerListeners.push(listener);
        return { dispose: () => { stateSubDisposeCalls++; } };
      },
      getAllStates: () => [],
      getGitStatusFor: () => undefined,
    };
    const provider = new AppGitDecorationProvider(runner);

    let notified = false;
    provider.onDidChangeFileDecorations(() => { notified = true; });

    provider.dispose();
    assert.equal(stateSubDisposeCalls, 1, "expected the runner subscription to be disposed exactly once");

    // Even if the runner's own unsubscription is imperfect, the decoration emitter itself must
    // be dead — listeners registered before dispose should never fire again.
    runnerListeners.forEach((l) => l());
    assert.equal(notified, false, "a disposed decoration emitter must not notify listeners registered before dispose");
  });
})();
