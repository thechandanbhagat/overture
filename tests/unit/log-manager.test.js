const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// @group TestSetup : LogManager has no vscode import, so it can be required directly
const { LogManager } = require(path.join(__dirname, "..", "..", "out", "log-manager"));

async function test(name, callback) {
  await callback();
  console.log(`ok - ${name}`);
}

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "overture-log-manager-"));
}

function todayStamp() {
  return new Date().toISOString().substring(0, 10);
}

(async () => {
  // @group UnitTests : opening a stream
  await test("openLogStream creates the logs dir and writes a session header", async () => {
    const root = tmpWorkspace();
    try {
      const logManager = new LogManager(root);
      const stream = logManager.openLogStream("myapp");
      stream.write("hello from the app\n");
      await new Promise((resolve) => stream.end(resolve));

      const logPath = path.join(root, ".overture", "logs", `myapp-${todayStamp()}.log`);
      assert.ok(fs.existsSync(logPath), "expected the log file to exist");
      const content = fs.readFileSync(logPath, "utf8");
      assert.match(content, /^\n=+\nSession: \d{4}-\d{2}-\d{2}T/, "expected a session header at the top of the file");
      assert.match(content, /hello from the app/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : getLogFilePath is a pure path calculation, no side effects
  await test("getLogFilePath returns today's dated path without creating anything", () => {
    const root = tmpWorkspace();
    try {
      const logManager = new LogManager(root);
      const logPath = logManager.getLogFilePath("app");
      assert.equal(logPath, path.join(root, ".overture", "logs", `app-${todayStamp()}.log`));
      assert.ok(!fs.existsSync(logPath), "getLogFilePath must not create the file or its directory");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : listLogFiles
  await test("listLogFiles returns only that app's dated logs, newest first", () => {
    const root = tmpWorkspace();
    try {
      const logsDir = path.join(root, ".overture", "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      const files = [
        "app-2026-01-01.log",
        "app-2026-01-05.log",
        "app-2026-01-03.log",
        "otherapp-2026-01-04.log", // different app — must be excluded
        "app-notes.txt", // wrong extension — must be excluded
        "app-2026-1-1.log", // not zero-padded — must be excluded
      ];
      for (const f of files) { fs.writeFileSync(path.join(logsDir, f), ""); }

      const logManager = new LogManager(root);
      const result = logManager.listLogFiles("app");
      assert.deepEqual(
        result,
        ["app-2026-01-05.log", "app-2026-01-03.log", "app-2026-01-01.log"].map((f) =>
          path.join(logsDir, f)
        )
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("listLogFiles escapes regex-special characters in the app name", () => {
    const root = tmpWorkspace();
    try {
      const logsDir = path.join(root, ".overture", "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      // Unescaped, "+" would be a regex quantifier and "." would match any character — a naive
      // pattern built from "app+1" would miss the real file and instead match this decoy.
      fs.writeFileSync(path.join(logsDir, "app+1-2026-01-01.log"), "");
      fs.writeFileSync(path.join(logsDir, "appppp1-2026-01-01.log"), "");

      const logManager = new LogManager(root);
      const result = logManager.listLogFiles("app+1");
      assert.deepEqual(result, [path.join(logsDir, "app+1-2026-01-01.log")]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("listLogFiles returns an empty array when the logs directory doesn't exist", () => {
    const root = tmpWorkspace();
    try {
      const logManager = new LogManager(root);
      assert.deepEqual(logManager.listLogFiles("anything"), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group UnitTests : retention cleanup
  await test("cleanOldLogs deletes only .log files older than the cutoff", () => {
    const root = tmpWorkspace();
    try {
      const logsDir = path.join(root, ".overture", "logs");
      fs.mkdirSync(logsDir, { recursive: true });

      const old = path.join(logsDir, "old.log");
      const recent = path.join(logsDir, "recent.log");
      const oldNote = path.join(logsDir, "notes.txt");
      fs.writeFileSync(old, "");
      fs.writeFileSync(recent, "");
      fs.writeFileSync(oldNote, "");

      const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const recentTime = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      fs.utimesSync(old, oldTime, oldTime);
      fs.utimesSync(oldNote, oldTime, oldTime);
      fs.utimesSync(recent, recentTime, recentTime);

      const logManager = new LogManager(root);
      logManager.cleanOldLogs(7);

      assert.ok(!fs.existsSync(old), "old.log should have been deleted");
      assert.ok(fs.existsSync(recent), "recent.log should have been kept");
      assert.ok(fs.existsSync(oldNote), "non-.log files should never be touched");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("cleanOldLogs creates the logs directory instead of throwing when it's missing", () => {
    const root = tmpWorkspace();
    try {
      const logManager = new LogManager(root);
      assert.doesNotThrow(() => logManager.cleanOldLogs(7));
      assert.ok(fs.existsSync(path.join(root, ".overture", "logs")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // @group EdgeCases : cleanOldLogs takes its retention window as an explicit argument
  await test("cleanOldLogs uses its own argument, not whatever setConfig last stored", () => {
    const root = tmpWorkspace();
    try {
      const logsDir = path.join(root, ".overture", "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      const old = path.join(logsDir, "old.log");
      fs.writeFileSync(old, "");
      const oldTime = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      fs.utimesSync(old, oldTime, oldTime);

      const logManager = new LogManager(root);
      logManager.setConfig({ retentionDays: 30, profiles: {}, apps: [] }); // would keep old.log
      logManager.cleanOldLogs(1); // explicit argument should win

      assert.ok(!fs.existsSync(old), "explicit cleanOldLogs argument should override setConfig");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
})();
