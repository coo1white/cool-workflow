// Proves the class gate still catches something. A gate with no test of its
// own goes quietly vacuous — a changed regex, a moved directory, and it
// reports "clean" over a tree it never read.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOTS, sourceTokens, unknownClasses } from "../scripts/class-gate";

function fixture(tsx: string): string {
  const dir = mkdtempSync(join(tmpdir(), "class-gate-"));
  writeFileSync(join(dir, "page.tsx"), tsx);
  return dir;
}

describe("the class gate", () => {
  test("the walk found the tree — an empty read must not pass", () => {
    const tokens = sourceTokens(ROOTS);
    expect(tokens.size, "no class tokens read from app/ src/ tests/").toBeGreaterThan(90);
    expect(tokens.has("navbar"), "`navbar` is on the shell; not seeing it means the walk missed").toBe(
      true,
    );
  });

  test("a made-up class name fails", async () => {
    const dir = fixture(`export const A = () => <p className="btn form-fieldset">x</p>;`);
    const bad = await unknownClasses(["."], dir);
    expect(bad.map(([token]) => token)).toEqual(["form-fieldset"]);
  });

  test("a name inside a cn() call fails too", async () => {
    const dir = fixture(`export const A = () => <p className={cn("card", "table-wrap")}>x</p>;`);
    expect((await unknownClasses(["."], dir)).map(([t]) => t)).toEqual(["table-wrap"]);
  });

  test("the real tree is clean", async () => {
    const bad = await unknownClasses();
    expect(
      bad.map(([token, files]) => `${token} <- ${[...files].join(", ")}`),
      "these class names resolve to nothing",
    ).toEqual([]);
  });
});
