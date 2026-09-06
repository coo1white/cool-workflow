// Pure action-first projection, ported byte-for-byte from the old
// inspection.js. It copies a small set of facts from one capability
// payload for display; it makes no new state, rank, or action.

export interface ActionFact {
  key: string;
  label: string;
  items: string[];
}

function compactValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  const encoded = JSON.stringify(value);
  return typeof encoded === "string" ? encoded : null;
}

function arrayFact(data: Record<string, unknown>, key: string, label: string, emptyMeansNone: boolean): ActionFact | null {
  if (!Array.isArray(data[key])) return null;
  const items = (data[key] as unknown[]).map(compactValue).filter((item): item is string => item !== null);
  if (items.length === 0 && emptyMeansNone) items.push("none");
  return items.length > 0 ? { key, label, items } : null;
}

export function actionFacts(data: unknown): ActionFact[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const facts: ActionFact[] = [];

  const integrity = record.integrity;
  if (integrity && typeof integrity === "object" && !Array.isArray(integrity)) {
    const i = integrity as Record<string, unknown>;
    const items: string[] = [];
    if (typeof i.verified === "boolean") items.push(`verified: ${i.verified}`);
    if (typeof i.eventCount === "number" && Number.isFinite(i.eventCount)) items.push(`event count: ${i.eventCount}`);
    if (typeof i.corruptLines === "number" && Number.isFinite(i.corruptLines)) items.push(`corrupt lines: ${i.corruptLines}`);
    if (items.length > 0) facts.push({ key: "integrity", label: "integrity", items });
  }

  const problems = arrayFact(record, "problems", "problems", true);
  if (problems) facts.push(problems);
  const missing = arrayFact(record, "missingEvidence", "missing evidence", true);
  if (missing) facts.push(missing);

  if (typeof record.nextAction === "string" && record.nextAction.length > 0) {
    facts.push({ key: "nextAction", label: "next action", items: [record.nextAction] });
  }
  if (Array.isArray(record.nextActions)) {
    const items = (record.nextActions as unknown[]).filter((item): item is string => typeof item === "string" && item.length > 0);
    if (items.length > 0) facts.push({ key: "nextActions", label: "next actions", items });
  }
  return facts;
}
