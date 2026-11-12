// shell/execution-backend/local.ts — the env a child process CW starts gets.

/** CW's own secrets. No child process gets them, on any path. */
export const CW_NEVER_FORWARD_ENV: ReadonlySet<string> = new Set([
  "CW_RELEASE_VERDICT_PRIVKEY", // release verdict signing key — release-flow.mjs only
  "CW_WORKBENCH_TOKEN", // the retired workbench's bearer token — an older setup may still set it
  "CW_BENCH_TRACE_FILE", // benchmark trace path — parent only
  "CW_CHECK_PRIVKEY", // done-receipt signing key — cw check only; an agent holding it could forge receipts
]);

/** What a Windows program needs to start and find its own files: without
 *  SystemRoot a child's DNS and crypto can fail, without TEMP node's
 *  os.tmpdir() is "undefined\\temp", and without USERPROFILE/APPDATA a vendor
 *  CLI cannot find its login. Names and folders only, no secret. */
export const WINDOWS_SYSTEM_ENV: readonly string[] = ["SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];

/** PATH and HOME only (plus WINDOWS_SYSTEM_ENV on win32), never a CW secret.
 *  Windows names match in any case: a copied env holds `Path`. */
export function buildChildEnv(baseEnv: NodeJS.ProcessEnv = process.env, platform: string = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const get = (name: string): string | undefined => {
    if (baseEnv[name] !== undefined || platform !== "win32") return baseEnv[name];
    const key = Object.keys(baseEnv).find((k) => k.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : baseEnv[key];
  };
  for (const name of ["PATH", "HOME", ...(platform === "win32" ? WINDOWS_SYSTEM_ENV : [])]) {
    const value = get(name);
    if (value !== undefined) env[name] = value;
  }
  for (const name of CW_NEVER_FORWARD_ENV) delete env[name];
  return env;
}
