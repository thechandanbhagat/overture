const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load compiled app-runner helpers without a VS Code extension host
const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { getGitStatus, parseGitStatus } = require(path.join(__dirname, "..", "..", "out", "app-runner"));

Module._load = originalLoad;

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}

(async () => {
  // @group UnitTests : getGitStatus must never block the extension host
  //
  // Regression guard: the git lookup previously used execSync, which blocks the single-threaded
  // extension host for up to its 3s timeout on every app, on every config reload. It must
  // return a Promise (async execFile) so callers never freeze waiting on it.
  await test("getGitStatus returns a Promise instead of blocking synchronously", () => {
    const result = getGitStatus(process.cwd());
    assert.ok(result instanceof Promise, "expected getGitStatus to return a Promise");
  });

  await test("getGitStatus resolves branch and change counts for a real git repo", async () => {
    const status = await getGitStatus(path.join(__dirname, "..", ".."));
    assert.equal(typeof status.branch, "string");
    assert.ok(status.branch.length > 0);
    for (const key of ["staged", "modified", "untracked", "conflicted"]) {
      assert.equal(typeof status[key], "number", `expected numeric ${key}`);
    }
  });

  await test("getGitStatus resolves undefined for a directory that is not a git repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overture-app-runner-"));
    try {
      assert.equal(await getGitStatus(dir), undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test("getGitStatus resolves undefined instead of throwing for a nonexistent directory", async () => {
    const status = await getGitStatus(path.join(os.tmpdir(), "overture-does-not-exist-xyz"));
    assert.equal(status, undefined);
  });

  await test("concurrent getGitStatus calls run in parallel, not serially", async () => {
    const dirs = Array.from({ length: 8 }, () =>
      fs.mkdtempSync(path.join(os.tmpdir(), "overture-app-runner-concurrency-"))
    );
    try {
      const singleStart = Date.now();
      await getGitStatus(dirs[0]);
      const singleDuration = Math.max(Date.now() - singleStart, 1);

      const allStart = Date.now();
      await Promise.all(dirs.map((d) => getGitStatus(d)));
      const allDuration = Date.now() - allStart;

      // Serial execSync calls would take roughly N x singleDuration. Parallel execFile calls
      // should complete in well under that, close to a single call's duration.
      assert.ok(
        allDuration < singleDuration * dirs.length,
        `expected ${dirs.length} concurrent lookups (${allDuration}ms) to be faster than ${dirs.length} serial ones (~${singleDuration * dirs.length}ms)`
      );
    } finally {
      dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
    }
  });

  // @group UnitTests : porcelain v1 parsing — X is the index column, Y the worktree column
  await test("parseGitStatus reads the branch from the --branch header", () => {
    assert.equal(parseGitStatus("## main...origin/main [ahead 1]\n").branch, "main");
    assert.equal(parseGitStatus("## feat/opening-hours\n").branch, "feat/opening-hours");
    assert.equal(parseGitStatus("## No commits yet on main\n").branch, "main");
    assert.equal(parseGitStatus("## HEAD (no branch)\n").branch, undefined, "detached HEAD");
  });

  await test("parseGitStatus counts staged, unstaged, and untracked changes separately", () => {
    const status = parseGitStatus(
      [
        "## main",
        "M  src/staged.ts",
        " M src/modified.ts",
        "MM src/both.ts",
        "A  src/added.ts",
        " D src/deleted.ts",
        "R  src/old.ts -> src/new.ts",
        "?? notes.txt",
        "?? scratch/",
      ].join("\n")
    );
    assert.equal(status.staged, 4, "M , MM, A , R ");
    assert.equal(status.modified, 3, " M, MM,  D");
    assert.equal(status.untracked, 2);
    assert.equal(status.conflicted, 0);
  });

  await test("parseGitStatus classifies unmerged paths as conflicted, not modified", () => {
    const status = parseGitStatus(
      ["## main", "UU both-modified.ts", "AA both-added.ts", "DU deleted-by-us.ts"].join("\n")
    );
    assert.equal(status.conflicted, 3);
    assert.equal(status.staged, 0);
    assert.equal(status.modified, 0);
  });

  // @group EdgeCases : a clean repo must produce no decoration at all
  await test("parseGitStatus reports zero changes for a clean worktree", () => {
    const status = parseGitStatus("## main...origin/main\n");
    assert.deepEqual(
      { ...status, branch: undefined },
      { branch: undefined, staged: 0, modified: 0, untracked: 0, conflicted: 0 }
    );
  });

  await test("parseGitStatus ignores empty output and ignored entries", () => {
    assert.equal(parseGitStatus("").staged, 0);
    assert.equal(parseGitStatus("!! dist/\n").untracked, 0);
  });
})();
