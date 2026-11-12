// css-framework-gate-smoke — the CSS gate from ~/Developer/TECH-SPEC.md
// section 5, as it applies to the one CSS input left in the tree:
// scripts/report.css, built by scripts/build-css.mjs into the sheet
// report.html carries. One gate(root) function, one list of faults,
// source-text only. The last part copies a bad tree into a temp dir and
// checks the gate reports every fault it plants.
//
// Named exception for the whole gate: src/core/format/report-html.ts writes
// one inline <style> on purpose (TECH-SPEC section 7, the one offline HTML
// report file).
// @cw-smoke: tags css,gate,shell
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers/workspace.mjs";

const PINS = { tailwindcss: "4.3.3", daisyui: "5.7.42" };
// Second UI library (TECH-SPEC section 5) or a framework, anchored so
// "vite" never matches "vitest".
const BANNED = /^(@mantine\/|@heroui\/|@mui\/|antd$|element-plus$|primevue$|vuetify$|bootstrap$|vue$|nuxt$|svelte$|@angular\/|solid-js$|preact$|vite$)/;
const ENTRY = path.join("scripts", "report.css");

function readIfExists(root, relative) {
  const p = path.join(root, relative);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Every fault the gate finds in one plugin tree, as strings. */
function gate(root) {
  const faults = [];

  // ---- package.json: no second framework/UI library; the exact pins ----
  const raw = readIfExists(root, "package.json");
  if (raw) {
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      if (BANNED.test(name)) faults.push(`package.json: second framework or UI library: ${name}`);
    }
    for (const [name, pin] of Object.entries(PINS)) {
      if (name in deps && deps[name] !== pin) faults.push(`package.json: ${name} is ${deps[name]}, pin is ${pin}`);
    }
  }

  // ---- the one CSS entry file holds only @-rule blocks ------------------
  const entry = readIfExists(root, ENTRY);
  if (!entry) {
    faults.push(`missing ${ENTRY}`);
  } else {
    const stripped = entry.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of stripped.matchAll(/([^{};]+)\{/g)) {
      const head = m[1].trim();
      if (!/^@(import|plugin|theme|source|layer)\b/.test(head)) faults.push(`selector block in entry file: ${head}`);
    }
    if (/fonts\.googleapis\.com/.test(entry)) faults.push(`${ENTRY}: font host URL (fonts.googleapis.com)`);
  }

  return faults;
}

const root = path.resolve(import.meta.dirname, "..");
assert.deepStrictEqual(gate(root), [], "the plugin tree must pass the CSS gate");

// The dark ground is one value in three places: the theme block, the report
// sheet built from it, and the report's theme-color tag. They must stay in
// step.
const ground = readIfExists(root, ENTRY).match(/--color-base-100:\s*(#[0-9a-f]{6})/i)[1];
for (const f of ["src/core/format/report-css.ts", "src/core/format/report-html.ts"]) {
  assert.ok(readIfExists(root, f).includes(ground), `${f} must carry the dark ground ${ground}`);
}

// The gate must still bite: a bad copy in a temp dir goes red on every fault
// it plants (one representative case per check).
const tmp = tmpDir("cw-css-gate-");
fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, "package.json"),
  JSON.stringify({ devDependencies: { tailwindcss: "4.0.0", daisyui: PINS.daisyui, "@mantine/core": "9.0.0", vue: "3.5.0" } })
);
fs.writeFileSync(path.join(tmp, ENTRY), '@import "tailwindcss";\n@import url("https://fonts.googleapis.com/x");\n.btn { color: red; }\n');
const red = gate(tmp);
fs.rmSync(tmp, { recursive: true, force: true });

function bit(substring) {
  assert.ok(red.some((f) => f.includes(substring)), `gate must report a fault containing "${substring}"; got:\n${red.join("\n")}`);
}
bit("second framework or UI library: @mantine/core");
bit("second framework or UI library: vue");
bit("tailwindcss is 4.0.0, pin is 4.3.3");
bit("selector block in entry file: .btn");
bit("font host URL");
assert.ok(gate(path.join(tmp, "missing")).includes(`missing ${ENTRY}`), "a tree without the entry file is a fault");
console.log(`css-framework-gate-smoke: PASS (${red.length} faults bitten in the bad copy)`);
