// css-framework-gate-smoke — the CSS gate from ~/Developer/TECH-SPEC.md
// section 5 (every project under Developer keeps it). Source-text only.
// Red when: a second UI library is in package.json; a .css file exists
// outside the one entry file (the built app.css is the one named
// exception); the entry file has a block that is not an at-rule; or
// tailwindcss / daisyui is not the exact pin. The last part copies a bad
// tree into a temp dir and checks the gate goes red there.
// @cw-smoke: tags css,gate
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PINS = { tailwindcss: "4.3.3", daisyui: "5.7.28" };
// UI libraries from TECH-SPEC section 5, plus HTML frameworks from its
// 6b row: the workbench is the named plain-HTML exception, so none of them.
const BANNED = /^(@mantine\/|@heroui\/|@mui\/|antd$|element-plus$|primevue$|vuetify$|bootstrap$|react$|react-dom$|next$|vue$|nuxt$|svelte$|@angular\/|solid-js$|preact$)/;
const ENTRY = path.join("ui", "workbench", "app.src.css");
const BUILT = path.join("ui", "workbench", "app.css");
const SKIP = new Set(["node_modules", "dist", ".git", ".cw", "tmp"]);

function cssFiles(dir, root = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p, root));
    else if (e.name.endsWith(".css")) out.push(path.relative(root, p));
  }
  return out;
}

/** Every fault the gate finds in one plugin tree, as strings. */
function gate(root) {
  const faults = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) if (BANNED.test(name)) faults.push(`UI library or HTML framework: ${name}`);
  for (const [name, pin] of Object.entries(PINS)) if (deps[name] !== pin) faults.push(`${name} is ${deps[name]}, pin is ${pin}`);
  for (const f of cssFiles(root)) if (f !== ENTRY && f !== BUILT) faults.push(`css outside the entry file: ${f}`);
  const entry = fs.readFileSync(path.join(root, ENTRY), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // A block is "<head> {"; every head must be one of the allowed at-rules.
  for (const m of entry.matchAll(/([^{};]+)\{/g)) {
    const head = m[1].trim();
    if (!/^@(import|plugin|theme|source|layer)\b/.test(head)) faults.push(`selector block in entry file: ${head}`);
  }
  return faults;
}

const root = path.resolve(__dirname, "..");
assert.deepStrictEqual(gate(root), [], "the plugin tree must pass the CSS gate");

// The gate must still bite: a bad copy in a temp dir goes red on all four.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-css-gate-"));
fs.mkdirSync(path.join(tmp, "ui", "workbench"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ devDependencies: { tailwindcss: "4.0.0", daisyui: PINS.daisyui, "@mantine/core": "9.0.0" } }));
fs.writeFileSync(path.join(tmp, ENTRY), '@import "tailwindcss";\n.btn { color: red; }\n');
fs.writeFileSync(path.join(tmp, "ui", "extra.css"), "");
const red = gate(tmp);
fs.rmSync(tmp, { recursive: true, force: true });
assert.strictEqual(red.length, 4, red.join("\n"));
console.log("css-framework-gate-smoke: PASS");
