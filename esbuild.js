"use strict";
// Bundles the browser (web worker) extension host entry point. The desktop/remote entry
// (./out/extension.js) stays plain tsc output — VS Code doesn't require it to be bundled, and
// leaving it untouched keeps that path's build and tests unchanged.
const esbuild = require("esbuild");

const production = process.argv.includes("--production");

esbuild
  .build({
    entryPoints: ["src/web-extension.ts"],
    bundle: true,
    outfile: "out/web/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "browser",
    target: "es2020",
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  })
  .catch(() => process.exit(1));
