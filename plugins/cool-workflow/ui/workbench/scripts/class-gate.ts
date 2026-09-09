// Fail the build on a class name that resolves to nothing.
//
// The ground truth is the BUILT CSS. Tailwind 4 emits a rule only for a
// utility it saw in source, and daisyUI's component classes plus the
// hand-written theme in globals.css come out of the same compile, so one
// pass over app/globals.css answers "which class names have a rule" for
// the whole Workbench. postcss + @tailwindcss/postcss are already
// dependencies of this app — the same pair Next itself runs — so no CLI
// and no download.
//
// Copied from cool-tunnel-server's src/apps/web/scripts/class-gate.ts
// (PR #468). Three changes from that copy: the CSS entry path, the scan
// roots, and one extra regex for src/classes.ts (see below and the PR
// body).

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/postcss";
import { Glob } from "bun";
import postcss from "postcss";

const WEB = resolve(import.meta.dir, "..");
export const ROOTS = ["app", "src", "tests"];
const ALLOWLIST = join(import.meta.dir, "class-allowlist.txt");

/** Every class name the compiled stylesheet has a rule for. */
async function builtClasses(): Promise<Set<string>> {
  const entry = join(WEB, "app/globals.css");
  const out = await postcss([tailwind()]).process(readFileSync(entry, "utf8"), { from: entry });
  const names = new Set<string>();
  // A class selector, with CSS escapes (`\:` `\/` `\[` `\.`) put back.
  for (const m of out.css.matchAll(/\.((?:[^\s.,:>+~()[\]{}#"'\\]|\\.)+)/g)) {
    names.add(m[1].replace(/\\(.)/g, "$1"));
  }
  return names;
}

/** Names on the allowlist file, one `token  # reason` per line. */
function allowed(): Set<string> {
  const names = new Set<string>();
  for (const line of readFileSync(ALLOWLIST, "utf8").split("\n")) {
    const token = line.split("#")[0].trim();
    if (token) names.add(token);
  }
  return names;
}

// A class token, not a stray word. Rejects the JS that sits beside one in a
// `cn()` call (`option.value`, `===`, a bare `?`).
const TOKEN = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)*[a-zA-Z0-9\]%._/[-]*$/;
const CLASSNAME = /className\s*=\s*(?:"([^"]*)"|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g;
// `cn("a", cond && "b")`. The `(!==|===)?` group drops a string that is the
// right side of a comparison — `tone === "danger"` names a prop value, not a
// class. Skipped on purpose: a fully dynamic expression (a variable, a map
// lookup, a `${}` hole), which no static read can name.
const CN_CALL = /\bcn\(([\s\S]{0,600}?)\)/g;
const CN_STRING = /(!==|===|==|!=)?\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
// `key: "a b c"` in src/classes.ts, the one file that holds shared class
// strings outside a `className=`/`cn()` call.
const OBJECT_ENTRY = /[a-zA-Z_$][\w$]*\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Every static class token in the source under `roots`, mapped to its files. */
export function sourceTokens(roots: string[], base = WEB): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const keep = (raw: string, file: string) => {
    for (const token of raw.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      if (!TOKEN.test(token)) continue;
      const files = found.get(token) ?? new Set<string>();
      files.add(file);
      found.set(token, files);
    }
  };
  for (const root of roots) {
    for (const rel of new Glob("**/*.{ts,tsx}").scanSync(join(base, root))) {
      // The gate's own test plants fake class names in fixture strings to
      // prove a fault is caught; those strings are not real UI markup.
      if (rel.endsWith("class-gate.test.ts")) continue;
      const file = `${root}/${rel}`;
      const src = stripComments(readFileSync(join(base, root, rel), "utf8"));
      for (const m of src.matchAll(CLASSNAME)) keep(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "", file);
      for (const call of src.matchAll(CN_CALL)) {
        for (const s of call[1].matchAll(CN_STRING)) {
          if (!s[1]) keep(s[2] ?? s[3] ?? s[4] ?? "", file);
        }
      }
      if (rel.endsWith("classes.ts")) {
        for (const m of src.matchAll(OBJECT_ENTRY)) keep(m[1] ?? m[2] ?? m[3] ?? "", file);
      }
    }
  }
  return found;
}

/** Class tokens the built CSS has no rule for and the allowlist does not name. */
export async function unknownClasses(roots = ROOTS, base = WEB) {
  const [built, ok] = [await builtClasses(), allowed()];
  return [...sourceTokens(roots, base)]
    .filter(([token]) => !built.has(token) && !ok.has(token))
    .sort(([a], [b]) => a.localeCompare(b));
}

if (import.meta.main) {
  const bad = await unknownClasses();
  if (bad.length > 0) {
    console.error("these class names resolve to nothing — no rule in the built CSS:");
    for (const [token, files] of bad) console.error(`  ${token}  <- ${[...files].join(", ")}`);
    console.error("\nUse a daisyUI class or a Tailwind utility that exists, or add the name to");
    console.error(`${ALLOWLIST} with the reason it emits no rule of its own.`);
    process.exit(2);
  }
  console.log("    class-gate: clean");
}
