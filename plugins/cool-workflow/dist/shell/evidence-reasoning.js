"use strict";
// shell/evidence-reasoning.ts — the Evidence Adoption Reasoning Chain
// (v0.1.26). Faithful port of the old flat build's src/evidence-reasoning.ts
// (+ its src/types/evidence-reasoning.ts types), adapted to v2's core/shell
// split. DERIVES the "why" behind each evidence adoption decision from
// existing run state; never mutates source records, never fabricates a
// rationale (an untraceable adoption renders `unexplained`).
//
// Evidence: SPEC/multi-agent.md "Evidence adoption reasoning";
// plugins/cool-workflow/src/evidence-reasoning.ts (byte-behavior source).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_REASONING_SCHEMA_VERSION = void 0;
exports.buildEvidenceReasoningReport = buildEvidenceReasoningReport;
exports.reasoningCriticalNodeIds = reasoningCriticalNodeIds;
exports.reasoningDir = reasoningDir;
exports.refreshEvidenceReasoning = refreshEvidenceReasoning;
exports.loadEvidenceReasoningIndex = loadEvidenceReasoningIndex;
exports.showEvidenceReasoning = showEvidenceReasoning;
exports.normalizeEvidenceReasoningForEval = normalizeEvidenceReasoningForEval;
exports.formatEvidenceReasoningReport = formatEvidenceReasoningReport;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const validation_1 = require("../core/state/validation");
const fs_atomic_1 = require("./fs-atomic");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
const trust_audit_1 = require("./trust-audit");
const trust_policy_1 = require("../core/multi-agent/trust-policy");
const collate_1 = require("../core/util/collate");
exports.EVIDENCE_REASONING_SCHEMA_VERSION = 1;
function candidatesOf(run) {
    return (run.candidates || []);
}
function selectionsOf(run) {
    return (run.candidateSelections || []);
}
function commitsOf(run) {
    return (run.commits || []);
}
function decisionsOf(run) {
    return (run.blackboard?.decisions || []);
}
function faninsOf(run) {
    return (run.multiAgent?.fanins || []);
}
function rolesOf(run) {
    return (run.multiAgent?.roles || []);
}
// ---- Derivation ------------------------------------------------------------
function buildEvidenceReasoningReport(run, options = {}) {
    const operator = (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run);
    const scores = readAllScores(run);
    const auditEvents = (0, trust_audit_1.listTrustAuditEvents)(run);
    const counterfactuals = deriveCounterfactuals(run, scores);
    const chains = operator.evidence
        .map((evidence) => buildChain(run, evidence, { scores, auditEvents, counterfactuals }))
        .sort((left, right) => statusRank(left.evidenceStatus) - statusRank(right.evidenceStatus) || (0, collate_1.stableCompare)(left.id, right.id));
    const totals = summarizeTotals(chains);
    const currentFingerprint = fingerprintChains(chains);
    const persisted = options.index;
    let status = persisted ? "valid" : "absent";
    if (persisted && persisted.sourceFingerprint !== currentFingerprint)
        status = "stale";
    const nextAction = status === "stale" || status === "absent"
        ? `cw multi-agent reasoning ${run.id} --refresh`
        : totals.unexplained > 0
            ? `cw multi-agent reasoning ${run.id} --json`
            : `cw multi-agent evidence ${run.id} --json`;
    return {
        schemaVersion: exports.EVIDENCE_REASONING_SCHEMA_VERSION,
        runId: run.id,
        generatedAt: new Date().toISOString(),
        freshness: { status, persistedFingerprint: persisted?.sourceFingerprint, currentFingerprint },
        sourceFingerprint: currentFingerprint,
        totals,
        chains,
        nextAction,
    };
}
function buildChain(run, evidence, context) {
    const steps = [];
    const sourceRecordIds = new Set();
    const note = (id) => { if (id)
        sourceRecordIds.add(id); };
    const adopters = [...evidence.adoptedBy, ...evidence.rejectedBy];
    for (const scoreId of evidence.scoreIds) {
        const score = context.scores.get(scoreId);
        note(scoreId);
        steps.push(buildScoreStep(run, evidence, score, scoreId, context));
    }
    for (const selectionId of evidence.selectionIds) {
        const selection = selectionsOf(run).find((entry) => entry.id === selectionId);
        note(selectionId);
        steps.push(buildSelectionStep(run, evidence, selection, selectionId, context));
    }
    for (const commitId of evidence.commitIds) {
        const commit = commitsOf(run).find((entry) => entry.id === commitId);
        note(commitId);
        steps.push(buildCommitStep(run, evidence, commit, commitId));
        const verifierStep = buildVerifierStep(evidence, commit, commitId);
        if (verifierStep)
            steps.push(verifierStep);
    }
    const faninIds = new Set(faninsOf(run).map((entry) => entry.id));
    const decisions = decisionsOf(run);
    for (const adopter of unique(adopters)) {
        if (faninIds.has(adopter)) {
            note(adopter);
            steps.push(buildFaninStep(run, evidence, adopter, decisions));
        }
        else {
            const decision = decisions.find((entry) => entry.id === adopter);
            if (decision) {
                note(decision.id);
                steps.push(buildDecisionStep(evidence, decision));
            }
        }
    }
    if (!steps.length && isDecisionStatus(evidence.status)) {
        steps.push(buildUnexplainedStep(evidence));
    }
    const evidenceStatus = mapStatus(evidence.status);
    const rationaleStatus = rollupRationale(steps, evidenceStatus);
    const unexplainedReasons = steps
        .filter((step) => step.rationale.status === "unexplained")
        .map((step) => `${step.gate}: no recorded rationale for ${step.decision} adoption`);
    for (const ref of [evidence.sourceId, ...evidence.candidateIds])
        note(ref);
    return {
        schemaVersion: exports.EVIDENCE_REASONING_SCHEMA_VERSION,
        id: evidence.id,
        ref: evidence.ref,
        evidenceStatus,
        rationaleStatus,
        sourceKind: evidence.sourceKind,
        sourceId: evidence.sourceId,
        steps,
        sourceRecordIds: [...sourceRecordIds].filter(Boolean).sort(),
        unexplainedReasons,
    };
}
function buildScoreStep(run, evidence, score, scoreId, context) {
    const decision = score?.verdict === "fail" ? "rejected" : "adopted";
    const judge = context.auditEvents.find((event) => event.kind === "judge.rationale" && event.decision === "accepted" && (event.scoreId === scoreId || (!event.scoreId && event.candidateId && evidence.candidateIds.includes(event.candidateId))));
    const rationaleText = score?.notes || judgeRationaleText(judge);
    const rationale = rationaleText
        ? {
            status: "explained",
            text: truncate(rationaleText),
            sourceKind: score?.notes ? "score-notes" : "judge-rationale",
            sourceId: score?.notes ? scoreId : judge?.id,
            scoreCriteria: score?.criteria,
            scoreDelta: context.counterfactuals.bestRejectedNormalized !== undefined && score ? round(score.normalized - context.counterfactuals.bestRejectedNormalized) : undefined,
        }
        : unexplainedRationale();
    const auditIds = unique([...collectAuditIds(score), ...(judge ? [judge.id] : [])]);
    return {
        gate: "candidate-score",
        decision,
        basis: basisFor(evidence, { auditEventIds: auditIds, evidenceRefs: scoreEvidenceRefs(score) }),
        authority: roleAuthority(run, judge?.agentRoleId || score?.scorer, judge ? judge.decision === "accepted" : undefined),
        rationale,
        counterfactuals: decision === "adopted" ? context.counterfactuals.forScoreGate : [],
    };
}
function buildSelectionStep(run, evidence, selection, selectionId, context) {
    const rationaleText = selection?.reason;
    const acceptance = selection?.acceptanceRationale;
    const rationale = rationaleText
        ? { status: "explained", text: truncate(rationaleText), sourceKind: "selection-reason", sourceId: selectionId, scoreCriteria: acceptance?.scoreCriteria, judgeRationaleIds: acceptance?.judgeRationaleIds, panelDecisionId: acceptance?.panelDecisionId }
        : acceptance
            ? { status: "explained", text: `commit gate ${acceptance.commitGateResult || "recorded"} with ${acceptance.evidenceCount} evidence ref(s)`, sourceKind: "acceptance-rationale", sourceId: selectionId, scoreCriteria: acceptance.scoreCriteria, judgeRationaleIds: acceptance.judgeRationaleIds, panelDecisionId: acceptance.panelDecisionId }
            : unexplainedRationale();
    const synthesis = decisionsOf(run).find((entry) => entry.kind === "candidate-synthesis" && (entry.subjectIds || []).includes(selectionId) && entry.author?.kind === "role");
    return {
        gate: "selection",
        decision: "adopted",
        basis: basisFor(evidence, { auditEventIds: acceptance?.auditEventIds || [], evidenceRefs: (selection?.evidence || []).map(evidenceRef).filter(Boolean) }),
        authority: roleAuthority(run, synthesis?.author?.id || selection?.selectedBy, true),
        rationale,
        counterfactuals: context.counterfactuals.forSelectionGate,
    };
}
function buildCommitStep(_run, evidence, commit, commitId) {
    const decision = commit?.verifierGated ? "adopted" : "pending";
    const rationale = commit?.reason
        ? { status: "explained", text: truncate(commit.reason), sourceKind: "commit-reason", sourceId: commitId }
        : decision === "adopted"
            ? unexplainedRationale()
            : { status: "not-applicable" };
    return {
        gate: "commit",
        decision,
        basis: basisFor(evidence, { auditEventIds: commit?.acceptanceRationale?.auditEventIds || [], evidenceRefs: (commit?.evidence || []).map(evidenceRef).filter(Boolean) }),
        authority: { actor: commitId, actorKind: "runtime", allowed: commit?.verifierGated },
        rationale,
        counterfactuals: [],
    };
}
function buildVerifierStep(evidence, commit, commitId) {
    const verifierNodeId = commit?.verifierNodeId;
    if (!verifierNodeId)
        return undefined;
    const gateResult = commit?.acceptanceRationale?.commitGateResult;
    return {
        gate: "verifier",
        decision: commit?.verifierGated ? "adopted" : "pending",
        basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
        authority: { actor: verifierNodeId, actorKind: "verifier", allowed: commit?.verifierGated },
        rationale: gateResult
            ? { status: "explained", text: `verifier commit gate ${gateResult}`, sourceKind: "acceptance-rationale", sourceId: commitId }
            : commit?.verifierGated
                ? { status: "explained", text: "verifier-gated commit recorded", sourceKind: "commit-reason", sourceId: commitId }
                : { status: "not-applicable" },
        counterfactuals: [],
    };
}
function buildFaninStep(run, evidence, faninId, decisions) {
    const fanin = faninsOf(run).find((entry) => entry.id === faninId);
    const readiness = decisions.find((entry) => entry.kind === "fanin-readiness" && (entry.subjectIds || []).includes(faninId));
    const adopted = evidence.adoptedBy.includes(faninId);
    const decision = adopted ? "adopted" : "pending";
    let rationale;
    if (readiness?.reason) {
        rationale = { status: "explained", text: truncate(readiness.reason), sourceKind: "coordinator-decision", sourceId: readiness.id };
    }
    else if (fanin && fanin.verifierReady && coverageComplete(fanin)) {
        rationale = { status: "explained", text: `fanin ${faninId} ready: required evidence covered under "${fanin.strategy}" strategy`, sourceKind: "coordinator-decision", sourceId: faninId };
    }
    else if (fanin && (fanin.blockedReasons || []).length) {
        rationale = { status: "explained", text: truncate(fanin.blockedReasons[0]), sourceKind: "coordinator-decision", sourceId: faninId };
    }
    else {
        rationale = decision === "adopted" ? unexplainedRationale() : { status: "not-applicable" };
    }
    return {
        gate: "fanin",
        decision,
        basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
        authority: { actor: faninId, actorKind: "coordinator", allowed: adopted },
        rationale,
        counterfactuals: [],
    };
}
function buildDecisionStep(evidence, decision) {
    const status = mapDecisionOutcome(decision.outcome || "");
    return {
        gate: "fanin",
        decision: status,
        basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: decision.evidenceRefs || [] }),
        authority: { actor: decision.author?.id || decision.id, actorKind: authorKind(decision.author?.kind), allowed: decision.outcome === "accepted" || decision.outcome === "ready" },
        rationale: decision.reason
            ? { status: "explained", text: truncate(decision.reason), sourceKind: "coordinator-decision", sourceId: decision.id }
            : isDecisionStatus(status)
                ? unexplainedRationale()
                : { status: "not-applicable" },
        counterfactuals: [],
    };
}
function buildUnexplainedStep(evidence) {
    return {
        gate: "fanin",
        decision: mapStatus(evidence.status),
        basis: basisFor(evidence, { auditEventIds: [], evidenceRefs: [] }),
        authority: { actor: evidence.adoptedBy[0] || evidence.rejectedBy[0] || evidence.sourceId, actorKind: actorKindForSource(evidence.sourceKind), allowed: evidence.status === "adopted" },
        rationale: evidence.reason ? { status: "explained", text: truncate(evidence.reason), sourceKind: "coordinator-decision", sourceId: evidence.sourceId } : unexplainedRationale(),
        counterfactuals: [],
    };
}
function deriveCounterfactuals(run, scores) {
    const forScoreGate = [];
    const forSelectionGate = [];
    let bestRejectedNormalized;
    for (const candidate of candidatesOf(run)) {
        if (candidate.status === "rejected" || candidate.status === "failed") {
            forSelectionGate.push({ ref: candidate.id, kind: "candidate", status: "rejected", reason: (candidate.feedbackIds || [])[0] ? `see feedback ${candidate.feedbackIds[0]}` : `candidate ${candidate.id} ${candidate.status}` });
            for (const scoreId of candidate.scores || []) {
                const score = scores.get(scoreId);
                if (score && (bestRejectedNormalized === undefined || score.normalized > bestRejectedNormalized))
                    bestRejectedNormalized = score.normalized;
            }
        }
    }
    for (const [scoreId, score] of scores) {
        if (score.verdict === "fail") {
            forScoreGate.push({ ref: scoreId, kind: "score", status: "rejected", reason: score.notes ? truncate(score.notes) : `score ${scoreId} verdict=fail (normalized ${round(score.normalized)})` });
        }
    }
    for (const decision of decisionsOf(run)) {
        if (decision.outcome === "rejected" || decision.outcome === "superseded" || decision.outcome === "conflicting") {
            forSelectionGate.push({ ref: decision.id, kind: "decision", status: mapDecisionOutcome(decision.outcome), reason: decision.reason ? truncate(decision.reason) : `decision ${decision.id} ${decision.outcome}` });
        }
    }
    return { forScoreGate: forScoreGate.sort(byRef), forSelectionGate: forSelectionGate.sort(byRef), bestRejectedNormalized };
}
/** Critical-path node ids that state-explosion compaction must never collapse. */
function reasoningCriticalNodeIds(run) {
    const ids = new Set();
    const faninIds = new Set(faninsOf(run).map((entry) => entry.id));
    const commitById = new Map(commitsOf(run).map((commit) => [commit.id, commit]));
    for (const evidence of (0, multi_agent_operator_ux_1.summarizeMultiAgentOperator)(run).evidence) {
        if (evidence.status !== "adopted")
            continue;
        for (const id of evidence.candidateIds)
            ids.add(`${run.id}:candidate:${id}`);
        for (const id of evidence.scoreIds)
            ids.add(`${run.id}:score:${id}`);
        for (const id of evidence.selectionIds)
            ids.add(`${run.id}:selection:${id}`);
        for (const id of evidence.commitIds)
            ids.add(commitById.get(id)?.stateNodeId || `${run.id}:commit:${id}`);
        for (const adopter of evidence.adoptedBy)
            if (faninIds.has(adopter))
                ids.add(`${run.id}:multi-agent:fanin:${adopter}`);
    }
    return [...ids].sort();
}
// ---- Persistence + refresh -------------------------------------------------
function reasoningDir(run) {
    return node_path_1.default.join(run.paths.runDir, "reasoning");
}
function refreshEvidenceReasoning(run) {
    const report = buildEvidenceReasoningReport(run);
    const dir = reasoningDir(run);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const entries = [];
    for (const chain of report.chains) {
        const file = node_path_1.default.join(dir, `chain-${(0, fs_atomic_1.safeFileName)(chain.id)}.json`);
        (0, fs_atomic_1.writeJson)(file, chain);
        entries.push({ id: chain.id, path: file, evidenceStatus: chain.evidenceStatus, rationaleStatus: chain.rationaleStatus, sourceFingerprint: fingerprintChains([chain]) });
    }
    const indexPath = node_path_1.default.join(dir, "index.json");
    const reportPath = node_path_1.default.join(dir, "report.json");
    const index = {
        schemaVersion: exports.EVIDENCE_REASONING_SCHEMA_VERSION,
        runId: run.id,
        id: "evidence-reasoning-index",
        generatedAt: new Date().toISOString(),
        sourceFingerprint: report.sourceFingerprint,
        totals: report.totals,
        entries: entries.sort((a, b) => (0, collate_1.stableCompare)(a.id, b.id)),
        paths: { reasoningDir: dir, indexPath, reportPath },
        nextAction: `cw multi-agent reasoning ${run.id}`,
    };
    (0, fs_atomic_1.writeJson)(indexPath, index);
    (0, fs_atomic_1.writeJson)(reportPath, { ...report, freshness: { ...report.freshness, status: "valid", persistedFingerprint: report.sourceFingerprint } });
    return index;
}
function loadEvidenceReasoningIndex(run) {
    const indexPath = node_path_1.default.join(reasoningDir(run), "index.json");
    if (!node_fs_1.default.existsSync(indexPath))
        return undefined;
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(indexPath, "utf8"));
        if (!parsed || parsed.id !== "evidence-reasoning-index")
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
function showEvidenceReasoning(run, options = {}) {
    const index = loadEvidenceReasoningIndex(run);
    const report = buildEvidenceReasoningReport(run, { index });
    if (!options.evidenceId)
        return report;
    const chains = report.chains.filter((chain) => chain.id === options.evidenceId || chain.ref === options.evidenceId);
    return { ...report, chains, totals: summarizeTotals(chains) };
}
/** Derive the reasoning eval sections WITHOUT the persisted index (a replay
 *  run has no reasoning/index.json). Port of normalizeEvidenceReasoningForEval. */
