import { AppConfig, ProfileConfig, RunMultipleAppsConfig, DEFAULT_NAMESPACE } from "./types";

// @group Types : Loosely-typed shape posted up from the settings webview, before validation
export interface RawSettingsPayload {
  retentionDays: unknown;
  apps: Array<{
    name: unknown;
    path: unknown;
    command: unknown;
    enabled: unknown;
    archived: unknown;
    namespace?: unknown;
  }>;
  profiles: Record<string, { apps: unknown; favorite: unknown }>;
}

export interface ValidationResult {
  config: RunMultipleAppsConfig;
  errors: string[];
}

// @group Validation : Sanitize a settings-panel payload into a well-formed config,
//                     collecting human-readable errors for entries that had to be dropped or fixed
export function validateSettingsConfig(input: RawSettingsPayload): ValidationResult {
  const errors: string[] = [];

  let retentionDays = Number(input.retentionDays);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    errors.push("Retention days must be a positive number — defaulted to 7.");
    retentionDays = 7;
  } else {
    retentionDays = Math.floor(retentionDays);
  }

  const seenAppNames = new Set<string>();
  const apps: AppConfig[] = [];
  (input.apps ?? []).forEach((raw, i) => {
    const name = String(raw?.name ?? "").trim();
    const appPath = String(raw?.path ?? "").trim();
    const command = String(raw?.command ?? "").trim();

    if (!name || !appPath || !command) {
      errors.push(`App #${i + 1} is missing a name, path, or command — skipped.`);
      return;
    }
    if (seenAppNames.has(name)) {
      errors.push(`Duplicate app name "${name}" — skipped.`);
      return;
    }
    seenAppNames.add(name);
    // The default namespace is implicit — writing it out would stamp "namespace": "default"
    // across every app in config.json the first time anyone opens the settings panel.
    const namespace = String(raw?.namespace ?? "").trim();
    apps.push({
      name,
      path: appPath,
      command,
      enabled: Boolean(raw?.enabled),
      archived: Boolean(raw?.archived),
      ...(namespace && namespace !== DEFAULT_NAMESPACE ? { namespace } : {}),
    });
  });

  const validAppNames = new Set(apps.map((a) => a.name));
  const profiles: Record<string, ProfileConfig> = {};
  for (const [rawName, value] of Object.entries(input.profiles ?? {})) {
    const name = rawName.trim();
    if (!name) { continue; }
    if (profiles[name]) {
      errors.push(`Duplicate profile name "${name}" — skipped.`);
      continue;
    }
    const memberApps = (Array.isArray(value?.apps) ? value.apps : [])
      .map((n) => String(n))
      .filter((n) => validAppNames.has(n));
    profiles[name] = { apps: memberApps, favorite: Boolean(value?.favorite) };
  }

  return { config: { retentionDays, profiles, apps }, errors };
}
