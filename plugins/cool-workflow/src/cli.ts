#!/usr/bin/env node
import { runCli } from "./cli/command-surface";
import { red, bold, tryHint } from "./term";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const err = process.stderr;
  // Errors go to stderr → color must key off stderr (not the term default).
  err.write(`${bold("cw:", err)} ${red(message, err)}\n`);
  // Brew-style recovery: a failed command should suggest a concrete next move. The hint
  // is TTY-gated (tryHint dims only on a TTY) and goes to stderr, so piped stdout stays
  // clean. It points at CW's OWN diagnose/discovery verbs (vendor-neutral) — never a model.
  const hint = recoveryHint(message);
  if (hint) err.write(`  ${tryHint(hint, err)}\n`);
  process.exitCode = 1;
});

/** Map a top-level error message to ONE copy-pasteable recovery command (brew's `Try:`).
 *  Content-based so it stays correct for any vendor; returns undefined rather than a
 *  wrong guess when nothing matches (no hint beats a misleading one). */
export function recoveryHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.startsWith("unknown command")) return "cw help";
  if (m.includes("not configured") || m.includes("agent backend")) return "cw doctor";
  if (m.includes("missing") && m.includes("repo")) return 'cw -q "<question>" -dir <project-folder>';
  if (m.includes("app") && (m.includes("not found") || m.includes("not available"))) return "cw app list";
  if (m.includes("run id") || m.includes("run not found")) return "cw run list";
  return undefined;
}
