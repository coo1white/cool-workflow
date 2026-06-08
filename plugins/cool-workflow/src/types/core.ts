export type TaskKind = "agent" | "artifact";
export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type PhaseStatus = "pending" | "running" | "completed";
export type LoopStage = "interpret" | "act" | "observe" | "adjust" | "checkpoint";
export type FindingClassification = "real" | "conditional" | "non-issue" | "unknown";
export type Severity = "P0" | "P1" | "P2" | "P3" | "none";
export type StateNodeKind =
  | "input"
  | "task"
  | "dispatch"
  | "result"
  | "candidate"
  | "verifier"
  | "commit"
  | "blackboard"
  | "blackboard-topic"
  | "blackboard-message"
  | "blackboard-context"
  | "blackboard-artifact"
  | "blackboard-snapshot"
  | "coordinator-decision"
  | "topology-run"
  | "topology-phase"
  | "multi-agent-run"
  | "agent-role"
  | "agent-group"
  | "agent-membership"
  | "agent-fanout"
  | "agent-fanin"
  | "report"
  | "schedule"
  | "trigger"
  | "error";
export type StateNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "verified"
  | "rejected"
  | "committed";
