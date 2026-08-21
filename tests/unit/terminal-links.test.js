const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// @group TestSetup : Load compiled terminal-links without a VS Code extension host.
// AppTerminalLinkProvider only touches vscode.commands.executeCommand at runtime (everything
// else it uses from the vscode namespace is type-only and erased at compile time), so the
// stub just needs to record calls to that one function.
const executedCommands = [];
const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {
      commands: {
        executeCommand: (command, arg) => { executedCommands.push({ command, arg }); },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { AppTerminalLinkProvider, RESTART_LINK, STOP_LINK } = require(
  path.join(__dirname, "..", "..", "out", "terminal-links")
);

Module._load = originalLoad;

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}

function contextFor(line, appName) {
  return { terminal: { appName }, line };
}

(async () => {
  // @group UnitTests : terminals Overture doesn't own are left alone
  test("provideTerminalLinks returns no links for a terminal that isn't one of Overture's", () => {
    const provider = new AppTerminalLinkProvider(() => undefined);
    const links = provider.provideTerminalLinks(contextFor(`some line with ${RESTART_LINK}`));
    assert.deepEqual(links, []);
  });

  // @group UnitTests : token detection and offsets
  test("provideTerminalLinks finds the restart token with the correct offset", () => {
    const provider = new AppTerminalLinkProvider(() => "web");
    const line = `prefix ${RESTART_LINK} suffix`;
    const links = provider.provideTerminalLinks(contextFor(line));
    assert.equal(links.length, 1);
    assert.equal(links[0].startIndex, line.indexOf(RESTART_LINK));
    assert.equal(links[0].length, RESTART_LINK.length);
    assert.equal(links[0].command, "overture.restartApp");
    assert.equal(links[0].appName, "web");
    assert.equal(links[0].tooltip, "Restart web");
  });

  test("provideTerminalLinks finds the stop token with the correct offset", () => {
    const provider = new AppTerminalLinkProvider(() => "web");
    const line = `${STOP_LINK} trailing text`;
    const links = provider.provideTerminalLinks(contextFor(line));
    assert.equal(links.length, 1);
    assert.equal(links[0].startIndex, 0);
    assert.equal(links[0].length, STOP_LINK.length);
    assert.equal(links[0].command, "overture.stopApp");
    assert.equal(links[0].tooltip, "Stop web");
  });

  test("provideTerminalLinks finds both tokens on the same line, each at its own offset", () => {
    const provider = new AppTerminalLinkProvider(() => "web");
    const line = `${RESTART_LINK}  ${STOP_LINK}`;
    const links = provider.provideTerminalLinks(contextFor(line));
    assert.equal(links.length, 2);
    assert.equal(links[0].command, "overture.restartApp");
    assert.equal(links[0].startIndex, line.indexOf(RESTART_LINK));
    assert.equal(links[1].command, "overture.stopApp");
    assert.equal(links[1].startIndex, line.indexOf(STOP_LINK));
  });

  test("provideTerminalLinks returns no links for an Overture terminal's ordinary output", () => {
    const provider = new AppTerminalLinkProvider(() => "web");
    const links = provider.provideTerminalLinks(contextFor("Compiled successfully in 240ms"));
    assert.deepEqual(links, []);
  });

  // @group UnitTests : clicking a link dispatches the mapped command
  test("handleTerminalLink executes the link's command with its app name", () => {
    executedCommands.length = 0;
    const provider = new AppTerminalLinkProvider(() => "web");
    const [restartLink] = provider.provideTerminalLinks(contextFor(RESTART_LINK));
    provider.handleTerminalLink(restartLink);

    assert.equal(executedCommands.length, 1);
    assert.equal(executedCommands[0].command, "overture.restartApp");
    assert.deepEqual(executedCommands[0].arg, { appName: "web" });
  });

  test("handleTerminalLink maps the stop token to overture.stopApp", () => {
    executedCommands.length = 0;
    const provider = new AppTerminalLinkProvider(() => "api");
    const [stopLink] = provider.provideTerminalLinks(contextFor(STOP_LINK, "api"));
    provider.handleTerminalLink(stopLink);

    assert.equal(executedCommands[0].command, "overture.stopApp");
    assert.deepEqual(executedCommands[0].arg, { appName: "api" });
  });
})();
