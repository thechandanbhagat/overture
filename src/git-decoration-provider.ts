import * as vscode from "vscode";
import { AppRunner } from "./app-runner";
import { GitStatus } from "./types";

// @group Constants : Private URI scheme for app rows. Decoration providers are global — using a
//                    scheme of our own keeps Overture's badges off real files, so nothing leaks
//                    into the workspace file explorer or open editor tabs.
const APP_SCHEME = "overture-app";

// @group Utilities : Stable decoration URI for an app row
export function appResourceUri(appName: string): vscode.Uri {
  return vscode.Uri.from({ scheme: APP_SCHEME, path: `/${encodeURIComponent(appName)}` });
}

// @group Utilities : Human-readable summary of a repo's pending changes — empty when clean
export function changeSummary(status: GitStatus): string {
  const parts: string[] = [];
  if (status.conflicted) { parts.push(`${status.conflicted} conflicted`); }
  if (status.staged)     { parts.push(`${status.staged} staged`); }
  if (status.modified)   { parts.push(`${status.modified} modified`); }
  if (status.untracked)  { parts.push(`${status.untracked} untracked`); }
  return parts.join(", ");
}

// @group BusinessLogic : Colors app rows with the same theme colors the file explorer uses for git
//                        state, plus a badge counting the app's pending changes.
export class AppGitDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private readonly _stateSubscription: vscode.Disposable;

  constructor(private readonly runner: AppRunner) {
    this._stateSubscription = runner.onDidChangeState(() => {
      this._onDidChangeFileDecorations.fire(
        runner.getAllStates().map((s) => appResourceUri(s.config.name))
      );
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== APP_SCHEME) { return undefined; }

    const status = this.runner.getGitStatusFor(decodeURIComponent(uri.path.slice(1)));
    if (!status) { return undefined; }

    const changed = status.conflicted + status.staged + status.modified + status.untracked;
    if (changed === 0) { return undefined; }

    // Mirrors the explorer's precedence: a conflict outranks a tracked edit, which outranks
    // an untracked-only folder.
    const color =
      status.conflicted > 0                  ? "gitDecoration.conflictingResourceForeground" :
      status.staged + status.modified > 0    ? "gitDecoration.modifiedResourceForeground" :
                                               "gitDecoration.untrackedResourceForeground";

    return {
      badge: changed > 9 ? "9+" : String(changed), // badges are capped at 2 characters
      color: new vscode.ThemeColor(color),
      tooltip: changeSummary(status),
    };
  }

  dispose(): void {
    this._stateSubscription.dispose();
    this._onDidChangeFileDecorations.dispose();
  }
}
