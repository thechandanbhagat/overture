const assert = require("node:assert/strict");
const path = require("node:path");

const { namespaceOf, collectNamespaces, DEFAULT_NAMESPACE } = require(
  path.join(__dirname, "..", "..", "out", "types")
);
const { validateSettingsConfig } = require(path.join(__dirname, "..", "..", "out", "config-validator"));

function test(name, callback) {
  callback();
  console.log(`ok - ${name}`);
}

const app = (over) => ({ name: "a", path: "./a", command: "npm run dev", enabled: true, ...over });

// @group UnitTests : namespace resolution
test("namespaceOf falls back to the default namespace", () => {
  assert.equal(DEFAULT_NAMESPACE, "default");
  assert.equal(namespaceOf(app({})), "default");
  assert.equal(namespaceOf(app({ namespace: undefined })), "default");
  assert.equal(namespaceOf(app({ namespace: "" })), "default");
  assert.equal(namespaceOf(app({ namespace: "   " })), "default", "whitespace-only is not a namespace");
});

test("namespaceOf trims a configured namespace", () => {
  assert.equal(namespaceOf(app({ namespace: "  media  " })), "media");
});

// @group UnitTests : namespace ordering drives both the picker and the tree grouping
test("collectNamespaces lists default first, then alphabetical", () => {
  const namespaces = collectNamespaces([
    app({ namespace: "media" }),
    app({ namespace: "billing" }),
    app({}),
    app({ namespace: "auth" }),
  ]);
  assert.deepEqual(namespaces, ["default", "auth", "billing", "media"]);
});

test("collectNamespaces de-duplicates and treats blank as default", () => {
  const namespaces = collectNamespaces([
    app({ namespace: "media" }),
    app({ namespace: "media" }),
    app({ namespace: "" }),
  ]);
  assert.deepEqual(namespaces, ["default", "media"]);
});

test("collectNamespaces returns a single entry when nothing is namespaced", () => {
  // The tree skips its grouping level on a single namespace, so this is what keeps the
  // sidebar flat for anyone who never uses the feature.
  assert.deepEqual(collectNamespaces([app({}), app({})]), ["default"]);
});

test("collectNamespaces returns nothing for an empty app list", () => {
  assert.deepEqual(collectNamespaces([]), []);
});

// @group UnitTests : the settings panel round-trip must not litter config.json
test("validateSettingsConfig keeps a custom namespace", () => {
  const { config } = validateSettingsConfig({
    retentionDays: 7,
    apps: [{ name: "web", path: "./web", command: "npm run dev", namespace: " media ", enabled: true, archived: false }],
    profiles: {},
  });
  assert.equal(config.apps[0].namespace, "media");
});

test("validateSettingsConfig omits the namespace key for default apps", () => {
  const { config } = validateSettingsConfig({
    retentionDays: 7,
    apps: [
      { name: "blank", path: "./a", command: "c", namespace: "", enabled: true, archived: false },
      { name: "explicit", path: "./b", command: "c", namespace: "default", enabled: true, archived: false },
      { name: "absent", path: "./c", command: "c", enabled: true, archived: false },
    ],
    profiles: {},
  });
  for (const saved of config.apps) {
    assert.ok(
      !("namespace" in saved),
      `expected no namespace key on "${saved.name}", got ${JSON.stringify(saved)}`
    );
  }
});
