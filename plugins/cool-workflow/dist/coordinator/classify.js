"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusToNodeStatus = statusToNodeStatus;
exports.decisionStatus = decisionStatus;
exports.auditDecision = auditDecision;
exports.sourceForAuthor = sourceForAuthor;
function statusToNodeStatus(status) {
    switch (status) {
        case "active":
        case "open":
            return "running";
        case "resolved":
        case "superseded":
            return "completed";
        case "conflicting":
            return "blocked";
        case "rejected":
            return "rejected";
        default:
            return "completed";
    }
}
function decisionStatus(outcome) {
    if (outcome === "conflicting" || outcome === "blocked")
        return "conflicting";
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "superseded")
        return "superseded";
    return "active";
}
function auditDecision(outcome) {
    if (outcome === "rejected")
        return "rejected";
    if (outcome === "blocked" || outcome === "conflicting")
        return "failed";
    return "accepted";
}
function sourceForAuthor(author) {
    if (author.kind === "runtime" || author.kind === "coordinator")
        return "runtime-derived";
    if (author.kind === "worker" || author.kind === "verifier")
        return "cw-validated";
    return "operator-recorded";
}
