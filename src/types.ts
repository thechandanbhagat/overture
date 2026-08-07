// @group Types : Shared interfaces and type definitions

export interface AppConfig {
  name: string;
  path: string;
  command: string;
  enabled: boolean;
  archived?: boolean;
  namespace?: string; // omitted means DEFAULT_NAMESPACE — never written to config.json for default apps
}

// @group Constants : Namespace every app belongs to unless it names another one
export const DEFAULT_NAMESPACE = "default";

// @group Utilities : Resolve an app's namespace, falling back to the default
export function namespaceOf(app: AppConfig): string {
  return app.namespace?.trim() || DEFAULT_NAMESPACE;
}

// @group Utilities : Distinct namespaces across apps — "default" first, then alphabetical
export function collectNamespaces(apps: AppConfig[]): string[] {
  const names = [...new Set(apps.map(namespaceOf))];
  return names.sort((a, b) =>
    a === DEFAULT_NAMESPACE ? -1 : b === DEFAULT_NAMESPACE ? 1 : a.localeCompare(b)
  );
}

export interface ProfileConfig {
  apps: string[];
  favorite?: boolean;
}

export interface RunMultipleAppsConfig {
  retentionDays: number;
  profiles: Record<string, ProfileConfig>;
  apps: AppConfig[];
}

export type AppStatus = "running" | "stopped" | "disabled" | "error" | "archived";

// @group Types : Working-tree change counts for an app's git repository
export interface GitStatus {
  branch?: string;
  staged: number;     // index changes (added / modified / renamed / deleted, staged)
  modified: number;   // tracked worktree changes not yet staged
  untracked: number;
  conflicted: number; // unmerged paths
}

export interface AppState {
  config: AppConfig;
  status: AppStatus;
  pid?: number;
  resumed?: boolean; // true when process was detected from a previous session
  gitBranch?: string;
  gitStatus?: GitStatus;
}
