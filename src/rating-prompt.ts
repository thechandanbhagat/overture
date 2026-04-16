import * as vscode from "vscode";

// @group Constants : Rating prompt configuration
const KEY_START_COUNT = "conductor.startCount";
const KEY_NEXT_ASK    = "conductor.nextAskDate";
const KEY_DONE        = "conductor.ratingDone";
const PROMPT_AFTER    = 5;                  // show after this many app starts
const COOLDOWN_DAYS   = 7;                  // "Not now" cooldown in days

// Update this once the extension is published to the marketplace
const MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=thechandanbhagat.conductor";

// @group BusinessLogic : Show a rating prompt after the user has started enough apps
export class RatingPrompt {
  constructor(private readonly context: vscode.ExtensionContext) {}

  // @group BusinessLogic : Call each time a new app process starts
  async onAppStarted(): Promise<void> {
    // Skip if user already rated or opted out
    if (this.context.globalState.get<boolean>(KEY_DONE)) {
      return;
    }

    // Skip if inside "Not now" cooldown window
    const nextAsk = this.context.globalState.get<number>(KEY_NEXT_ASK);
    if (nextAsk && Date.now() < nextAsk) {
      return;
    }

    // Increment lifetime start count
    const count = (this.context.globalState.get<number>(KEY_START_COUNT) ?? 0) + 1;
    await this.context.globalState.update(KEY_START_COUNT, count);

    if (count < PROMPT_AFTER) {
      return;
    }

    // Reset counter so the next cycle starts fresh
    await this.context.globalState.update(KEY_START_COUNT, 0);

    const choice = await vscode.window.showInformationMessage(
      "Enjoying Conductor? A quick rating helps others discover it.",
      "⭐  Rate on Marketplace",
      "Not now",
      "Don't ask again"
    );

    if (choice === "⭐  Rate on Marketplace") {
      vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL));
      await this.context.globalState.update(KEY_DONE, true);
    } else if (choice === "Don't ask again") {
      await this.context.globalState.update(KEY_DONE, true);
    } else if (choice === "Not now") {
      const resume = Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      await this.context.globalState.update(KEY_NEXT_ASK, resume);
    }
    // Dismissed (clicked X) → do nothing, will ask again next cycle
  }
}
