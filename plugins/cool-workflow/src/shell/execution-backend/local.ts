// shell/execution-backend/local.ts — the env a child process CW starts gets.

/** CW's own secrets. No child process gets them, on any path. */
export const CW_NEVER_FORWARD_ENV: ReadonlySet<string> = new Set([
  "CW_RELEASE_VERDICT_PRIVKEY", // release verdict signing key — release-flow.mjs only
  "CW_WORKBENCH_TOKEN", // the retired workbench's bearer token — an older setup may still set it
  "CW_BENCH_TRACE_FILE", // benchmark trace path — parent only
  "CW_CHECK_PRIVKEY", // done-receipt signing key — cw check only; an agent holding it could forge receipts
]);

/** PATH and HOME only, never a CW secret. */
export function buildChildEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (baseEnv.PATH !== undefined) env.PATH = baseEnv.PATH;
  if (baseEnv.HOME !== undefined) env.HOME = baseEnv.HOME;
  for (const name of CW_NEVER_FORWARD_ENV) delete env[name];
  return env;
}
