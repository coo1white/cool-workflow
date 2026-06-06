import fs from "node:fs";
import path from "node:path";
import { Scheduler } from "./scheduler";
import { writeJson } from "./state";

export interface DaemonOptions {
  cwd?: string;
  intervalSeconds?: number;
  once?: boolean;
}

export interface DaemonTickResult {
  checkedAt: string;
  dueCount: number;
  dueIds: string[];
  inboxPath: string;
}

export class DesktopSchedulerDaemon {
  cwd: string;
  intervalSeconds: number;
  scheduler: Scheduler;

  constructor(options: DaemonOptions = {}) {
    this.cwd = path.resolve(String(options.cwd || process.cwd()));
    this.intervalSeconds = Number(options.intervalSeconds || 60);
    this.scheduler = new Scheduler(this.cwd);
  }

  tick(): DaemonTickResult {
    const due = this.scheduler.due();
    const checkedAt = new Date().toISOString();
    const inboxPath = path.join(this.cwd, ".cw", "schedules", "due-inbox.json");
    writeJson(inboxPath, {
      schemaVersion: 1,
      checkedAt,
      due
    });
    return {
      checkedAt,
      dueCount: due.length,
      dueIds: due.map((task) => task.id),
      inboxPath
    };
  }

  async run(): Promise<void> {
    fs.mkdirSync(path.join(this.cwd, ".cw", "schedules"), { recursive: true });
    process.stdout.write(`${JSON.stringify(this.tick())}\n`);
    setInterval(() => {
      process.stdout.write(`${JSON.stringify(this.tick())}\n`);
    }, Math.max(1, this.intervalSeconds) * 1000);
  }
}
