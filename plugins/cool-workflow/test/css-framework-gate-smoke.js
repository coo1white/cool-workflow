// css-framework-gate-smoke — the CSS gate from ~/Developer/TECH-SPEC.md
// section 5, PLUS the Next-app checks from
// ~/Developer/sdlc/unify-js-architecture/spec.md section 2.9, PLUS the
// HTML-shell gate from TECH-SPEC section 2b.7. One gate(root) function, one
// list of faults, source-text only. The last part copies a bad tree into a
// temp dir and checks the gate reports every fault it plants.
//
// Named exception for the whole gate: src/core/format/report-html.ts writes
// one inline <style> on purpose (TECH-SPEC section 7, the one offline HTML
// report file) — it lives under the plugin's own src/, not ui/workbench/,
// so none of the checks below ever look at it.
//
// TECH-SPEC 2b.7 checks 7, 8 and 9 land on a large existing tree and start
// with a named exception list; the list is empty today (nothing fails).
// @cw-smoke: tags css,gate,shell
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PINS = { tailwindcss: "4.3.3", daisyui: "5.7.28" };
// react/react-dom/next only live in the sub-package, but pin exact when present.
const PINS_IF_PRESENT = { react: "19.2.8", "react-dom": "19.2.8", next: "16.3.0" };
// Second UI library (TECH-SPEC section 5) + second framework (spec.md 2.9),
// anchored so "vite" never matches "vitest".
const BANNED = /^(@mantine\/|@heroui\/|@mui\/|antd$|element-plus$|primevue$|vuetify$|bootstrap$|vue$|nuxt$|svelte$|@angular\/|solid-js$|preact$|vite$)/;
const WB = path.join("ui", "workbench");
const ENTRY = path.join(WB, "app", "globals.css");
const LAYOUT = path.join(WB, "app", "layout.tsx");
const SHELL = path.join(WB, "src", "next-shell", "shell.tsx");
const NAV_ITEMS = path.join(WB, "src", "next-nav-items.ts");
// out/.next are build output, like dist: never scanned by hand.
const SKIP = new Set(["node_modules", "dist", ".git", ".cw", "tmp", ".next", "out"]);
// TECH-SPEC 2b.7 check 9's centring allow-list: a physical utility used only
// to centre something (left-1/2 -translate-x-1/2), not to set text/box
// direction.
const CENTRING = /left-1\/2[^"'`]*-translate-x-1\/2|-translate-x-1\/2[^"'`]*left-1\/2/;
// Named exception list for checks 7 (one <h1>), 8 (table wrapper) and 9
// (physical direction utilities): relative path -> one-line reason. Empty —
// keep it that way; a new entry needs a reason, and the list may only
// shrink (TECH-SPEC 2b.7).
const NAMED_EXCEPTIONS = {};

function walk(dir, root, test) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, root, test));
    else if (test(e.name)) out.push(path.relative(root, p));
  }
  return out;
}

