const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load compiled scanner helpers without a VS Code extension host
const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildScriptCommand,
  detectPackageRunner,
} = require(path.join(__dirname, "..", "..", "out", "project-scanner"));

Module._load = originalLoad;

// @group TestHelpers : Temporary project fixture utilities
function withProject(files, callback) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "overture-project-scanner-"));
  try {
    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(projectDir, fileName), content);
    }
    callback(projectDir);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}

// @group UnitTests : Package runner detection and command generation
test("detectPackageRunner uses yarn when packageManager names yarn", () => {
  withProject({}, (projectDir) => {
    assert.equal(
      detectPackageRunner(projectDir, { packageManager: "yarn@4.9.2" }),
      "yarn"
    );
  });
});

test("detectPackageRunner uses yarn when yarn.lock exists", () => {
  withProject({ "yarn.lock": "" }, (projectDir) => {
    assert.equal(detectPackageRunner(projectDir), "yarn");
  });
});

test("detectPackageRunner keeps explicit npm preference over yarn.lock", () => {
  withProject({ "yarn.lock": "" }, (projectDir) => {
    assert.equal(
      detectPackageRunner(projectDir, { packageManager: "npm@10.8.2" }),
      "npm"
    );
  });
});

test("detectPackageRunner keeps unsupported explicit package managers on npm fallback", () => {
  withProject({ "yarn.lock": "" }, (projectDir) => {
    assert.equal(
      detectPackageRunner(projectDir, { packageManager: "pnpm@10.12.1" }),
      "npm"
    );
  });
});

test("buildScriptCommand generates package runner commands", () => {
  assert.equal(buildScriptCommand("dev", "npm"), "npm run dev");
  assert.equal(buildScriptCommand("dev", "yarn"), "yarn dev");
});
