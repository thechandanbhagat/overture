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

export interface AppState {
  config: AppConfig;
  status: AppStatus;
  pid?: number;
  resumed?: boolean; // true when process was detected from a previous session
  gitBranch?: string;
}
