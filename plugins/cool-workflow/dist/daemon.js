"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopSchedulerDaemon = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const scheduler_1 = require("./scheduler");
const state_1 = require("./state");
class DesktopSchedulerDaemon {
    cwd;
    intervalSeconds;
    scheduler;
    constructor(options = {}) {
        this.cwd = node_path_1.default.resolve(String(options.cwd || process.cwd()));
        this.intervalSeconds = Number(options.intervalSeconds || 60);
        this.scheduler = new scheduler_1.Scheduler(this.cwd);
    }
    tick() {
        const due = this.scheduler.due();
        const checkedAt = new Date().toISOString();
        const inboxPath = node_path_1.default.join(this.cwd, ".cw", "schedules", "due-inbox.json");
        (0, state_1.writeJson)(inboxPath, {
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
    async run() {
        node_fs_1.default.mkdirSync(node_path_1.default.join(this.cwd, ".cw", "schedules"), { recursive: true });
        process.stdout.write(`${JSON.stringify(this.tick())}\n`);
        setInterval(() => {
            process.stdout.write(`${JSON.stringify(this.tick())}\n`);
        }, Math.max(1, this.intervalSeconds) * 1000);
    }
}
exports.DesktopSchedulerDaemon = DesktopSchedulerDaemon;
