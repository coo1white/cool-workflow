// test/helpers/env.mjs — keep a real agent out of a test (refactor phase 3).
//
// Consumers: every test that imports it (grep for helpers/env.mjs).
//
// clearAgentEnv(opts) deletes the agent-picking vars from process.env, so
// the operator's own CW_AGENT_COMMAND and the like never reach the code
// under test. opts:
//   also        more var names to delete (one local copy also takes CW_APPS_DIR)
//   noAutoAgent set CW_NO_AUTO_AGENT=1, so no agent on PATH is picked up
// With no opts it is the most common local clearAgentEnv().

export const AGENT_ENV_VARS = Object.freeze(["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]);

export function clearAgentEnv({ also = [], noAutoAgent = false } = {}) {
  for (const v of [...AGENT_ENV_VARS, ...also]) delete process.env[v];
  if (noAutoAgent) process.env.CW_NO_AUTO_AGENT = "1";
}
