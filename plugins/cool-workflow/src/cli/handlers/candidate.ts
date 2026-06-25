// `cw candidate list|show|register|score|rank|select|reject|summary …` handler
// — the candidate-scoring family, carved out of the command-surface
// god-dispatch in the final cycle. This is the LAST inline command-family to
// leave the dispatcher: after it, command-surface.ts is the dispatch skeleton
// plus metadata verbs plus one-line delegations only. Each inner case prints
// inline and returns (no shared tail; no exit codes anywhere in this block).
// `formatCandidateSummary` moves here too — `candidate summary` was its last
// command-surface user, so its import follows the case it serves. It stays
// EXPORTED from operator-ux for any other reader.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatCandidateSummary } from "../../operator-ux";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]`. */
export function handleCandidate(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId, candidateId, reason] = args.positionals;
  switch (subcommand) {
    case "list":
      printJson(runner.listCandidates(required(runId, "run id"), args.options));
      return;
    case "show":
      printJson(runner.showCandidate(required(runId, "run id"), required(candidateId, "candidate id")));
      return;
    case "register":
      printJson(runner.registerCandidate(required(runId, "run id"), args.options));
      return;
    case "score":
      printJson(runner.scoreCandidate(required(runId, "run id"), required(candidateId, "candidate id"), args.options));
      return;
    case "rank":
      printJson(runner.rankCandidates(required(runId, "run id"), args.options));
      return;
    case "select":
      printJson(runner.selectCandidate(required(runId, "run id"), required(candidateId, "candidate id"), args.options));
      return;
    case "reject":
      printJson(
        runner.rejectCandidate(
          required(runId, "run id"),
          required(candidateId, "candidate id"),
          String(args.options.reason || args.options.message || reason || "rejected")
        )
      );
      return;
    case "summary":
      if (wantsJson(args.options)) printJson(runner.summarizeCandidateOperatorRecords(required(runId, "run id")));
      else process.stdout.write(`${formatCandidateSummary(runner.summarizeCandidateOperatorRecords(required(runId, "run id")))}\n`);
      return;
    default:
      throw new Error("Usage: cw.js candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
  }
}