function normalizeEvidenceReasoningForEval(run) {
    const report = buildEvidenceReasoningReport(run);
    return {
        reasoningFreshness: [
            JSON.stringify({
                sourceFingerprint: report.sourceFingerprint,
                chains: report.totals.chains,
                explained: report.totals.explained,
                unexplained: report.totals.unexplained,
                notApplicable: report.totals.notApplicable,
                adopted: report.totals.adopted,
                rejected: report.totals.rejected,
            }),
        ],
        reasoningChains: report.chains
            .map((chain) => JSON.stringify({
            id: stripRunId(run, chain.id),
            evidenceStatus: chain.evidenceStatus,
            rationaleStatus: chain.rationaleStatus,
            gates: chain.steps.map((step) => `${step.gate}:${step.decision}:${step.rationale.status}`),
            counterfactuals: chain.steps.reduce((total, step) => total + step.counterfactuals.length, 0),
        }))
            .sort(),
        reasoningUnexplained: report.chains.filter((chain) => chain.rationaleStatus === "unexplained").map((chain) => stripRunId(run, chain.id)).sort(),
    };
}
function stripRunId(run, id) {
    return id.startsWith(`${run.id}:`) ? id.slice(run.id.length + 1) : id;
}
// ---- Human formatting ------------------------------------------------------
function formatEvidenceReasoningReport(report) {
    const lines = [];
    lines.push(`Evidence Adoption Reasoning: ${report.runId}`);
    lines.push(`Freshness: ${report.freshness.status}`);
    lines.push("");
    lines.push("Adoption Rationale");
    lines.push(`  chains=${report.totals.chains}; explained=${report.totals.explained}; unexplained=${report.totals.unexplained}; n/a=${report.totals.notApplicable}; adopted=${report.totals.adopted}; rejected=${report.totals.rejected}`);
    lines.push("");
    if (!report.chains.length)
        lines.push("  none");
    for (const chain of report.chains.slice(0, 60)) {
        lines.push(`  [${chain.evidenceStatus}/${chain.rationaleStatus}] ${chain.id} (${chain.ref || chain.sourceKind})`);
        for (const step of chain.steps) {
            const actor = `${step.authority.actorKind}:${step.authority.actor || "unknown"}`;
            const why = step.rationale.status === "explained" ? step.rationale.text : `(${step.rationale.status})`;
            const policy = step.authority.policyRef ? ` policy=${step.authority.policyRef}` : "";
            lines.push(`    - ${step.gate} [${step.decision}] by ${actor}${policy}: ${why}`);
            for (const cf of step.counterfactuals.slice(0, 4))
                lines.push(`        x ${cf.kind} ${cf.ref} [${cf.status}]: ${cf.reason}`);
        }
        for (const reason of chain.unexplainedReasons)
            lines.push(`    ! ${reason}`);
    }
    if (report.chains.length > 60)
        lines.push(`  ... ${report.chains.length - 60} more`);
    lines.push("");
    lines.push("Next Action");
    lines.push(`  ${report.nextAction}`);
    return lines.join("\n");
}
// ---- Helpers ---------------------------------------------------------------
function basisFor(evidence, extra) {
    return {
        evidenceRefs: unique([evidence.locator || evidence.path || evidence.ref || evidence.id, ...extra.evidenceRefs].filter(Boolean)),
        provenanceSource: provenanceSourceFor(evidence),
        parentEvidenceIds: [],
        auditEventIds: unique(extra.auditEventIds.filter(Boolean)),
    };
}
function provenanceSourceFor(evidence) {
    const value = evidence.provenanceSource;
    if (value === "cw-validated" || value === "host-attested" || value === "operator-recorded" || value === "runtime-derived")
        return value;
    return undefined;
}
function roleAuthority(run, actor, allowed) {
    const role = rolesOf(run).find((entry) => entry.id === actor);
    const policyRef = role ? (role.policy || (0, trust_policy_1.policyForRole)(role)).policyRef : undefined;
    return { actor, actorKind: role ? "role" : actor === "multi-agent-host" ? "operator" : actorKindForActor(actor), policyRef, allowed };
}
function rollupRationale(steps, evidenceStatus) {
    const decisionSteps = steps.filter((step) => isDecisionStatus(step.decision));
    if (!decisionSteps.length)
        return "not-applicable";
    if (decisionSteps.some((step) => step.rationale.status === "unexplained"))
        return "unexplained";
    if (decisionSteps.every((step) => step.rationale.status === "explained"))
        return "explained";
    return evidenceStatus === "adopted" ? "unexplained" : "not-applicable";
}
function summarizeTotals(chains) {
    const byStatus = {};
    let explained = 0, unexplained = 0, notApplicable = 0, adopted = 0, rejected = 0;
    for (const chain of chains) {
        byStatus[chain.evidenceStatus] = (byStatus[chain.evidenceStatus] || 0) + 1;
        if (chain.rationaleStatus === "explained")
            explained += 1;
        else if (chain.rationaleStatus === "unexplained")
            unexplained += 1;
        else
            notApplicable += 1;
        if (chain.evidenceStatus === "adopted")
            adopted += 1;
        if (chain.evidenceStatus === "rejected")
            rejected += 1;
    }
    return { chains: chains.length, explained, unexplained, notApplicable, adopted, rejected, byStatus };
}
function readAllScores(run) {
    const scores = new Map();
    const candidatesDir = run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates");
    for (const candidate of candidatesOf(run)) {
        const dir = node_path_1.default.join(candidatesDir, (0, fs_atomic_1.safeFileName)(candidate.id), "scores");
        if (!node_fs_1.default.existsSync(dir))
            continue;
        for (const file of node_fs_1.default.readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
            try {
                // Fail closed on a malformed/forged score shape via the shared core
                // guard (full field-shape check, not just id/normalized).
                const parsed = (0, validation_1.tryValidateCandidateScore)(JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, file), "utf8")));
                if (!parsed)
                    continue;
                scores.set(parsed.id, parsed);
            }
            catch {
                // Unreadable score record: skip; the score gate fails closed.
            }
        }
    }
    return scores;
}
function fingerprintChains(chains) {
    const lines = chains.map((chain) => JSON.stringify([chain.id, chain.evidenceStatus, chain.rationaleStatus, chain.steps.map((step) => [step.gate, step.decision, step.rationale.status, step.rationale.sourceId || ""])]));
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(JSON.stringify([...lines].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
function unexplainedRationale() {
    return { status: "unexplained" };
}
function judgeRationaleText(event) {
    const value = event?.metadata?.rationale;
    return typeof value === "string" && value.trim() ? value : undefined;
}
function collectAuditIds(score) {
    const ids = [];
    for (const item of score?.evidence || [])
        for (const id of item.provenance?.auditEventIds || [])
            ids.push(id);
    return ids;
}
function scoreEvidenceRefs(score) {
    return (score?.evidence || []).map(evidenceRef).filter(Boolean);
}
function evidenceRef(item) {
    return item.locator || item.path || item.summary || item.id || "";
}
function coverageComplete(fanin) {
    const coverage = fanin.evidenceCoverage || [];
    return coverage.length > 0 && coverage.every((entry) => entry.complete);
}
function mapStatus(status) {
    return status;
}
function mapDecisionOutcome(outcome) {
    if (outcome === "accepted" || outcome === "ready")
        return "adopted";
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "superseded")
        return "superseded";
    if (outcome === "conflicting")
        return "conflicting";
    return "pending";
}
function isDecisionStatus(status) {
    return status === "adopted" || status === "rejected" || status === "superseded" || status === "conflicting";
}
function authorKind(kind) {
    if (kind === "role" || kind === "group")
        return "role";
    if (kind === "worker")
        return "worker";
    if (kind === "membership")
        return "membership";
    if (kind === "operator")
        return "operator";
    if (kind === "verifier")
        return "verifier";
    if (kind === "coordinator")
        return "coordinator";
    return "runtime";
}
function actorKindForActor(actor) {
    if (!actor)
        return "runtime";
    if (actor.includes("worker"))
        return "worker";
    if (actor.includes("membership"))
        return "membership";
    if (actor.includes("verifier"))
        return "verifier";
    return "runtime";
}
function actorKindForSource(sourceKind) {
    if (sourceKind === "worker")
        return "worker";
    if (sourceKind === "coordinator")
        return "coordinator";
    if (sourceKind === "verifier")
        return "verifier";
    if (sourceKind === "operator")
        return "operator";
    return "runtime";
}
function statusRank(status) {
    return { adopted: 0, pending: 1, missing: 2, conflicting: 3, rejected: 4, superseded: 5, unexplained: 6 }[status] ?? 9;
}
function truncate(value) {
    const single = value.replace(/\s+/g, " ").trim();
    return single.length > 200 ? `${single.slice(0, 197)}...` : single;
}
function round(value) {
    return Math.round(value * 1000) / 1000;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
function byRef(a, b) {
    return (0, collate_1.stableCompare)(a.ref, b.ref);
}
