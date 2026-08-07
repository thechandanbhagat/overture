// @group Types : Shared interfaces and type definitions

export interface AppConfig {
  name: string;
  path: string;
  command: string;
  enabled: boolean;
  archived?: boolean;
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
