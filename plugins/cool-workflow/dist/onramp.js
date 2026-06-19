"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionEnabled = optionEnabled;
exports.npmCommand = npmCommand;
exports.nodeSmokeCommand = nodeSmokeCommand;
exports.detectSourceCheckout = detectSourceCheckout;
exports.shellQuote = shellQuote;
exports.buildDoctorOnramp = buildDoctorOnramp;
exports.resolveChangedFiles = resolveChangedFiles;
exports.evaluateOnrampContract = evaluateOnrampContract;
exports.recommendSmokeTests = recommendSmokeTests;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const CURATED_SMOKE_MAP = [
    {
        patterns: ["src/doctor.ts", "src/onramp.ts", "scripts/onramp-check.js"],
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
        patterns: ["src/orchestrator.ts"],
        smokes: ["cli-mcp-parity-smoke.js"]
    },
    {
        patterns: ["src/capability-registry.ts", "scripts/parity-check.js"],
        smokes: ["cli-mcp-parity-smoke.js", "cli-jsonmode-parity-smoke.js", "parity-doc-sync-smoke.js"]
    },
    {
        patterns: ["src/mcp-server.ts", "src/mcp-surface.ts"],
        smokes: ["mcp-surface-registry-smoke.js", "mcp-app-surface-smoke.js", "cli-mcp-parity-smoke.js"]
    },
    {
        patterns: ["src/run-export.ts", "src/types/run.ts"],
        smokes: ["run-export-import-smoke.js", "run-export-restore-resume-smoke.js", "run-inspect-archive-smoke.js"]
    },
    {
        patterns: ["src/capability-core.ts", "src/drive.ts", "src/agent-config.ts"],
        smokes: ["quickstart-smoke.js", "quickstart-check-smoke.js", "agent-delegation-drive-smoke.js"]
    },
    {
        patterns: ["src/telemetry", "src/worker-accept/telemetry"],
        smokes: ["telemetry-ledger-smoke.js", "telemetry-attestation-smoke.js", "telemetry-verify-signatures-smoke.js"]
    },
    {
        patterns: ["src/workbench", "ui/workbench/"],
        smokes: ["web-desktop-workbench-smoke.js"]
    },
    {
        patterns: ["src/scheduler.ts", "src/scheduling.ts", "src/daemon.ts", "src/triggers.ts"],
        smokes: ["schedule-routine-daemon-smoke.js", "sched-policy-validation-smoke.js"]
    },
    {
        patterns: ["src/multi-agent", "src/topology.ts", "src/coordinator", "src/evidence-reasoning.ts", "src/state-explosion"],
        smokes: [
            "multi-agent-runtime-core-smoke.js",
            "multi-agent-topologies-smoke.js",
            "multi-agent-cli-mcp-surface-smoke.js",
            "state-explosion-management-smoke.js"
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
    const onramp = {
        schemaVersion: 1,
        summary: "start small, run the short gate while changing code, then run the full gate before release",
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
        ]
    };
    if (options.changedFrom) {
        const changed = resolveChangedFiles({ cwd, changedFrom: options.changedFrom, env: options.env });
        const contract = evaluateOnrampContract(changed.files, { cwd });
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
function resolveChangedFiles(options = {}) {
    const cwd = node_path_1.default.resolve(options.cwd || process.cwd());
    const root = gitRoot(cwd);
    const baseRef = resolveBaseRef(root, options.changedFrom, options.env || process.env);
    const files = new Set();
    for (const file of gitLines(root, ["diff", "--name-only", baseRef, "--"]))
        files.add(normalizeChangedPath(file));
    for (const file of gitLines(root, ["ls-files", "--others", "--exclude-standard"]))
        files.add(normalizeChangedPath(file));
    return { baseRef, files: [...files].filter(Boolean).sort() };
}
function evaluateOnrampContract(files, options = {}) {
    const cwd = node_path_1.default.resolve(options.cwd || process.cwd());
    const normalized = [...new Set(files.map((file) => normalizeChangedPath(file)).filter(Boolean))].sort();
    const issues = [];
    const runtimeFiles = normalized.filter(isRuntimeSource);
    const appFiles = normalized.filter((file) => file.startsWith("plugins/cool-workflow/apps/"));
    const typeFiles = normalized.filter((file) => file.startsWith("plugins/cool-workflow/src/types/") && file.endsWith(".ts"));
    const scriptFiles = normalized.filter((file) => file.startsWith("plugins/cool-workflow/scripts/"));
    const surfaceFiles = normalized.filter(isSurfaceFile);
    const smokeFiles = normalized.filter((file) => /^plugins\/cool-workflow\/test\/.+-smoke\.js$/.test(file));
    const docFiles = normalized.filter(isDocFile);
    const iterationFiles = normalized.filter((file) => file === "ITERATION_LOG.md");
    const sourceAppOrScript = runtimeFiles.length > 0 || typeFiles.length > 0 || appFiles.length > 0 || scriptFiles.length > 0;
    if ((runtimeFiles.length > 0 || appFiles.length > 0) && smokeFiles.length === 0) {
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
    if (sourceAppOrScript && iterationFiles.length === 0) {
        issues.push({
            code: "iteration-log-required",
            detail: "Source, app, or script changes must be recorded in ITERATION_LOG.md.",
            fix: "Append one cycle row with goal, files, tests, gate, and tag decision.",
            files: [...runtimeFiles, ...typeFiles, ...appFiles, ...scriptFiles]
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
        for (const entry of CURATED_SMOKE_MAP) {
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
    const baseBranch = env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/main";
    const mergeBase = gitOne(root, ["merge-base", "HEAD", baseBranch]);
    if (mergeBase)
        return mergeBase;
    return verifyRef(root, "HEAD");
}
function verifyRef(root, ref) {
    const resolved = gitOne(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
    if (!resolved)
        throw new Error(`Unknown onramp base ref: ${ref}`);
    return ref;
}
function gitRoot(cwd) {
    return gitOne(node_path_1.default.resolve(cwd), ["rev-parse", "--show-toplevel"]) || node_path_1.default.resolve(cwd);
}
function gitLines(cwd, args) {
    const result = (0, node_child_process_1.spawnSync)("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0)
        return [];
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
    if (/^(src|apps|scripts|test|docs|dist|manifest|ui|workflows)\//.test(normalized)) {
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
function isSurfaceFile(file) {
    const pluginPath = stripPluginPrefix(file);
    return (pluginPath === "src/cli.ts" ||
        pluginPath.startsWith("src/cli/") ||
        pluginPath === "src/capability-registry.ts" ||
        pluginPath === "src/mcp-server.ts" ||
        pluginPath === "src/mcp-surface.ts" ||
        pluginPath === "src/orchestrator.ts" ||
        pluginPath === "scripts/parity-check.js");
}
function isDocFile(file) {
    return (file === "README.md" ||
        file === "CHANGELOG.md" ||
        file === "RELEASE.md" ||
        file.startsWith("docs/") ||
        file === "plugins/cool-workflow/README.md" ||
        file.startsWith("plugins/cool-workflow/docs/"));
}
