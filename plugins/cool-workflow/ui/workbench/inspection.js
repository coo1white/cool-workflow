"use strict";
// Pure action-first projection. It copies a small set of facts from one
// capability payload for display; it makes no new state, rank, or action.

(function expose(root, factory) {
  const inspection = factory();
  if (typeof module === "object" && module.exports) module.exports = inspection;
  if (root) root.CWWorkbenchInspection = inspection;
})(typeof globalThis === "object" ? globalThis : this, function buildInspection() {
  function compactValue(value) {
    if (typeof value === "string") return value;
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : null;
  }

  function arrayFact(data, key, label, emptyMeansNone) {
    if (!Array.isArray(data[key])) return null;
    const items = data[key].map(compactValue).filter((item) => item !== null);
    if (items.length === 0 && emptyMeansNone) items.push("none");
    return items.length > 0 ? { key, label, items } : null;
  }

  function actionFacts(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const facts = [];
    const integrity = data.integrity;
    if (integrity && typeof integrity === "object" && !Array.isArray(integrity)) {
      const items = [];
      if (typeof integrity.verified === "boolean") items.push(`verified: ${integrity.verified}`);
      if (typeof integrity.eventCount === "number" && Number.isFinite(integrity.eventCount)) items.push(`event count: ${integrity.eventCount}`);
      if (typeof integrity.corruptLines === "number" && Number.isFinite(integrity.corruptLines)) items.push(`corrupt lines: ${integrity.corruptLines}`);
      if (items.length > 0) facts.push({ key: "integrity", label: "integrity", items });
    }

    const problems = arrayFact(data, "problems", "problems", true);
    if (problems) facts.push(problems);
    const missing = arrayFact(data, "missingEvidence", "missing evidence", true);
    if (missing) facts.push(missing);

    if (typeof data.nextAction === "string" && data.nextAction.length > 0) {
      facts.push({ key: "nextAction", label: "next action", items: [data.nextAction] });
    }
    if (Array.isArray(data.nextActions)) {
      const items = data.nextActions.filter((item) => typeof item === "string" && item.length > 0);
      if (items.length > 0) facts.push({ key: "nextActions", label: "next actions", items });
    }
    return facts;
  }

  return { actionFacts };
});
