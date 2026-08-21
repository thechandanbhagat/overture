"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const unitDir = path.join(__dirname, "unit");
const files = fs.readdirSync(unitDir).filter((f) => f.endsWith(".test.js")).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n--- ${file} ---`);
  const result = spawnSync(process.execPath, [path.join(unitDir, file)], { stdio: "inherit" });
  if (result.status !== 0) {
    failed++;
    console.error(`FAILED: ${file}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} test files passed`);
if (failed > 0) { process.exit(1); }
