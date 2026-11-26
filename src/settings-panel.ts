import * as vscode from "vscode";
import { ConfigManager } from "./config-manager";
import { RunMultipleAppsConfig } from "./types";
import { validateSettingsConfig } from "./config-validator";

// @group Utilities : Random nonce for the webview's Content-Security-Policy script-src
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// @group BusinessLogic : Singleton settings webview — a form-based alternative to hand-editing config.json
export class SettingsPanel implements vscode.Disposable {
  private static current: SettingsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  // @group BusinessLogic : Reveal the existing panel, or create a new one
  static createOrShow(configManager: ConfigManager, onSaved: () => void): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "overtureSettings",
      "Overture Settings",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    SettingsPanel.current = new SettingsPanel(panel, configManager, onSaved);
  }

  // @group BusinessLogic : Push a freshly-loaded config into the panel, if one is open
  static refreshIfOpen(config: RunMultipleAppsConfig): void {
    SettingsPanel.current?.postConfig(config);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly configManager: ConfigManager,
    private readonly onSaved: () => void
  ) {
    this.panel = panel;
    this.panel.webview.html = this._html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message: { type: string; payload?: unknown }) => {
        if (message.type === "ready") {
          const config = this.configManager.exists()
            ? await this.configManager.load()
            : { retentionDays: 7, profiles: {}, apps: [] };
          this.postConfig(config);
          return;
        }
        if (message.type === "save") {
          const { config, errors } = validateSettingsConfig(
            message.payload as Parameters<typeof validateSettingsConfig>[0]
          );
          this.configManager.replaceConfig(config);
          this.onSaved();
          this.panel.webview.postMessage({ type: "saved", errors, config });
          return;
        }
        if (message.type === "openConfig") {
          vscode.commands.executeCommand("overture.openConfig");
        }
      },
      null,
      this.disposables
    );
  }

  private postConfig(config: RunMultipleAppsConfig): void {
    this.panel.webview.postMessage({ type: "config", config });
  }

  dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }

  // @group BusinessLogic : Inline HTML/CSS/JS for the settings form — no bundler, so it lives as one template
  private _html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Overture Settings</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    --line: var(--vscode-panel-border, color-mix(in srgb, var(--vscode-foreground) 18%, transparent));
    max-width: 1120px; margin: 0 auto; padding: 0 20px 32px;
    background: var(--vscode-editor-background);
  }
  h1 { font-size: 16px; margin: 0 auto 0 0; }
  h2 { font-size: 14px; margin: 0; }
  h3 { margin: 0 0 6px; font-size: inherit; font-weight: 600; color: var(--vscode-descriptionForeground); }
  section { margin-top: 20px; }
  .section-heading, .retention {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .retention { justify-content: flex-start; }
  #retentionDays { width: 68px; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 10px 0; background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--line);
  }
  button {
    font-family: inherit; font-size: inherit;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; padding: 5px 12px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.icon { padding: 0; width: 26px; height: 26px; flex: none; background: transparent; color: inherit; }
  button.icon:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
  button:disabled { opacity: 0.45; cursor: default; }
  :focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  input[type="text"], input[type="number"] {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px; padding: 4px 6px; font: inherit; box-sizing: border-box;
  }
  .table-scroll { margin-top: 8px; overflow-x: auto; border-block: 1px solid var(--line); }
  table { width: 100%; min-width: 610px; border-collapse: collapse; table-layout: fixed; }
  .name-col { width: 18%; }
  .path-col { width: 25%; }
  .namespace-col { width: 15%; }
  .flag-col { width: 76px; }
  .remove-col { width: 38px; }
  th, td { padding: 5px 6px; text-align: left; }
  th { height: 24px; font-weight: 600; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); }
  tbody tr { border-top: 1px solid var(--line); }
  tbody tr:hover, tbody tr:focus-within { background: var(--vscode-list-hoverBackground); }
  td input[type="text"] { width: 100%; min-width: 0; }
  td:nth-child(n+5), th:nth-child(n+5) { text-align: center; }
  .choice { position: relative; display: inline-flex; max-width: 100%; vertical-align: middle; cursor: pointer; }
  .choice input {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; overflow: hidden;
    clip-path: inset(50%);
  }
  .choice span {
    min-width: 0; padding: 3px 5px; border: 1px solid transparent; border-radius: 3px;
    color: var(--vscode-descriptionForeground); overflow-wrap: anywhere;
  }
  .choice:hover span { background: var(--vscode-toolbar-hoverBackground); }
  .choice input:checked + span {
    border-color: var(--vscode-inputOption-activeBorder, transparent);
    background: var(--vscode-inputOption-activeBackground, var(--vscode-button-background));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-button-foreground));
  }
  .choice input:focus-visible + span { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  @media (forced-colors: active) {
    .choice input:checked + span { forced-color-adjust: none; border-color: Highlight; background: Highlight; color: HighlightText; }
    .choice input:focus-visible + span { outline-color: Highlight; }
  }
  .profile { display: grid; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  #profilesContainer { margin-top: 8px; border-top: 1px solid var(--line); }
  .profile-members { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  .app-checklist { display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .profile-heading input[type="text"] { flex: 0 1 20rem; min-width: 0; }
  .actions, .member-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .actions .icon { margin-left: auto; }
  .member-row span { flex: 1 1 6em; min-width: 0; overflow-wrap: anywhere; }
  .launch-order { margin: 0; padding-inline-start: 22px; }
  .launch-order li { padding-inline-start: 3px; }
  .launch-order li + li { border-top: 1px solid var(--line); }
  .muted { color: var(--vscode-descriptionForeground); }
  .empty { margin: 0; padding: 8px 6px; }
  [hidden] { display: none !important; }
  @media (max-width: 600px) {
    body { padding-inline: 12px; }
    .profile-members { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  }
  .banner {
    display: none; padding: 8px 12px; border-radius: 4px; margin: 10px 0;
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
  }
  .banner.show { display: block; }
  .banner.error {
    background: var(--vscode-inputValidation-errorBackground);
    border-color: var(--vscode-inputValidation-errorBorder);
  }
  .banner ul { margin: 4px 0 0; padding-left: 18px; }
</style>
</head>
<body>
  <div class="toolbar">
    <h1>Overture Settings</h1>
    <span id="savedIndicator" class="muted" role="status"></span>
    <button id="openConfigBtn" class="secondary">Open config.json</button>
    <button id="saveBtn">Save</button>
  </div>

  <div id="staleBanner" class="banner">
    config.json changed on disk.
    <button id="reloadBtn" class="secondary">Reload</button>
  </div>
  <div id="errorBanner" class="banner error"></div>

  <main>
    <section><label class="retention">Log retention (days) <input id="retentionDays" type="number" min="1" step="1"></label></section>
    <section aria-labelledby="appsHeading">
      <div class="section-heading"><h2 id="appsHeading">Apps</h2><button id="addAppBtn" class="secondary">+ Add App</button></div>
      <div class="table-scroll" role="region" aria-label="App settings table" tabindex="0">
        <table aria-labelledby="appsHeading">
          <colgroup><col class="name-col"><col class="path-col"><col><col class="namespace-col"><col class="flag-col" span="2"><col class="remove-col"></colgroup>
          <thead><tr><th scope="col">Name</th><th scope="col">Path</th><th scope="col">Command</th><th scope="col">Namespace</th><th scope="col">Enabled</th><th scope="col">Archived</th><th scope="col" aria-label="Actions"></th></tr></thead>
          <tbody id="appsBody"></tbody>
        </table>
      </div>
    </section>
    <section aria-labelledby="profilesHeading">
      <div class="section-heading"><h2 id="profilesHeading">Profiles</h2><button id="addProfileBtn" class="secondary">+ Add Profile</button></div>
      <div id="profilesContainer"></div>
    </section>
  </main>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{retentionDays:number, apps:Array<{name:string,path:string,command:string,namespace?:string,enabled:boolean,archived:boolean}>, profiles:Record<string,{apps:string[],favorite:boolean}>}} */
  let state = { retentionDays: 7, apps: [], profiles: {} };
  let dirty = false;

  const el = (id) => document.getElementById(id);

  function markDirty() {
    dirty = true;
    el("savedIndicator").textContent = "";
  }

  function render(focusEntry) {
    el("retentionDays").value = String(state.retentionDays);
    const refreshChecklists = [];

    const body = el("appsBody");
    body.textContent = "";
    if (!state.apps.length) {
      const row = document.createElement("tr");
      const cell = tableCell(empty("No apps"));
      cell.colSpan = 7;
      row.appendChild(cell);
      body.appendChild(row);
    }
    state.apps.forEach((app, index) => {
      const row = document.createElement("tr");
      const name = textField("Name", app.name, (value) => {
        app.name = value;
        refreshChecklists.forEach((refresh) => refresh());
        markDirty();
      });
      const remove = iconButton("\u00d7", "Remove app", () => {
        state.apps.splice(index, 1);
        markDirty();
        render();
        el("addAppBtn").focus();
      });
      const cells = [
        name,
        textField("Path", app.path, (value) => { app.path = value; markDirty(); }),
        textField("Command", app.command, (value) => { app.command = value; markDirty(); }),
        textField("Namespace", app.namespace || "", (value) => { app.namespace = value; markDirty(); }, "default"),
        checkbox("Enabled", app.enabled, (value) => { app.enabled = value; markDirty(); }),
        checkbox("Archived", app.archived, (value) => { app.archived = value; markDirty(); }),
        remove,
      ];
      row.append(...cells.map(tableCell));
      body.appendChild(row);
      if (focusEntry === app) { name.focus(); }
    });

    const profilesContainer = el("profilesContainer");
    profilesContainer.textContent = "";
    if (!Object.keys(state.profiles).length) { profilesContainer.appendChild(empty("No profiles")); }

    Object.entries(state.profiles).forEach(([profileName, profile]) => {
      let currentName = profileName;
      const item = document.createElement("div");
      item.className = "profile";
      const launchOrder = document.createElement("ol");
      launchOrder.className = "launch-order";
      launchOrder.setAttribute("aria-label", "Launch order");
      const name = textField("Profile name", currentName, (value) => {
        const nextName = value.trim();
        if (!nextName || (nextName !== currentName && Object.hasOwn(state.profiles, nextName))) {
          name.value = currentName;
          return;
        }
        if (nextName === currentName) { return; }
        state.profiles = Object.fromEntries(Object.entries(state.profiles).map(([key, value]) =>
          [key === currentName ? nextName : key, value]
        ));
        currentName = nextName;
        name.value = currentName;
        markDirty();
      }, "", "change");
      const actions = document.createElement("div");
      actions.className = "actions profile-heading";
      actions.appendChild(name);
      actions.appendChild(checkbox("Favorite", profile.favorite, (value) => { profile.favorite = value; markDirty(); }));
      actions.appendChild(iconButton("\u00d7", "Delete profile", () => {
        delete state.profiles[currentName];
        markDirty();
        render();
        el("addProfileBtn").focus();
      }));

      const checklist = document.createElement("div");
      checklist.className = "app-checklist";

      function refreshChecklist() {
        const names = new Set([...state.apps.map((app) => app.name).filter(Boolean), ...profile.apps]);
        checklist.textContent = "";
        if (!names.size) { checklist.appendChild(empty("No apps")); }
        names.forEach((appName) => {
          checklist.appendChild(checkbox(appName, profile.apps.includes(appName), (checked) => {
            if (checked) { profile.apps.push(appName); }
            else { profile.apps = profile.apps.filter((name) => name !== appName); }
            markDirty();
            renderMembers();
          }));
        });
      }
      refreshChecklists.push(refreshChecklist);

      function renderMembers(focusIndex, focusButton) {
        launchOrder.textContent = "";
        launchOrder.hidden = !profile.apps.length;
        orderEmpty.hidden = !!profile.apps.length;
        profile.apps.forEach((appName, index) => {
          const li = document.createElement("li");
          const row = document.createElement("div");
          row.className = "member-row";
          const label = document.createElement("span");
          label.textContent = appName;
          row.appendChild(label);
          const buttons = [-1, 1].map((offset) => {
            const target = index + offset;
            const up = offset < 0;
            const button = iconButton(up ? "\u2191" : "\u2193", "Move " + appName + (up ? " up" : " down"), () => {
              [profile.apps[index], profile.apps[target]] = [profile.apps[target], profile.apps[index]];
              markDirty();
              renderMembers(target, up ? 0 : 1);
            });
            button.disabled = target < 0 || target >= profile.apps.length;
            return button;
          });
          row.append(...buttons);
          li.appendChild(row);
          launchOrder.appendChild(li);
          if (index === focusIndex) {
            const preferred = buttons[focusButton];
            (preferred.disabled ? buttons.find((button) => !button.disabled) : preferred)?.focus();
          }
        });
      }

      const orderEmpty = empty("No apps selected");
      const members = document.createElement("div");
      members.className = "profile-members";
      members.append(labeledGroup("Apps", checklist), labeledGroup("Launch order", launchOrder, orderEmpty));
      item.append(actions, members);
      profilesContainer.appendChild(item);
      refreshChecklist();
      renderMembers();
      if (focusEntry === profile) { name.focus(); name.select(); }
    });
  }

  function labeledGroup(title, ...children) {
    const group = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    group.append(heading, ...children);
    return group;
  }

  function tableCell(content) {
    const cell = document.createElement("td");
    cell.appendChild(content);
    return cell;
  }

  function empty(text) {
    const message = document.createElement("p");
    message.className = "empty muted";
    message.textContent = text;
    return message;
  }

  function iconButton(icon, title, action) {
    const button = document.createElement("button");
    button.className = "icon";
    button.textContent = icon;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", action);
    return button;
  }

  function textField(text, value, onChange, placeholder, eventName = "input") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.setAttribute("aria-label", text);
    if (placeholder) { input.placeholder = placeholder; }
    input.addEventListener(eventName, () => onChange(input.value));
    return input;
  }

  function checkbox(text, value, onChange) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.addEventListener("change", () => onChange(input.checked));
    const caption = document.createElement("span");
    caption.textContent = text;
    label.append(input, caption);
    return label;
  }

  el("retentionDays").addEventListener("input", () => {
    state.retentionDays = Number(el("retentionDays").value);
    markDirty();
  });

  el("addAppBtn").addEventListener("click", () => {
    const app = { name: "", path: "./", command: "npm run dev", namespace: "", enabled: true, archived: false };
    state.apps.push(app);
    markDirty();
    render(app);
  });

  el("addProfileBtn").addEventListener("click", () => {
    let base = "new-profile";
    let name = base;
    let n = 1;
    while (state.profiles[name]) { name = base + "-" + (++n); }
    const profile = { apps: [], favorite: false };
    state.profiles[name] = profile;
    markDirty();
    render(profile);
  });

  el("saveBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "save", payload: state });
  });

  el("openConfigBtn").addEventListener("click", () => {
    vscode.postMessage({ type: "openConfig" });
  });

  el("reloadBtn").addEventListener("click", () => {
    el("staleBanner").classList.remove("show");
    dirty = false;
    // The next "config" push already arrived and was buffered; ask again just in case.
    vscode.postMessage({ type: "ready" });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "config") {
      if (dirty) {
        el("staleBanner").classList.add("show");
        return;
      }
      state = message.config;
      render();
    } else if (message.type === "saved") {
      dirty = false;
      el("staleBanner").classList.remove("show");
      const errorBanner = el("errorBanner");
      if (message.errors && message.errors.length > 0) {
        errorBanner.textContent = "";
        const intro = document.createElement("div");
        intro.textContent = "Saved with warnings:";
        errorBanner.appendChild(intro);
        const list = document.createElement("ul");
        message.errors.forEach((e) => {
          const li = document.createElement("li");
          li.textContent = e;
          list.appendChild(li);
        });
        errorBanner.appendChild(list);
        errorBanner.classList.add("show");
      } else {
        errorBanner.classList.remove("show");
      }
      state = message.config;
      render();
      el("savedIndicator").textContent = "Saved ✓";
    }
  });

  vscode.postMessage({ type: "ready" });
})();
</script>
</body>
</html>`;
  }
}
