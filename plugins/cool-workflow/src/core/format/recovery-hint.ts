// core/format/recovery-hint.ts — from a thrown error's message to one
// copy-pasteable next command, or undefined rather than a wrong guess.

export function recoveryHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.startsWith("unknown command")) return "cw help";
  if (m.includes("not configured") || m.includes("agent backend")) return "cw doctor";
  if ((m.includes("missing") && m.includes("repo")) || m.includes("not a git project")) return 'cw -q "<question>" -dir <project-folder>';
  if (m.includes("run not found") || m.includes("older cw")) return 'cw -q "<question>"';
  if (m.includes("missing required input") && m.includes("question")) return 'cw -q "<question>"';
  return undefined;
}
