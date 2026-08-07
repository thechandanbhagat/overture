import * as vscode from "vscode";

// @group Constants : Clickable tokens printed into an app's terminal. Distinctive glyphs keep an
//                    app's own output from accidentally rendering as an Overture action.
export const RESTART_LINK = "[⟳ restart]";
export const STOP_LINK = "[■ stop]";

interface AppTerminalLink extends vscode.TerminalLink {
  appName: string;
  command: string;
}

const ACTIONS: Array<{ token: string; command: string; verb: string }> = [
  { token: RESTART_LINK, command: "overture.restartApp", verb: "Restart" },
  { token: STOP_LINK, command: "overture.stopApp", verb: "Stop" },
];

// @group BusinessLogic : Turns the tokens in an app terminal's header into clickable actions.
//                        VS Code has no contribution point for terminal toolbar buttons, so an
//                        in-terminal link is the closest thing to a button we can offer.
export class AppTerminalLinkProvider implements vscode.TerminalLinkProvider<AppTerminalLink> {
  constructor(private readonly appNameFor: (terminal: vscode.Terminal) => string | undefined) {}

  provideTerminalLinks(context: vscode.TerminalLinkContext): AppTerminalLink[] {
    const appName = this.appNameFor(context.terminal);
    if (!appName) { return []; } // not one of ours — leave the line alone

    const links: AppTerminalLink[] = [];
    for (const { token, command, verb } of ACTIONS) {
      const startIndex = context.line.indexOf(token);
      if (startIndex !== -1) {
        links.push({
          startIndex,
          length: token.length,
          tooltip: `${verb} ${appName}`,
          appName,
          command,
        });
      }
    }
    return links;
  }

  handleTerminalLink(link: AppTerminalLink): void {
    vscode.commands.executeCommand(link.command, { appName: link.appName });
  }
}
