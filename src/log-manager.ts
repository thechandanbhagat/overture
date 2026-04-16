import * as fs from "fs";
import * as path from "path";
import { RunMultipleAppsConfig } from "./types";

// @group LogManagement : Log file creation, rotation, and retention cleanup
export class LogManager {
  private _logsDir: string;
  private _retentionDays: number = 7;

  constructor(workspaceRoot: string) {
    this._logsDir = path.join(workspaceRoot, ".conductor", "logs");
  }

  // @group Configuration : Apply config settings to log manager
  setConfig(config: RunMultipleAppsConfig): void {
    this._retentionDays = config.retentionDays;
  }

  // @group LogManagement : Ensure the logs directory exists
  private ensureLogsDir(): void {
    if (!fs.existsSync(this._logsDir)) {
      fs.mkdirSync(this._logsDir, { recursive: true });
    }
  }

  // @group LogManagement : Delete log files older than retentionDays
  cleanOldLogs(retentionDays: number): void {
    this.ensureLogsDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    try {
      const files = fs.readdirSync(this._logsDir);
      for (const file of files) {
        if (!file.endsWith(".log")) {
          continue;
        }
        const filePath = path.join(this._logsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Non-fatal — log dir may be empty or inaccessible
    }
  }

  // @group LogManagement : Open an append-mode write stream for today's log file
  openLogStream(appName: string): fs.WriteStream {
    this.ensureLogsDir();
    const dateStamp = new Date().toISOString().substring(0, 10);
    const filePath = path.join(this._logsDir, `${appName}-${dateStamp}.log`);
    const stream = fs.createWriteStream(filePath, { flags: "a" });
    const sep = "=".repeat(60);
    stream.write(`\n${sep}\nSession: ${new Date().toISOString()}\n${sep}\n`);
    return stream;
  }

  // @group LogManagement : Get the path to today's log file for an app
  getLogFilePath(appName: string): string {
    const dateStamp = new Date().toISOString().substring(0, 10);
    return path.join(this._logsDir, `${appName}-${dateStamp}.log`);
  }
}
