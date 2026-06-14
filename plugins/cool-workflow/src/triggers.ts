import fs from "node:fs";
import path from "node:path";
import {
  RoutineTrigger,
  RoutineTriggerEvent,
  RoutineTriggerKind,
  RoutineTriggerStore
} from "./types";
import { readJson, safeFileName, writeJson } from "./state";

export class RoutineTriggerBridge {
  cwd: string;
  storePath: string;
  payloadsDir: string;

  constructor(cwd = process.cwd()) {
    this.cwd = path.resolve(cwd);
    this.storePath = path.join(this.cwd, ".cw", "routines", "triggers.json");
    this.payloadsDir = path.join(this.cwd, ".cw", "routines", "payloads");
  }

  create(options: Record<string, unknown>): RoutineTrigger {
    const now = new Date().toISOString();
    const store = this.load();
    const trigger: RoutineTrigger = {
      id: createTriggerId(normalizeKind(options.kind), store.triggers.length + 1),
      kind: normalizeKind(options.kind),
      createdAt: now,
      updatedAt: now,
      source: String(options.source || options.kind || "api"),
      prompt: requiredString(options.prompt, "prompt"),
      workflowId: stringOption(options.workflowId),
      runId: stringOption(options.runId),
      match: parseJsonObject(options.match),
      metadata: parseJsonObject(options.metadata)
    };
    store.triggers.push(trigger);
    this.save(store);
    return trigger;
  }

  list(kind?: string): RoutineTrigger[] {
    const store = this.load();
    return kind ? store.triggers.filter((trigger) => trigger.kind === kind) : store.triggers;
  }

  delete(id: string): { deleted: boolean; id: string } {
    const store = this.load();
    const before = store.triggers.length;
    store.triggers = store.triggers.filter((trigger) => trigger.id !== id);
    this.save(store);
    return { deleted: store.triggers.length !== before, id };
  }

  fire(kind: string, payload: unknown): RoutineTriggerEvent[] {
    const normalizedKind = normalizeKind(kind);
    const store = this.load();
    const now = new Date().toISOString();
    const base = store.events.length;
    const events = store.triggers
      .filter((trigger) => trigger.kind === normalizedKind)
      .map((trigger, index) => this.createEvent(trigger, payload, now, base + index + 1));
    store.events.push(...events);
    this.save(store);
    return events;
  }

  events(triggerId?: string): RoutineTriggerEvent[] {
    const store = this.load();
    return triggerId ? store.events.filter((event) => event.triggerId === triggerId) : store.events;
  }

  private createEvent(trigger: RoutineTrigger, payload: unknown, receivedAt: string, seq: number): RoutineTriggerEvent {
    const matched = matches(trigger.match, payload);
    const eventId = createEventId(trigger.kind, seq);
    const payloadPath = path.join(this.payloadsDir, `${safeFileName(eventId)}.json`);
    writeJson(payloadPath, {
      schemaVersion: 1,
      trigger,
      receivedAt,
      matched,
      payload
    });
    return {
      id: eventId,
      triggerId: trigger.id,
      kind: trigger.kind,
      receivedAt,
      matched,
      prompt: matched ? renderPrompt(trigger, payload) : undefined,
      payloadPath
    };
  }

  private load(): RoutineTriggerStore {
    if (!fs.existsSync(this.storePath)) return { schemaVersion: 1, triggers: [], events: [] };
    const value = readJson(this.storePath) as RoutineTriggerStore;
    return {
      schemaVersion: 1,
      triggers: Array.isArray(value.triggers) ? value.triggers : [],
      events: Array.isArray(value.events) ? value.events : []
    };
  }

  private save(store: RoutineTriggerStore): void {
    writeJson(this.storePath, store);
  }
}

function normalizeKind(value: unknown): RoutineTriggerKind {
  const kind = String(value || "api");
  if (kind === "api" || kind === "github") return kind;
  throw new Error(`Unsupported routine trigger kind: ${kind}`);
}

function matches(match: Record<string, unknown> | undefined, payload: unknown): boolean {
  if (!match || !Object.keys(match).length) return true;
  if (!payload || typeof payload !== "object") return false;
  return Object.entries(match).every(([key, expected]) => deepValue(payload, key) === expected);
}

function deepValue(value: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function renderPrompt(trigger: RoutineTrigger, payload: unknown): string {
  return `${trigger.prompt}\n\ncw:routine\n${JSON.stringify({
    triggerId: trigger.id,
    kind: trigger.kind,
    source: trigger.source,
    workflowId: trigger.workflowId,
    runId: trigger.runId,
    payload
  }, null, 2)}`;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || value === true) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  const parsed = JSON.parse(String(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  const text = stringOption(value);
  if (!text) throw new Error(`Missing required ${name}`);
  return text;
}

function stringOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

// Deterministic trigger id (FreeBSD-audit L12/L13): the trigger's POSITION in the
// append-only trigger store, qualified by kind. No wall-clock stamp, no PRNG suffix
// — registering the same triggers in the same order mints byte-identical ids.
function createTriggerId(kind: RoutineTriggerKind, seq: number): string {
  return `${kind}-${String(seq).padStart(4, "0")}`;
}

// Deterministic event id (FreeBSD-audit L12/L13): the event's POSITION in the
// append-only event log (firing many triggers at once still yields a distinct,
// stable id per trigger). No clock, no PRNG.
function createEventId(kind: RoutineTriggerKind, seq: number): string {
  return `event-${kind}-${String(seq).padStart(4, "0")}`;
}
