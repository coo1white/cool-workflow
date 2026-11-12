// core/trust/srt-settings.ts — CW_AGENT_SANDBOX=srt (0.3.3, opt-in): the mode, and a sandbox profile as
// srt settings. Pure.
/** The one srt version CW runs; a new one is a reviewed change. */
export const SRT_VERSION = "0.0.81";
/** Folders under $HOME an agent never needs and must not read (secrets and
 *  CW's own release signing key), unless the profile's readPaths names one (not a parent of one). */
export const SECRET_HOME_DIRS = [".ssh", ".aws", ".gnupg", ".config/gh", ".config/gcloud", ".docker", ".kube", ".netrc", ".cw-keys"];
export function agentSandboxMode(env) {
    const raw = String(env.CW_AGENT_SANDBOX ?? "").trim().toLowerCase();
    if (!raw || raw === "off")
        return { mode: "off" };
    if (raw === "srt")
        return { mode: "srt" };
    return { error: `CW_AGENT_SANDBOX="${env.CW_AGENT_SANDBOX}" is not known; use "srt" or leave it unset` };
}
const join = (home, rel) => `${home.replace(/\/+$/, "")}/${rel}`;
const expandHome = (home, p) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);
const unique = (items) => [...new Set(items.filter(Boolean))];
const within = (child, parent) => child === parent || child.startsWith(`${parent.replace(/\/+$/, "")}/`);
export function buildSrtSettings(input) {
    const readPaths = input.readPaths.map((p) => expandHome(input.home, p));
    // Only a readPath at or inside a secret folder opens it: a broad one (cwd = $HOME) never does.
    const denyRead = SECRET_HOME_DIRS.map((rel) => join(input.home, rel)).filter((dir) => !readPaths.some((p) => within(p, dir)));
    return {
        network: { allowedDomains: unique(input.hosts.map((h) => h.trim())), deniedDomains: [] },
        filesystem: {
            denyRead,
            allowRead: [],
            allowWrite: unique([...input.writePaths, input.tmpDir, ...input.vendorWrite.map((p) => expandHome(input.home, p))]),
            denyWrite: [],
        },
    };
}
