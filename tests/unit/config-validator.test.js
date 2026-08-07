const assert = require("node:assert/strict");
const path = require("node:path");

const { validateSettingsConfig } = require(path.join(__dirname, "..", "..", "out", "config-validator"));

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}

// @group UnitTests : Retention days sanitization
test("validateSettingsConfig floors valid retentionDays", () => {
  const { config, errors } = validateSettingsConfig({ retentionDays: 3.7, apps: [], profiles: {} });
  assert.equal(config.retentionDays, 3);
  assert.equal(errors.length, 0);
});

test("validateSettingsConfig defaults invalid retentionDays to 7 with an error", () => {
  const { config, errors } = validateSettingsConfig({ retentionDays: -1, apps: [], profiles: {} });
  assert.equal(config.retentionDays, 7);
  assert.equal(errors.length, 1);
});

// @group UnitTests : App sanitization
test("validateSettingsConfig keeps well-formed apps", () => {
  const { config, errors } = validateSettingsConfig({
    retentionDays: 7,
    apps: [{ name: "web", path: "./web", command: "npm run dev", enabled: true, archived: false }],
    profiles: {},
  });
  assert.equal(config.apps.length, 1);
  assert.deepEqual(config.apps[0], { name: "web", path: "./web", command: "npm run dev", enabled: true, archived: false });
  assert.equal(errors.length, 0);
});

test("validateSettingsConfig skips apps missing required fields", () => {
  const { config, errors } = validateSettingsConfig({
    retentionDays: 7,
    apps: [{ name: "", path: "./web", command: "npm run dev", enabled: true, archived: false }],
    profiles: {},
  });
  assert.equal(config.apps.length, 0);
  assert.equal(errors.length, 1);
});

test("validateSettingsConfig skips duplicate app names", () => {
  const { config, errors } = validateSettingsConfig({
    retentionDays: 7,
    apps: [
      { name: "web", path: "./a", command: "npm run dev", enabled: true, archived: false },
      { name: "web", path: "./b", command: "npm run dev", enabled: true, archived: false },
    ],
    profiles: {},
  });
  assert.equal(config.apps.length, 1);
  assert.equal(config.apps[0].path, "./a");
  assert.equal(errors.length, 1);
});

// @group UnitTests : Profile sanitization
test("validateSettingsConfig drops profile membership referencing unknown apps", () => {
  const { config, errors } = validateSettingsConfig({
    retentionDays: 7,
    apps: [{ name: "web", path: "./web", command: "npm run dev", enabled: true, archived: false }],
    profiles: { fullstack: { apps: ["web", "ghost"], favorite: true } },
  });
  assert.deepEqual(config.profiles.fullstack.apps, ["web"]);
  assert.equal(config.profiles.fullstack.favorite, true);
  assert.equal(errors.length, 0);
});

test("validateSettingsConfig skips duplicate profile names after trimming", () => {
  const { config, errors } = validateSettingsConfig({
    retentionDays: 7,
    apps: [],
    profiles: { "fullstack ": { apps: [], favorite: false }, fullstack: { apps: [], favorite: true } },
  });
  assert.equal(Object.keys(config.profiles).length, 1);
  assert.equal(errors.length, 1);
});
