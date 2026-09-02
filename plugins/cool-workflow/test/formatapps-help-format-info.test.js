#!/usr/bin/env node
// formatapps-help-format-info — pins formatInfo(appId, data)'s field-gated
// human card: each optional field renders ONLY when present on `data`, the
// author object-vs-string branch, the inputs list rendering (required/
// default/description suffixes), and the trailing "Run: cw quickstart"
// line that always appears.
//
// Evidence: SPEC/workflow-apps.md "cw info <id>" / showApp shape;
// src/core/format/help.ts's formatInfo (byte-exact-in-spirit port of the
// old orchestrator module's formatInfo, color stripped).

const assert = require("node:assert/strict");
const { formatInfo } = require("../dist/core/format/help");

// Minimal data: only the header + the always-present "Run:" line.
{
  const out = formatInfo("my-app", {});
  assert.equal(out, 'cw info my-app\n  Run: cw quickstart my-app --repo . --question "..."', "with no optional fields, only header + Run line render");
}

// Every scalar optional field renders its own line, in header order.
{
  const out = formatInfo("my-app", { title: "My App", version: "1.2.3", summary: "Does things." });
  const lines = out.split("\n");
  assert.equal(lines[0], "cw info my-app");
  assert.equal(lines[1], "  Title: My App");
  assert.equal(lines[2], "  Version: 1.2.3");
  assert.equal(lines[3], "  Summary: Does things.");
}

// Author: string form is used verbatim.
{
  const out = formatInfo("my-app", { author: "COOLWHITE LLC" });
  assert.ok(out.includes("  Author: COOLWHITE LLC"), "string author renders verbatim");
}

// Author: object form renders only the .name field.
{
  const out = formatInfo("my-app", { author: { name: "Jane Dev", email: "jane@example.com" } });
  assert.ok(out.includes("  Author: Jane Dev"), "object author renders only its name field");
  assert.ok(!out.includes("jane@example.com"), "object author must not leak its email into the card");
}

// Compatible: true/false render as yes/no; undefined omits the line
// entirely (data.compatible !== undefined gate).
{
  const yes = formatInfo("my-app", { compatible: true });
  const no = formatInfo("my-app", { compatible: false });
  const absent = formatInfo("my-app", {});
  assert.ok(yes.includes("  Compatible: yes"));
  assert.ok(no.includes("  Compatible: no"));
  assert.ok(!absent.includes("Compatible:"), "compatible line is omitted entirely when the field is absent");
}

// Inputs: each renders "- name (type[, required][, default: x])[ — desc]";
// type defaults to "string" when absent.
{
  const out = formatInfo("my-app", {
    inputs: [
      { name: "repo", type: "path", required: true, description: "Target repo" },
      { name: "focus", default: "everything" },
      { name: "bare" },
    ],
  });
  const lines = out.split("\n");
  assert.ok(lines.includes("  Inputs:"), "an 'Inputs:' section header renders when inputs is non-empty");
  assert.ok(lines.includes("    - repo (path, required) — Target repo"), "required + type + description render together");
  assert.ok(lines.includes("    - focus (string, default: everything)"), "type defaults to string; default value renders");
  assert.ok(lines.includes("    - bare (string)"), "an input with only a name renders the bare (string) form");
}

// Empty inputs array: no "Inputs:" section at all (length check, not just
// array-presence).
{
  const out = formatInfo("my-app", { inputs: [] });
  assert.ok(!out.includes("Inputs:"), "an empty inputs array must not render an Inputs: section");
}

// Sandbox profiles: comma-joined, only when non-empty.
{
  const out = formatInfo("my-app", { sandboxProfiles: ["readonly", "workspace-write"] });
  assert.ok(out.includes("  Sandbox: readonly, workspace-write"));
  const empty = formatInfo("my-app", { sandboxProfiles: [] });
  assert.ok(!empty.includes("Sandbox:"), "empty sandboxProfiles must not render a Sandbox: line");
}

// Phases: count + pluralization of "phase"/"task", using taskCount
// (falling back to 0 when absent) rather than summing phases.length.
{
  const plural = formatInfo("my-app", { phases: [{ id: "a" }, { id: "b" }], taskCount: 14 });
  assert.ok(plural.includes("  Phases: 2 phases, 14 tasks"), "plural phases/tasks render with an 's' suffix");
  const singular = formatInfo("my-app", { phases: [{ id: "a" }], taskCount: 1 });
  assert.ok(singular.includes("  Phases: 1 phase, 1 task"), "singular phase/task must NOT carry the 's' suffix");
  const noPhases = formatInfo("my-app", { phases: [] });
  assert.ok(!noPhases.includes("Phases:"), "an empty phases array must not render a Phases: line");
}

// The trailing "Run: cw quickstart <id> --repo . --question "..."" line is
// ALWAYS the last line, using the exact appId passed in.
{
  const out = formatInfo("architecture-review", { title: "Architecture Review" });
  const lines = out.split("\n");
  assert.equal(lines[lines.length - 1], '  Run: cw quickstart architecture-review --repo . --question "..."', "the Run line is always last and echoes the exact appId");
}

process.stdout.write("formatapps-help-format-info: ok\n");
