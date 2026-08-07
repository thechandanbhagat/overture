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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Overture Settings</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 0 20px 40px;
  }
  h2 { margin-top: 28px; margin-bottom: 8px; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 8px;
    padding: 12px 0; background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .toolbar .spacer { flex: 1; }
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
  button.icon { padding: 3px 8px; }
  input[type="text"], input[type="number"] {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px; padding: 4px 6px; font-family: inherit; font-size: inherit;
  }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th { text-align: left; font-weight: 600; padding: 4px 6px; font-size: 0.9em; opacity: 0.8; }
  td { padding: 4px 6px; vertical-align: middle; }
  td input[type="text"] { width: 100%; box-sizing: border-box; }
  .profile-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px; padding: 12px; margin-top: 10px;
  }
  .profile-card .row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .profile-card .row input[type="text"] { flex: 1; }
  .app-checklist { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .app-checklist label { display: flex; align-items: center; gap: 4px; font-size: 0.95em; }
  .muted { opacity: 0.7; font-size: 0.9em; }
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
    <button id="saveBtn">Save</button>
    <button id="openConfigBtn" class="secondary">Open config.json</button>
    <span id="savedIndicator" class="muted"></span>
    <div class="spacer"></div>
  </div>

  <div id="staleBanner" class="banner">
    config.json changed on disk.
    <button id="reloadBtn" class="icon">Reload</button>
  </div>
  <div id="errorBanner" class="banner error"></div>

  <h2>General</h2>
  <label>Log retention (days): <input id="retentionDays" type="number" min="1" step="1" style="width:70px"></label>

  <h2>Apps</h2>
  <table id="appsTable">
    <thead>
      <tr><th>Name</th><th>Path</th><th>Command</th><th>Namespace</th><th>Enabled</th><th>Archived</th><th></th></tr>
    </thead>
    <tbody id="appsBody"></tbody>
  </table>
  <button id="addAppBtn" class="secondary">+ Add App</button>

  <h2>Profiles</h2>
  <div id="profilesContainer"></div>
  <button id="addProfileBtn" class="secondary">+ Add Profile</button>

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

  function render() {
    el("retentionDays").value = String(state.retentionDays);

    const body = el("appsBody");
    body.textContent = "";
    state.apps.forEach((app, i) => {
      const tr = document.createElement("tr");

      tr.appendChild(textCell(app.name, (v) => { app.name = v; markDirty(); }));
      tr.appendChild(textCell(app.path, (v) => { app.path = v; markDirty(); }));
      tr.appendChild(textCell(app.command, (v) => { app.command = v; markDirty(); }));
      tr.appendChild(textCell(app.namespace || "", (v) => { app.namespace = v; markDirty(); }, "default"));
      tr.appendChild(checkboxCell(app.enabled, (v) => { app.enabled = v; markDirty(); }));
      tr.appendChild(checkboxCell(app.archived, (v) => { app.archived = v; markDirty(); }));

      const removeTd = document.createElement("td");
      const removeBtn = document.createElement("button");
      removeBtn.className = "icon secondary";
      removeBtn.textContent = "✕";
      removeBtn.title = "Remove app";
      removeBtn.addEventListener("click", () => {
        state.apps.splice(i, 1);
        markDirty();
        render();
      });
      removeTd.appendChild(removeBtn);
      tr.appendChild(removeTd);

      body.appendChild(tr);
    });

    const profilesContainer = el("profilesContainer");
    profilesContainer.textContent = "";
    const allAppNames = state.apps.map((a) => a.name).filter(Boolean);

    Object.entries(state.profiles).forEach(([profileName, profile]) => {
      const card = document.createElement("div");
      card.className = "profile-card";

      const row = document.createElement("div");
      row.className = "row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = profileName;
      nameInput.addEventListener("change", () => {
        const newName = nameInput.value.trim();
        if (!newName || newName === profileName) { render(); return; }
        const reordered = {};
        for (const [k, v] of Object.entries(state.profiles)) {
          reordered[k === profileName ? newName : k] = v;
        }
        state.profiles = reordered;
        markDirty();
        render();
      });
      row.appendChild(nameInput);

      const favLabel = document.createElement("label");
      const favCheckbox = document.createElement("input");
      favCheckbox.type = "checkbox";
      favCheckbox.checked = !!profile.favorite;
      favCheckbox.addEventListener("change", () => {
        profile.favorite = favCheckbox.checked;
        markDirty();
      });
      favLabel.appendChild(favCheckbox);
      favLabel.appendChild(document.createTextNode(" Favorite"));
      row.appendChild(favLabel);

      const removeBtn = document.createElement("button");
      removeBtn.className = "icon secondary";
      removeBtn.textContent = "✕";
      removeBtn.title = "Delete profile";
      removeBtn.addEventListener("click", () => {
        delete state.profiles[profileName];
        markDirty();
        render();
      });
      row.appendChild(removeBtn);

      card.appendChild(row);

      const checklist = document.createElement("div");
      checklist.className = "app-checklist";
      if (allAppNames.length === 0) {
        const none = document.createElement("span");
        none.className = "muted";
        none.textContent = "No apps defined yet.";
        checklist.appendChild(none);
      }
      allAppNames.forEach((appName) => {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = profile.apps.includes(appName);
        cb.addEventListener("change", () => {
          if (cb.checked) {
            if (!profile.apps.includes(appName)) { profile.apps.push(appName); }
          } else {
            profile.apps = profile.apps.filter((n) => n !== appName);
          }
          markDirty();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + appName));
        checklist.appendChild(label);
      });
      card.appendChild(checklist);

      profilesContainer.appendChild(card);
    });
  }

  function textCell(value, onChange, placeholder) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    if (placeholder) { input.placeholder = placeholder; }
    input.addEventListener("input", () => onChange(input.value));
    td.appendChild(input);
    return td;
  }

  function checkboxCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.addEventListener("change", () => onChange(input.checked));
    td.appendChild(input);
    return td;
  }

  el("retentionDays").addEventListener("input", () => {
    state.retentionDays = Number(el("retentionDays").value);
    markDirty();
  });

  el("addAppBtn").addEventListener("click", () => {
    state.apps.push({ name: "", path: "./", command: "npm run dev", namespace: "", enabled: true, archived: false });
    markDirty();
    render();
  });

  el("addProfileBtn").addEventListener("click", () => {
    let base = "new-profile";
    let name = base;
    let n = 1;
    while (state.profiles[name]) { name = base + "-" + (++n); }
    state.profiles[name] = { apps: [], favorite: false };
    markDirty();
    render();
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
