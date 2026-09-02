"use strict";
// shell/onramp.ts — the change-contract onramp subsystem.
//
// Byte-exact port of the old flat build's onramp module (added in #198):
// evaluateOnrampContract, recommendSmokeTests, resolveChangedFiles,
// buildDoctorOnramp. Impure (git/fs reads), so it lives under shell/.
// The v2 rebuild dropped this module on purpose for a later milestone;
// this restores it and shell/doctor.ts wires --onramp back to it.
//
// The classification in evaluateOnrampContract works on path STRINGS only
// (it never stats files) — which cuts both ways: it never breaks on a
// missing file, but it also never notices when a literal it matches
// against has moved. isSurfaceFile and CURATED_SMOKE_MAP both drifted this
// way after the v2 core/shell/wiring split (self-audit-cool-workflow-v0.2.6.md
// P2) — 19 of 33 CURATED_SMOKE_MAP rows named a file gone as of #598.
// test/onramp-check-smoke.js now checks every row against the real tree.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURATED_SMOKE_MAP = void 0;
exports.optionEnabled = optionEnabled;
exports.npmCommand = npmCommand;
exports.nodeSmokeCommand = nodeSmokeCommand;
exports.detectSourceCheckout = detectSourceCheckout;
exports.shellQuote = shellQuote;
exports.buildDoctorOnramp = buildDoctorOnramp;
exports.isCommentOnlyPatch = isCommentOnlyPatch;
exports.isDeleteOnlyPatch = isDeleteOnlyPatch;
exports.resolveChangedFiles = resolveChangedFiles;
exports.evaluateOnrampContract = evaluateOnrampContract;
exports.recommendSmokeTests = recommendSmokeTests;
exports.isGitWorkTree = isGitWorkTree;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
exports.CURATED_SMOKE_MAP = [
    {
        patterns: ["src/shell/doctor.ts", "src/shell/onramp.ts", "scripts/onramp-check.js"],
        smokes: ["doctor-smoke.js", "onramp-check-smoke.js"]
    },
    {
        patterns: ["README.md", "docs/getting-started.md", "docs/index.md"],
        smokes: ["quickstart-readme-path-smoke.js", "doctor-smoke.js"]
    },
    {
        patterns: ["src/cli.ts", "src/cli/"],
        smokes: ["cli-command-surface-smoke.js", "cli-jsonmode-parity-smoke.js", "cli-mcp-parity-smoke.js"]
    },
    {
        // Pre-rebuild this was the single flat orchestrator module; the real
        // current file is shell/orchestrator.ts (self-audit-cool-workflow-v0.2.6.md P2).
        patterns: ["src/shell/orchestrator.ts"],
        smokes: ["cli-mcp-parity-smoke.js"]
    },
    {
        // Pre-rebuild this was the single flat capability-registry module; it was
        // split into core/capability-data.ts plus wiring/capability-table/*.ts at
        // the v2 rebuild (PR #368) — same finding as above.
        patterns: ["src/core/capability-table.ts", "src/core/capability-data.ts", "src/wiring/capability-table/", "scripts/parity-check.js"],
        smokes: ["cli-mcp-parity-smoke.js", "cli-jsonmode-parity-smoke.js", "parity-doc-sync-smoke.js"]
    },
    {
        // Pre-rebuild this was the single flat mcp-surface module, which did not
        // survive the v2 cutover; the real current MCP surface is src/mcp/*.ts.
        patterns: ["src/mcp-server.ts", "src/mcp/"],
        smokes: ["mcp-surface-registry-smoke.js", "mcp-app-surface-smoke.js", "cli-mcp-parity-smoke.js"]
    },
    {
        patterns: ["src/shell/run-export.ts", "src/shell/run-export-cli.ts", "src/core/state/types.ts"],
        smokes: ["run-export-import-smoke.js", "run-export-restore-resume-smoke.js", "run-inspect-archive-smoke.js"]
    },
    {
        patterns: ["src/shell/pipeline-cli.ts", "src/shell/drive.ts", "src/shell/agent-config.ts"],
        smokes: ["quickstart-smoke.js", "quickstart-check-smoke.js", "agent-delegation-drive-smoke.js"]
    },
    {
        patterns: ["src/shell/telemetry-", "src/core/trust/telemetry-"],
        smokes: ["telemetry-ledger-smoke.js", "telemetry-attestation-smoke.js", "telemetry-verify-signatures-smoke.js"]
    },
    {
        patterns: ["src/shell/workbench", "ui/workbench/"],
        smokes: ["web-desktop-workbench-smoke.js"]
    },
    {
        patterns: ["src/shell/scheduler-io.ts", "src/shell/scheduling-io.ts"],
        smokes: ["schedule-routine-daemon-smoke.js", "sched-policy-validation-smoke.js"]
    },
    {
        patterns: [
            "src/core/multi-agent/", "src/shell/multi-agent-", "src/shell/topology-io.ts",
            "src/shell/coordinator-io.ts", "src/shell/evidence-reasoning.ts",
            "src/core/state/state-explosion/", "src/shell/state-explosion-cli.ts",
            "src/core/format/state-explosion-text.ts"
        ],
        smokes: [
            "multi-agent-runtime-core-smoke.js",
            "multi-agent-topologies-map-reduce-smoke.js",
            "multi-agent-topologies-debate-smoke.js",
            "multi-agent-topologies-judge-panel-smoke.js",
            "multi-agent-cli-mcp-surface-smoke.js",
            "blackboard-state-explosion-management-smoke.js"
        ]
    }
];
function optionEnabled(value) {
    if (value === undefined || value === false)
        return false;
    if (typeof value === "string" && ["", "0", "false", "no"].includes(value.toLowerCase()))
        return false;
    return true;
}
function npmCommand(cwd, script) {
    const source = detectSourceCheckout(cwd);
    const base = `npm run ${script}`;
    return source ? `${source.chdir}${base}` : base;
}
function nodeSmokeCommand(cwd, smoke) {
    const source = detectSourceCheckout(cwd);
    const base = `node test/${smoke}`;
    return source ? `${source.chdir}${base}` : base;
}
function detectSourceCheckout(cwd) {
    const resolved = node_path_1.default.resolve(cwd);
    const candidates = [resolved, node_path_1.default.join(resolved, "plugins", "cool-workflow")];
    for (const candidate of candidates) {
        try {
            const pkg = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(candidate, "package.json"), "utf8"));
            if (pkg.name === "cool-workflow") {
                return {
                    packageDir: candidate,
                    chdir: candidate === resolved ? "" : `cd ${shellQuote(node_path_1.default.relative(resolved, candidate) || ".")} && `
                };
            }
        }
        catch {
            /* keep looking */
        }
    }
    return undefined;
}
function shellQuote(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function buildDoctorOnramp(options = {}) {
    const cwd = node_path_1.default.resolve(options.cwd || process.cwd());
    const agentCommand = "--agent-command builtin:claude";
    const source = detectSourceCheckout(cwd);
    const onramp = {
        schemaVersion: 1,
        summary: source ? "start small, run the short gate while changing code, then run the full gate before release" : "Three steps: check your setup, run one review, read the report.",
        sections: [
            {
                id: "first-run",
                title: "First Run",
                summary: "Prove the tool, check the setup, then make one report.",
                actions: [
                    {
                        id: "demo",
                        title: "Prove tamper checks",
                        command: "cw demo tamper",
                        reason: "Shows the core trust check without an agent or a repo."
                    },
                    {
                        id: "demo-bundle",
                        title: "Prove portable checks",
                        command: "cw demo bundle",
                        reason: "Shows the bundle proof in one step — create, check, forge, detect. No agent needed."
                    },
                    {
                        id: "setup",
                        title: "Check setup",
                        command: "cw doctor --onramp",
                        reason: "Names local setup trouble before a run is made."
                    },
                    {
                        id: "dry-run",
                        title: "Check a real run",
                        command: `cw quickstart architecture-review --check --repo /path/to/repo --question "What are the main risks?" ${agentCommand}`,
                        reason: "Does no writes and no agent call; it checks inputs first."
                    },
                    {
                        id: "report",
                        title: "Make the report",
                        command: `cw quickstart architecture-review --repo /path/to/repo --question "What are the main risks?" ${agentCommand}`,
                        reason: "Runs the short user path: ask, run, verify, report."
                    },
                    {
                        id: "bundle",
                        title: "Make a bundle",
                        command: `cw quickstart architecture-review --repo /path/to/repo --question "What are the main risks?" ${agentCommand} --bundle`,
                        reason: "Seals a completed report into a portable file the receiver can check offline."
                    },
                    {
                        id: "verify-bundle",
                        title: "Check the bundle",
                        command: "cw report verify-bundle report.cwrun.json",
                        reason: "Checks the report bundle without the source repo or a .cw tree."
                    }
                ]
            },
            {
                id: "no-agent",
                title: "No Agent?",
                summary: "The demo steps above need no agent. A real report needs one. Pick and install one agent before the next step.",
                actions: [
                    {
                        id: "agent-claude",
                        title: "Claude Code (npm)",
                        command: "npm install -g @anthropic-ai/claude-code",
                        reason: "First-party Claude Code tool; CW works with Claude Code, Codex, Gemini CLI, and OpenCode."
                    },
                    {
                        id: "agent-check",
                        title: "Check agent setup",
                        command: "cw doctor",
                        reason: "Doctor names missing agent or setup trouble and tells you what to fix."
                    }
                ]
            },
            ...(source ? [
                {
                    id: "change-loop",
                    title: "Change Loop",
                    summary: "Use the small checks while changing code; save the slow full gate for the end.",
                    actions: [
                        {
                            id: "build",
                            title: "Type check the change",
                            command: npmCommand(cwd, "build"),
                            reason: "Fast first check for TypeScript errors."
                        },
                        {
                            id: "target-smoke",
                            title: "Run the closest smoke",
                            command: nodeSmokeCommand(cwd, "doctor-smoke.js"),
                            reason: "Replace this smoke name with the one that covers your changed path."
                        },
                        {
                            id: "fast-suite",
                            title: "Run the parallel suite",
                            command: npmCommand(cwd, "test:fast"),
                            reason: "Runs all smokes with isolated state and parallel workers."
                        }
                    ]
                },
                {
                    id: "surface-guard",
                    title: "Surface Guard",
                    summary: "Keep the wide runner, CLI, and MCP faces tied to one source.",
                    actions: [
                        {
                            id: "registry",
                            title: "Declare each new verb once",
                            command: npmCommand(cwd, "parity:check"),
                            reason: "Fails if CLI and MCP drift from the capability registry."
                        },
                        {
                            id: "manifest",
                            title: "Check generated faces",
                            command: npmCommand(cwd, "gen:manifests -- --check"),
                            reason: "Fails if plugin manifests drift from source."
                        }
                    ]
                },
                {
                    id: "release-gate",
                    title: "Release Gate",
                    summary: "Run the full gate only when the batch is ready.",
                    actions: [
                        {
                            id: "release-check",
                            title: "Dry-run the release gate",
                            command: npmCommand(cwd, "release:check"),
                            reason: "Builds, checks docs and generated files, runs the parallel suite, and makes no tag."
                        }
                    ]
                }
            ] : [])
        ]
    };
    if (options.changedFrom) {
        const changed = resolveChangedFiles({ cwd, changedFrom: options.changedFrom, env: options.env });
        const contract = evaluateOnrampContract(changed.files, { cwd, commentOnly: changed.commentOnly, deleteOnly: changed.deleteOnly });
        onramp.changedFiles = changed;
        onramp.contract = contract;
        onramp.recommendedChecks = {
            summary: contract.recommendedSmokeTests.length
                ? "run the closest smoke tests first, then the fast suite and release gate"
                : "no changed files were found; use the normal short checks",
            smokeTests: contract.recommendedSmokeTests,
            commands: contract.recommendedCommands
        };
    }
    return onramp;
}
/** Pure line test for "did this diff touch only comments/blanks". Takes the
 *  TEXT of a `git diff -U0 <base> -- <file>` patch (its `+`/`-` lines only
 *  matter; `+++`/`---` headers and `@@` hunk lines are skipped since they
 *  never start with a bare `+`/`-`). A trimmed line counts as a comment only
 *  when it STARTS WITH `//`, `/*`, `*` or `* /` -- checking the start, not
 *  whether the text merely contains `//`, is what keeps a string literal
 *  like `"http://x"` classed as code. No lines at all (or none that are
 *  code/comment) is NOT comment-only -- fail closed, same as the rest of
 *  this module. */
function isCommentOnlyPatch(patchText) {
    let sawLine = false;
    for (const raw of patchText.split(/\r?\n/)) {
        if (raw.startsWith("+++") || raw.startsWith("---"))
            continue;
        if (raw[0] !== "+" && raw[0] !== "-")
            continue;
        const trimmed = raw.slice(1).trim();
        sawLine = true;
        if (trimmed !== "" && !/^(\/\/|\/\*|\*\/|\*)/.test(trimmed))
            return false;
    }
    return sawLine;
}
/** Pure line test for "did this diff only remove code" (lets a type-only
 *  delete through the onramp gate). Same header-skip and comment-start test
 *  as isCommentOnlyPatch: a `+` line must be blank or a comment, and at
 *  least one `-` line must be real code. Empty patch, or a patch that only
 *  removes comments, is NOT delete-only -- fail closed. */
function isDeleteOnlyPatch(patchText) {
    let sawRemovedCode = false;
    for (const raw of patchText.split(/\r?\n/)) {
        if (raw.startsWith("+++") || raw.startsWith("---"))
            continue;
        if (raw[0] !== "+" && raw[0] !== "-")
            continue;
        const trimmed = raw.slice(1).trim();
        const isCode = trimmed !== "" && !/^(\/\/|\/\*|\*\/|\*)/.test(trimmed);
        if (raw[0] === "+" && isCode)
            return false;
        if (raw[0] === "-" && isCode)
            sawRemovedCode = true;
    }
    return sawRemovedCode;
}
function gitDiffPatch(cwd, baseRef, file) {
    const result = (0, node_child_process_1.spawnSync)("git", ["diff", "-U0", baseRef, "--", file], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
    return result.status === 0 ? String(result.stdout || "") : "";
}
function resolveChangedFiles(options = {}) {
    const cwd = node_path_1.default.resolve(options.cwd || process.cwd());
    const root = gitRoot(cwd);
    const baseRef = resolveBaseRef(root, options.changedFrom, options.env || process.env);
    const files = new Set();
    const candidates = new Map();
    for (const file of gitLinesOrThrow(root, ["diff", "--name-only", baseRef, "--"])) {
        const normalized = normalizeChangedPath(file);
        files.add(normalized);
        if (/\.(ts|js|mjs)$/.test(file))
            candidates.set(normalized, file);
    }
    for (const file of gitLinesOrThrow(root, ["ls-files", "--others", "--exclude-standard"])) {
        const normalized = normalizeChangedPath(file);
        files.add(normalized);
        candidates.delete(normalized); // an untracked file is never comment-only or delete-only
    }
    const commentOnly = [];
    const deleteOnly = [];
    for (const [normalized, raw] of candidates) {
        const patch = gitDiffPatch(root, baseRef, raw);
        if (isCommentOnlyPatch(patch))
            commentOnly.push(normalized);
        if (isDeleteOnlyPatch(patch))
            deleteOnly.push(normalized);
    }
    return {
        baseRef,
        files: [...files].filter(Boolean).sort(),
        commentOnly: commentOnly.sort(),
        deleteOnly: deleteOnly.sort()
    };
}
function evaluateOnrampContract(files, options = {}) {
    const cwd = node_path_1.default.resolve(options.cwd || process.cwd());
    const normalized = [...new Set(files.map((file) => normalizeChangedPath(file)).filter(Boolean))].sort();
    // A commentOnly file stays in `normalized` (changedFiles, smoke recs) but
    // is left out of the sets below that decide the runtime/app/type/script/
    // surface rules -- it never DID change behavior, so it can't trigger them.
    // A deleteOnly file that is also a type source gets the same treatment:
    // a pure delete of a declared field/type nothing reads has no new
    // behavior to prove.
    const commentOnlySet = new Set((options.commentOnly || []).map((file) => normalizeChangedPath(file)));
    const deleteOnlySet = new Set((options.deleteOnly || []).map((file) => normalizeChangedPath(file)));
    const classifiable = normalized.filter((file) => !commentOnlySet.has(file) && !(deleteOnlySet.has(file) && isTypeSource(file)));
    const issues = [];
    const runtimeFiles = classifiable.filter(isRuntimeSource);
    const appFiles = classifiable.filter((file) => file.startsWith("plugins/cool-workflow/apps/"));
    const typeFiles = classifiable.filter((file) => file.startsWith("plugins/cool-workflow/src/types/") && file.endsWith(".ts"));
    const surfaceFiles = classifiable.filter(isSurfaceFile);
    const smokeFiles = normalized.filter((file) => /^plugins\/cool-workflow\/test\/.+-smoke\.js$/.test(file));
    // WP1.1 (#360) restored a second, parallel test layer: pure `core/`
    // logic proven by `test/*.test.js` under `npm run test:unit`, run and
    // gated separately from the black-box `test/*-smoke.js` suite. A cycle
    // that proves its fix with a unit test only (no smoke touched) is a
    // real, complete cycle — the gate must accept either kind, not just
    // the one that existed before the unit-test layer came back.
    const unitTestFiles = normalized.filter((file) => /^plugins\/cool-workflow\/test\/.+\.test\.js$/.test(file));
    // The black-box conformance suite (v2/conformance/cases/*.case.js) is a
    // third, equally real proof layer — CI-gated on every push, and the one
    // North Star Track C leans on. A cycle proven end to end by a new or
    // changed conformance case (with no test/*-smoke.js or test/*.test.js
    // touched) is a real, complete cycle too.
    const conformanceCaseFiles = normalized.filter((file) => /^v2\/conformance\/cases\/.+\.case\.js$/.test(file));
    const docFiles = normalized.filter(isDocFile);
    if ((runtimeFiles.length > 0 || appFiles.length > 0) &&
        smokeFiles.length === 0 &&
        unitTestFiles.length === 0 &&
        conformanceCaseFiles.length === 0) {
        issues.push({
            code: "runtime-smoke-required",
            detail: "Runtime or app changes must include at least one smoke test change.",
            fix: "Add or update a focused test/*-smoke.js file for the changed behavior.",
            files: [...runtimeFiles, ...appFiles]
        });
    }
    if (typeFiles.length > 0 && runtimeFiles.length === 0 && appFiles.length === 0) {
        issues.push({
            code: "types-without-runtime",
            detail: "Type-only source changes are not a valid cycle.",
            fix: "Add the runtime behavior that reads the type, or remove the type-only change.",
            files: typeFiles
        });
    }
    if (surfaceFiles.length > 0 && docFiles.length === 0) {
        issues.push({
            code: "surface-docs-required",
            detail: "CLI, MCP, or capability surface changes must update public docs.",
            fix: "Update README.md or plugins/cool-workflow/docs/*.md with the changed surface.",
            files: surfaceFiles
        });
    }
    const recommendedSmokeTests = recommendSmokeTests(normalized, cwd);
    return {
        ok: issues.length === 0,
        changedFiles: normalized,
        recommendedSmokeTests,
        recommendedCommands: recommendedCommands(normalized, recommendedSmokeTests, cwd),
        issues
    };
}
function recommendSmokeTests(files, cwd = process.cwd()) {
    const normalized = files.map((file) => normalizeChangedPath(file));
    const smokes = new Set();
    const curatedFiles = new Set();
    for (const file of normalized) {
        const pluginPath = stripPluginPrefix(file);
        for (const entry of exports.CURATED_SMOKE_MAP) {
            const matched = entry.patterns.some((pattern) => pluginPath === pattern || pluginPath.startsWith(pattern));
            if (matched) {
                curatedFiles.add(file);
                for (const smoke of entry.smokes)
                    smokes.add(smoke);
            }
        }
    }
    const available = availableSmokeTests(cwd);
    for (const file of normalized) {
        if (curatedFiles.has(file))
            continue;
        const pluginPath = stripPluginPrefix(file);
        if (!pluginPath.startsWith("src/"))
            continue;
        const base = node_path_1.default.basename(pluginPath, ".ts");
        const direct = `${base}-smoke.js`;
        if (available.includes(direct))
            smokes.add(direct);
        const tokens = base.split(/[^a-zA-Z0-9]+/).filter((token) => token.length >= 3);
        for (const smoke of available) {
            if (tokens.some((token) => smoke.includes(token)))
                smokes.add(smoke);
        }
    }
    return [...smokes].sort();
}
function recommendedCommands(files, smokes, cwd) {
    const commands = new Set();
    commands.add(npmCommand(cwd, "build"));
    for (const smoke of smokes)
        commands.add(nodeSmokeCommand(cwd, smoke));
    commands.add(npmCommand(cwd, "test:fast"));
    if (files.some(isSurfaceFile))
        commands.add(npmCommand(cwd, "parity:check"));
    if (files.some(isSurfaceFile))
        commands.add(npmCommand(cwd, "gen:manifests -- --check"));
    commands.add(npmCommand(cwd, "release:check"));
    return [...commands];
}
function resolveBaseRef(root, changedFrom, env) {
    if (changedFrom)
        return verifyRef(root, changedFrom);
    if (env.CW_ONRAMP_BASE)
        return verifyRef(root, env.CW_ONRAMP_BASE);
    // A pull_request CI context sets GITHUB_BASE_REF, so a base ref is EXPECTED:
    // the diff must run against the PR's own base branch. If merge-base cannot
    // resolve there (a shallow clone that never fetched the base, a missing
    // origin ref), we must NOT quietly degrade to HEAD -- a HEAD..HEAD diff on a
    // clean, already-committed tree is empty, and an empty change set has no
    // issues, so onramp:check would report ok:true on a real, unseen change (the
    // same vacuous-pass class PR #446 closed one layer below). Fail closed.
    if (env.GITHUB_BASE_REF) {
        const baseBranch = `origin/${env.GITHUB_BASE_REF}`;
        const mergeBase = gitOne(root, ["merge-base", "HEAD", baseBranch]);
        if (mergeBase)
            return mergeBase;
        throw new Error(`onramp: cannot resolve a base ref -- git merge-base HEAD ${baseBranch} found no common commit (fail closed, not treated as zero changes). Fetch the base branch with a full (non-shallow) clone, or pass --changed-from / CW_ONRAMP_BASE.`);
    }
    // No base ref was requested (--changed-from / CW_ONRAMP_BASE) or expected
    // (GITHUB_BASE_REF): this is the local "show my own changes" use. merge-base
    // against origin/main narrows the diff to this branch's commits when the
    // remote is present; with no remote we fall back to HEAD so `git diff HEAD`
    // still surfaces the working-tree (uncommitted) changes.
    const mergeBase = gitOne(root, ["merge-base", "HEAD", "origin/main"]);
    if (mergeBase)
        return mergeBase;
    return verifyRef(root, "HEAD");
}
function verifyRef(root, ref) {
    if (ref.startsWith("-"))
        throw new Error(`Invalid onramp base ref (must not start with '-'): ${ref}`);
    const resolved = gitOne(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
    if (!resolved)
        throw new Error(`Unknown onramp base ref: ${ref}`);
    return ref;
}
function gitRoot(cwd) {
    return gitOne(node_path_1.default.resolve(cwd), ["rev-parse", "--show-toplevel"]) || node_path_1.default.resolve(cwd);
}
/** True when `cwd` is inside a git work tree (same spawn/timeout behavior as gitRoot). */
function isGitWorkTree(cwd) {
    return gitOne(node_path_1.default.resolve(cwd), ["rev-parse", "--is-inside-work-tree"]) === "true";
}
// Every onramp git call is a quick metadata read (rev-parse, merge-base, diff
// --name-only, ls-files). A finite timeout keeps a HUNG git -- a cold fsmonitor
// daemon, a credential prompt on a misconfigured remote -- from blocking the
// gate forever; 5s matches the git-metadata timeout already used in
// shell/commit.ts and shell/doctor.ts. On a timeout spawnSync sets
// `result.error` (and a null status), so gitLinesOrThrow fails closed while
// gitLines/gitOne fall back the same way they do for any other git failure.
const GIT_TIMEOUT_MS = 5000;
function gitLines(cwd, args) {
    const result = (0, node_child_process_1.spawnSync)("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
    if (result.status !== 0)
        return [];
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
/** Same as gitLines, but a failed git invocation THROWS instead of silently
 *  becoming []. resolveChangedFiles must never mistake "git could not run
 *  this diff" for "there is nothing to diff" -- that turns a transient git
 *  failure into a vacuous onramp-contract pass (a 2026-07-12 security audit
 *  finding: a broken base ref or a git error made the changed-file set
 *  empty, and an empty set has no issues, so the gate reported ok:true on a
 *  real, unseen change). Callers that WANT a soft fallback (merge-base
 *  probing, optional discovery) should keep using gitLines/gitOne. */
function gitLinesOrThrow(cwd, args) {
    const result = (0, node_child_process_1.spawnSync)("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
    if (result.error)
        throw new Error(`onramp: git ${args.join(" ")} failed to run: ${result.error.message}`);
    if (result.status !== 0) {
        throw new Error(`onramp: git ${args.join(" ")} exited ${result.status} -- cannot resolve changed files (fail closed, not treated as zero changes): ${String(result.stderr || "").trim()}`);
    }
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function gitOne(cwd, args) {
    return gitLines(cwd, args)[0] || "";
}
function availableSmokeTests(cwd) {
    const source = detectSourceCheckout(cwd);
    const testDir = source ? node_path_1.default.join(source.packageDir, "test") : node_path_1.default.join(node_path_1.default.resolve(cwd), "test");
    try {
        return node_fs_1.default.readdirSync(testDir).filter((file) => file.endsWith("-smoke.js")).sort();
    }
    catch {
        return [];
    }
}
function normalizeChangedPath(file) {
    const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
    // "docs" is deliberately absent from this list: the last real repo-root docs/
    // directory moved to plugins/cool-workflow/project/docs/ in the 2026-08-04 root
    // consolidation, so no git-diff path starts with bare "docs/" anymore. Rewriting
    // one to plugins/cool-workflow/docs/ (the separate, still-in-place man-page tree)
    // would silently mislabel it.
    if (/^(src|apps|scripts|test|dist|manifest|ui|workflows)\//.test(normalized)) {
        return `plugins/cool-workflow/${normalized}`;
    }
    return normalized;
}
function stripPluginPrefix(file) {
    return file.startsWith("plugins/cool-workflow/") ? file.slice("plugins/cool-workflow/".length) : file;
}
function isRuntimeSource(file) {
    return file.startsWith("plugins/cool-workflow/src/") && file.endsWith(".ts") && !file.startsWith("plugins/cool-workflow/src/types/");
}
// A "type source" is the src/types/ tree, the src/core/types/ tree, or a
// file under src/ named types.ts.
function isTypeSource(file) {
    const pluginPath = stripPluginPrefix(file);
    if (!pluginPath.startsWith("src/") || !pluginPath.endsWith(".ts"))
        return false;
    return (pluginPath.startsWith("src/types/") ||
        pluginPath.startsWith("src/core/types/") ||
        node_path_1.default.basename(pluginPath) === "types.ts");
}
// Pre-rebuild flat literals here (capability-registry module, mcp-surface module,
// orchestrator module) named files that no longer exist anywhere in the
// tree after the v2 core/shell/wiring split — capability-registry.ts
// became core/capability-table.ts + core/capability-data.ts +
// wiring/capability-table/*.ts (PR #368), mcp-surface.ts became mcp/*.ts,
// and orchestrator.ts moved to shell/orchestrator.ts. Real, current
// capability/MCP surface changes were silently invisible to this check,
// so they skipped both "surface-docs-required" and the parity:check/
// gen:manifests hint below (self-audit-cool-workflow-v0.2.6.md P2).
function isSurfaceFile(file) {
    const pluginPath = stripPluginPrefix(file);
    return (pluginPath === "src/cli.ts" ||
        pluginPath.startsWith("src/cli/") ||
        pluginPath === "src/mcp-server.ts" ||
        pluginPath.startsWith("src/mcp/") ||
        pluginPath === "src/core/capability-table.ts" ||
        pluginPath === "src/core/capability-data.ts" ||
        pluginPath.startsWith("src/wiring/capability-table/") ||
        pluginPath === "src/shell/orchestrator.ts" ||
        pluginPath === "scripts/parity-check.js");
}
function isDocFile(file) {
    // "surface-docs-required" means the SHIPPED surface (README.md, the man-page tree
    // under plugins/cool-workflow/docs/) — see its fix message below. Repo-internal
    // engineering docs (plugins/cool-workflow/project/docs/) never satisfy it; they are
    // not public docs. A bare "docs/" branch used to sit here, but normalizeChangedPath
    // rewrites any bare top-level "docs/..." path before this function ever sees it, so
    // it was already dead code even before the 2026-08-04 root consolidation removed the
    // last real repo-root docs/ directory it could have matched.
    return (file === "README.md" ||
        file === "plugins/cool-workflow/README.md" ||
        file.startsWith("plugins/cool-workflow/docs/"));
}
