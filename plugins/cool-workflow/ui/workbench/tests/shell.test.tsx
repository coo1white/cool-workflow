// spec.md 2.8: one render-to-string test for the shell. TECH-SPEC 2b.7 check
// 6 wants id="main", a href="#main" skip link, a <main and a <footer in the
// shell files; this proves the rendered markup, not just the source text.
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../src/next-shell/shell";

const html = renderToStaticMarkup(
  <AppShell>
    <p>one page</p>
  </AppShell>
);

const assert = require("node:assert/strict");
assert.match(html, /href="#main"/, "skip link points at #main");
assert.match(html, /<main id="main"/, "main landmark carries id=main");
assert.match(html, /<footer/, "shell renders a footer landmark");
assert.equal((html.match(/<h1[ >]/g) || []).length, 1, "the shell renders exactly one h1");
assert.match(html, /one page/, "children render inside main");

console.log("shell.test: ok");
