export type ScheduleKind = "loop" | "cron" | "reminder";
export type ScheduleStatus = "active" | "paused" | "completed" | "expired";

export interface ScheduledTask {
  id: string;
  kind: ScheduleKind;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  expiresAt: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  sessionId?: string;
  intervalMinutes?: number;
  cron?: string;
  jitterSeconds: number;
  maxRuns?: number;
  runCount: number;
  lastRunAt?: string;
  lastDueAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduleRunStatus = "due" | "started" | "completed" | "failed" | "skipped";

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  prompt: string;
  cwd: string;
  workflowId?: string;
  runId?: string;
  error?: string;
}

export interface ScheduleStore {
  schemaVersion: 1;
  tasks: ScheduledTask[];
  history: ScheduleRunRecord[];
}

export type RoutineTriggerKind = "api" | "github";

export interface RoutineTrigger {
  id: string;
  kind: RoutineTriggerKind;
  createdAt: string;
  updatedAt: string;
  source: string;
  prompt: string;
  workflowId?: string;
  runId?: string;
  match?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RoutineTriggerEvent {
  id: string;
  triggerId: string;
  kind: RoutineTriggerKind;
  receivedAt: string;
  matched: boolean;
  prompt?: string;
  payloadPath: string;
  /** Deduplication key for idempotent event processing (v0.1.70). */
  dedupKey?: string;
}

export interface RoutineTriggerStore {
  schemaVersion: 1;
  triggers: RoutineTrigger[];
  events: RoutineTriggerEvent[];
  /** Monotonic, delete-proof trigger-id sequence. Unlike triggers.length it never
   *  decrements when a trigger is deleted, so a later create cannot reuse a live
   *  id (which would corrupt the append-only event/audit log). */
  nextTriggerSeq?: number;
}