function readIfExists(root, relative) {
  const p = path.join(root, relative);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// app/ and src/ are the only two directories every check below scans.
function walkAppAndSrc(root, test) {
  return walk(path.join(root, WB, "app"), root, test).concat(walk(path.join(root, WB, "src"), root, test));
}

// Comments read like markup to a source-text regex (a "<html>" mentioned in
// a // note reads as a tag); strip both comment forms before scanning. The
// negative lookbehind keeps a "https://" URL intact (":" never precedes a
// real line-comment "//").
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/** Every fault the gate finds in one plugin tree, as strings. */
function gate(root) {
  const faults = [];
  const except = (relative) => relative in NAMED_EXCEPTIONS;

  // ---- package.json: second framework/UI library in either one; the exact
  //      pins only where each package actually declares them -------------
  for (const pkgRelative of [path.join(WB, "package.json"), "package.json"]) {
    const raw = readIfExists(root, pkgRelative);
    if (!raw) continue;
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      if (BANNED.test(name)) faults.push(`${pkgRelative}: second framework or UI library: ${name}`);
    }
    const pins = pkgRelative === path.join(WB, "package.json") ? { ...PINS, ...PINS_IF_PRESENT } : PINS;
    for (const [name, pin] of Object.entries(pins)) {
      if (name in deps && deps[name] !== pin) faults.push(`${pkgRelative}: ${name} is ${deps[name]}, pin is ${pin}`);
    }
  }

  // ---- one CSS entry file, and only @-rule blocks inside it -------------
  for (const f of walkAppAndSrc(root, (n) => n.endsWith(".css"))) {
    if (f !== ENTRY) faults.push(`css outside the entry file: ${f}`);
  }
  const entry = readIfExists(root, ENTRY);
  if (entry) {
    const stripped = entry.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of stripped.matchAll(/([^{};]+)\{/g)) {
      const head = m[1].trim();
      if (!/^@(import|plugin|theme|source|layer)\b/.test(head)) faults.push(`selector block in entry file: ${head}`);
    }
  }

  // ---- the shell files must exist ---------------------------------------
  if (!fs.existsSync(path.join(root, SHELL))) faults.push(`missing ${SHELL}`);
  if (!fs.existsSync(path.join(root, NAV_ITEMS))) faults.push(`missing ${NAV_ITEMS}`);

  // ---- layout.tsx: theme script, font vars, metadata/viewport, head rules
  const layoutRaw = readIfExists(root, LAYOUT);
  const layout = layoutRaw && stripComments(layoutRaw);
  if (!layout) {
    faults.push(`missing ${LAYOUT}`);
  } else {
    if (!/data-theme/.test(layout) || !/beforeInteractive|dangerouslySetInnerHTML/.test(layout)) {
      faults.push(`${LAYOUT}: missing the theme boot script`);
    }
    for (const v of ["--font-montserrat", "--font-unbounded", "--font-fira-mono"]) {
      if (!layout.includes(v)) faults.push(`${LAYOUT}: missing font variable ${v}`);
    }
    if (!/export const metadata\b/.test(layout)) faults.push(`${LAYOUT}: missing the metadata export`);
    if (!/export const viewport\b/.test(layout)) faults.push(`${LAYOUT}: missing the viewport export`);
    if (!/description:/.test(layout)) faults.push(`${LAYOUT}: missing a description`);
    if (!/icons:/.test(layout) && !/rel=["']icon["']/.test(layout)) faults.push(`${LAYOUT}: missing the favicon`);
    if (!/prefers-color-scheme:\s*dark/.test(layout) || !/prefers-color-scheme:\s*light/.test(layout)) {
      faults.push(`${LAYOUT}: missing one of the two theme-color lines`);
    }
    if (/<style[\s>]/.test(layout)) faults.push(`${LAYOUT}: inline <style> in <head>`);
    const htmlTags = layout.match(/<html\b[^>]*>/g) || [];
    for (const tag of htmlTags) {
      if (!/\blang=/.test(tag) || !/\bdir=/.test(tag)) faults.push(`${LAYOUT}: <html> must set lang and dir together, in one file`);
    }
    // charset has no source-level knob in Next's metadata API (it is always
    // emitted); nothing to check here (a check with no way to fail is not a
    // check — verified once by hand against the built out/index.html).
  }

  // ---- no font host URL, anywhere in the tree ---------------------------
  for (const f of walk(path.join(root, WB), root, (n) => /\.(tsx?|css|html)$/.test(n))) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    if (/fonts\.googleapis\.com/.test(text)) faults.push(`${f}: font host URL (fonts.googleapis.com)`);
    if (/next\/font\/google/.test(text)) faults.push(`${f}: next/font/google import`);
  }

  // ---- the shell files carry the landmarks ------------------------------
  const shellRaw = readIfExists(root, SHELL);
  const shell = shellRaw && stripComments(shellRaw);
  if (shell) {
    for (const [needle, label] of [['id="main"', 'id="main"'], ['href="#main"', 'the #main skip link'], ["<main", "a <main"], ["<footer", "a <footer"]]) {
      if (!shell.includes(needle)) faults.push(`${SHELL}: missing ${label}`);
    }
  }

  // ---- at most one <h1> per page file, data-theme values, table wrapper,
  //      physical direction utilities ------------------------------------
  for (const f of walkAppAndSrc(root, (n) => /\.tsx?$/.test(n))) {
    const text = stripComments(fs.readFileSync(path.join(root, f), "utf8"));
    if (path.basename(f) === "page.tsx") {
      const h1s = text.match(/<h1[\s>]/g) || [];
      if (h1s.length > 1 && !except(f)) faults.push(`${f}: more than one <h1>`);
    }
    // Literal data-theme values only (a computed/ternary value, as layout.tsx
    // and header-controls.tsx use, is not analyzed by a source-text gate).
    for (const m of text.matchAll(/data-theme=\{?["']([\w-]+)["']\}?/g)) {
      if (!["cool-dark", "cool-light"].includes(m[1]) && !except(f)) faults.push(`${f}: data-theme="${m[1]}" is not cool-dark/cool-light`);
    }
    for (const m of text.matchAll(/<([a-zA-Z]+)\b[^>]*\sdata-theme=/g)) {
      if (m[1] !== "html" && !except(f)) faults.push(`${f}: data-theme set on <${m[1]}>, not the root`);
    }
    for (const idx of [...text.matchAll(/<table\b/g)].map((m) => m.index)) {
      const before = text.slice(Math.max(0, idx - 400), idx);
      if (!before.includes("overflow-x-auto") && !except(f)) faults.push(`${f}: <table> with no overflow-x-auto wrapper`);
    }
    for (const m of text.matchAll(/\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)[\w/[\]%.-]*/g)) {
      const window = text.slice(Math.max(0, m.index - 40), m.index + 40);
      if (!CENTRING.test(window) && !except(f)) faults.push(`${f}: physical direction utility ${m[0]}`);
    }
  }

  return faults;
}

const root = path.resolve(__dirname, "..");
assert.deepStrictEqual(gate(root), [], "the plugin tree must pass the CSS + shell gate");

// The dark ground is one value in three places: the theme block, the report
// sheet built from it, and the two theme-color tags. They must stay in step.
const ground = readIfExists(root, ENTRY).match(/--color-base-100:\s*(#[0-9a-f]{6})/i)[1];
for (const f of ["src/core/format/report-css.ts", "src/core/format/report-html.ts", LAYOUT]) {
  assert.ok(readIfExists(root, f).includes(ground), `${f} must carry the dark ground ${ground}`);
}

// The gate must still bite: a bad copy in a temp dir goes red on every fault
// it plants (one representative case per check).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-css-gate-"));
fs.mkdirSync(path.join(tmp, WB, "app"), { recursive: true });
fs.mkdirSync(path.join(tmp, WB, "src", "next-shell"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, WB, "package.json"),
  JSON.stringify({
    dependencies: { react: "19.0.0", next: "16.3.0" },
    devDependencies: { tailwindcss: "4.0.0", daisyui: PINS.daisyui, "@mantine/core": "9.0.0", vue: "3.5.0" },
  })
);
fs.writeFileSync(path.join(tmp, WB, "app", "globals.css"), '@import "tailwindcss";\n.btn { color: red; }\n');
fs.writeFileSync(path.join(tmp, WB, "src", "extra.css"), "");
// layout.tsx: no theme script, no font vars, no metadata/viewport, an inline
// <style>, a Google Fonts import, and lang with no dir.
fs.writeFileSync(
  path.join(tmp, WB, "app", "layout.tsx"),
  `import "next/font/google";\nexport default function RootLayout() {\n  return (\n    <html lang="en">\n      <head><style>body{color:red}</style></head>\n      <body>fonts.googleapis.com</body>\n    </html>\n  );\n}\n`
);
// page.tsx: two <h1>.
fs.writeFileSync(path.join(tmp, WB, "app", "page.tsx"), `export default function Page() {\n  return (<div><h1>one</h1><h1>two</h1></div>);\n}\n`);
// shell.tsx: exists, but none of the four landmarks, plus a bad data-theme
// value on a non-root element, a bare table, and a physical utility.
fs.writeFileSync(
  path.join(tmp, WB, "src", "next-shell", "shell.tsx"),
  `export function AppShell() {\n  return (\n    <div data-theme="purple">\n      <table><tbody /></table>\n      <p className="ml-4">x</p>\n    </div>\n  );\n}\n`
);
// next-nav-items.ts intentionally NOT created (proves the missing-file check).

const red = gate(tmp);
fs.rmSync(tmp, { recursive: true, force: true });

function bit(substring) {
  assert.ok(red.some((f) => f.includes(substring)), `gate must report a fault containing "${substring}"; got:\n${red.join("\n")}`);
}
bit("second framework or UI library: @mantine/core");
bit("second framework or UI library: vue");
bit("react is 19.0.0, pin is 19.2.8");
bit("tailwindcss is 4.0.0, pin is 4.3.3");
bit("css outside the entry file");
bit(`missing ${NAV_ITEMS}`);
bit("missing the theme boot script");
bit("missing font variable --font-montserrat");
bit("missing the metadata export");
bit("missing the viewport export");
bit("missing a description");
bit("missing the favicon");
bit("missing one of the two theme-color lines");
bit("inline <style> in <head>");
bit("<html> must set lang and dir together");
bit("font host URL");
bit("next/font/google import");
bit(`missing id="main"`);
bit("more than one <h1>");
bit('data-theme="purple" is not cool-dark/cool-light');
bit("data-theme set on <div>, not the root");
bit("<table> with no overflow-x-auto wrapper");
bit("physical direction utility ml-4");
console.log(`css-framework-gate-smoke: PASS (${red.length} faults bitten in the bad copy)`);
