#!/usr/bin/env node
"use strict";

// Generate every vendor plugin manifest from a single source of truth.
//
//   node scripts/gen-manifests.js            # write generated manifests
//   node scripts/gen-manifests.js --check    # fail (exit 1) if any drift
//
// Mechanism vs policy (BSD discipline): the shared assets (skills/, dist/,
// apps/, the MCP server) live once; each vendor manifest is a thin, generated
// adapter. Edit manifest/plugin.manifest.json, never the generated files.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const SOURCE = path.join(pluginRoot, "manifest", "plugin.manifest.json");

function loadSource() {
  assert.ok(fs.existsSync(SOURCE), `source of truth missing: ${rel(SOURCE)}`);
  return JSON.parse(fs.readFileSync(SOURCE, "utf8"));
}

function build(src) {
  const { identity, descriptions, interface: ui, layout, mcp, targets } = src;
  const outputs = [];

  // ---- Claude Code -------------------------------------------------------
  outputs.push({
    path: targets.claude.marketplace,
    json: {
      name: identity.name,
      owner: identity.author,
      metadata: { description: descriptions.standard, version: identity.version },
      plugins: [
        {
          name: identity.name,
          source: layout.pluginPathFromRepoRoot,
          description: descriptions.standard,
          category: ui.category.toLowerCase()
        }
      ]
    }
  });
  outputs.push({
    path: targets.claude.plugin,
    json: {
      name: identity.name,
      description: descriptions.standard,
      version: identity.version,
      author: identity.author,
      homepage: identity.homepage,
      license: identity.license,
      keywords: identity.keywords
    }
  });
  outputs.push({
    path: targets.claude.mcp,
    json: mcpConfig(mcp, layout, targets.claude.pluginRootVar)
  });

  // ---- Codex / .agents ---------------------------------------------------
  outputs.push({
    path: targets.codex.marketplace,
    json: {
      name: identity.name,
      interface: { displayName: ui.displayName },
      plugins: [
        {
          name: identity.name,
          source: { source: "local", path: layout.pluginPathFromRepoRoot },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: ui.category
        }
      ]
    }
  });
  outputs.push({
    path: targets.codex.plugin,
    json: {
      name: identity.name,
      version: identity.version,
      description: descriptions.standard,
      author: identity.author,
      keywords: identity.keywords,
      skills: layout.skillsDir,
      mcpServers: "./.codex-plugin/mcp.json",
      interface: {
        displayName: ui.displayName,
        shortDescription: descriptions.short,
        longDescription: descriptions.long,
        developerName: identity.author.name,
        category: ui.category,
        capabilities: ui.capabilities,
        brandColor: ui.brandColor,
        defaultPrompt: ui.defaultPrompt
      }
    }
  });
  outputs.push({
    path: targets.codex.mcp,
    json: mcpConfig(mcp, layout, targets.codex.pluginRootVar)
  });

  return outputs;
}

function mcpConfig(mcp, layout, pluginRootVar) {
  return {
    mcpServers: {
      [mcp.serverName]: {
        command: mcp.command,
        args: [`${pluginRootVar}${layout.mcpServerScript}`]
      }
    }
  };
}

function serialize(json) {
  return `${JSON.stringify(json, null, 2)}\n`;
}

function rel(absolute) {
  return path.relative(repoRoot, absolute);
}

function main() {
  const check = process.argv.includes("--check");
  const outputs = build(loadSource());
  const results = [];
  const drift = [];

  for (const output of outputs) {
    const absolute = path.join(repoRoot, output.path);
    const next = serialize(output.json);
    if (check) {
      const current = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
      const ok = current === next;
      if (!ok) drift.push(output.path);
      results.push({ path: output.path, ok, status: current === null ? "missing" : ok ? "in-sync" : "drift" });
    } else {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, next);
      results.push({ path: output.path, status: "written" });
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: drift.length === 0, mode: check ? "check" : "write", results }, null, 2)}\n`);

  if (check && drift.length > 0) {
    process.stderr.write(
      `\n${drift.length} generated manifest(s) drifted from manifest/plugin.manifest.json:\n` +
        drift.map((p) => `  - ${p}`).join("\n") +
        `\nRun \`npm run gen:manifests\` and commit the result.\n`
    );
    process.exitCode = 1;
  }
}

main();
