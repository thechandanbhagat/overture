import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// @group Types : Shape of a discovered package script
export type PackageRunner = "npm" | "yarn";

export interface DiscoveredScript {
  packageName: string;
  scriptName: string;
  command: string;
  relativePath: string;   // relative to workspace root, forward-slashes
  absolutePath: string;   // absolute path to the folder containing package.json
  isPrimary: boolean;     // dev / start / serve / preview get pre-selected
}

// @group Constants : Script names that represent runnable dev servers
export const PRIMARY_SCRIPTS = new Set([
  "dev",
  "start",
  "serve",
  "preview",
  "develop",
]);

// @group BusinessLogic : Recursively find package.json files and extract their package scripts
export class ProjectScanner {
  constructor(private readonly workspaceRoot: string) {}

  // @group BusinessLogic : Scan workspace for Node.js projects and return all their scripts
  async scan(): Promise<DiscoveredScript[]> {
    // Use only node_modules in the exclude glob — VS Code handles it reliably.
    // Everything else (out/, dist/, build/) is filtered below in code.
    const packageFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.workspaceRoot, "**/package.json"),
      "**/node_modules/**"
    );

    const SKIP_DIRS = new Set(["out", "dist", "build", ".git", ".vscode-test"]);

    const results: DiscoveredScript[] = [];

    for (const uri of packageFiles) {
      // Skip any path segment that is a known output/tool directory
      const segments = uri.fsPath.replace(/\\/g, "/").split("/");
      if (segments.some((seg) => SKIP_DIRS.has(seg))) {
        continue;
      }

      try {
        const raw = fs.readFileSync(uri.fsPath, "utf8");
        const pkg = JSON.parse(raw) as {
          name?: string;
          scripts?: Record<string, string>;
          packageManager?: string;
        };

        const scripts = pkg.scripts;
        if (!scripts || Object.keys(scripts).length === 0) {
          continue;
        }

        const folderPath = path.dirname(uri.fsPath);
        const packageRunner = detectPackageRunner(folderPath, pkg);
        const rel = path.relative(this.workspaceRoot, folderPath);
        const relativePath = rel === "" ? "." : rel.replace(/\\/g, "/");
        const packageName =
          pkg.name?.replace(/^@[^/]+\//, "") ?? // strip scope
          path.basename(folderPath);

        for (const [scriptName] of Object.entries(scripts)) {
          results.push({
            packageName,
            scriptName,
            command: buildScriptCommand(scriptName, packageRunner),
            relativePath,
            absolutePath: folderPath,
            isPrimary: PRIMARY_SCRIPTS.has(scriptName),
          });
        }
      } catch {
        // Skip malformed or unreadable package.json
      }
    }

    // Sort: primary scripts first, then by path, then by script name
    results.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) {
        return a.isPrimary ? -1 : 1;
      }
      const byPath = a.relativePath.localeCompare(b.relativePath);
      if (byPath !== 0) {
        return byPath;
      }
      return a.scriptName.localeCompare(b.scriptName);
    });

    return results;
  }
}

// @group BusinessLogic : Choose the package runner for a project without modifying project files
export function detectPackageRunner(
  folderPath: string,
  pkg: { packageManager?: string } = {}
): PackageRunner {
  const packageManager = pkg.packageManager?.trim().toLowerCase();
  if (packageManager?.startsWith("yarn@") || packageManager === "yarn") {
    return "yarn";
  }
  if (packageManager?.startsWith("npm@") || packageManager === "npm") {
    return "npm";
  }
  if (packageManager) {
    return "npm";
  }
  return fs.existsSync(path.join(folderPath, "yarn.lock")) ? "yarn" : "npm";
}

// @group BusinessLogic : Build the command Overture stores for discovered package scripts
export function buildScriptCommand(scriptName: string, packageRunner: PackageRunner): string {
  return packageRunner === "yarn"
    ? `yarn ${scriptName}`
    : `npm run ${scriptName}`;
}

// @group Utilities : Generate a stable, unique-enough app name from a discovered script
export function generateAppName(script: DiscoveredScript): string {
  const folderName =
    script.relativePath === "."
      ? script.packageName
      : path.basename(script.relativePath);

  const base = PRIMARY_SCRIPTS.has(script.scriptName)
    ? folderName
    : `${folderName}-${script.scriptName}`;

  return base.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}
