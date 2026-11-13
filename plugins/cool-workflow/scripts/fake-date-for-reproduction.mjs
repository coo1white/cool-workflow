// fake-date-for-reproduction.mjs — a Node `--require` preload used ONLY by
// verify-bump-reproduction.mjs. It pins `new Date()` (no-args construction)
// and `Date.now()` to a fixed instant, read from CW_FAKE_DATE (an ISO date or
// YYYY-MM-DD string). `new Date(explicit args)` is left untouched.
//
// WHY a runtime-level override, not an application-level env var: the
// scratch worktree checks out the APPROVED PARENT commit and runs ITS OWN
// copy of the bump scripts — which, for every commit
// that predates this mechanism (i.e. every real release ever cut so far),
// has no idea any such override exists. An app-level env var a script has to
// explicitly read is a no-op against code that doesn't know to read it — it
// can only ever help releases cut AFTER the mechanism itself lands, making
// "reproduce a past release" true only by calendar coincidence (confirmed:
// re-running v0.2.0's real approved-parent/tagged pair on a day other than
// its actual cut day fails with a date-only diff in its project index).
// Intercepting the Date GLOBAL, before any application code runs, works
// identically regardless of which script version executes — old or new.
//
// It also pins the path style on Windows. The releases this replays were cut
// on POSIX machines (their committed index links use '/'), and an older bump
// step (the legacy project-index step) wrote `path.relative(...)` results
// into a committed file: on Windows the same code writes `apps\<id>\app.json`,
// so the reproduced tree differs from the tagged one by those separators
// alone (seen on the Windows CI leg: `M plugins/cool-workflow/docs/project-index.md`). On win32 this preload makes
// `path.relative` return forward slashes, as the cut's own platform did.
// Windows file APIs take '/' as a separator, so the bump still reads and
// writes the same files. The tree comparison itself is unchanged and stays
// byte-exact: this only replays the cut's environment, like the clock above.
//
// Usage: NODE_OPTIONS="--require /path/to/this/file.mjs" CW_FAKE_DATE=2026-07-05 <command>

import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

if (process.platform === "win32") {
  const realRelative = path.relative;
  path.relative = (from, to) => realRelative(from, to).split(path.sep).join("/");
  syncBuiltinESMExports();
}

const pinned = process.env.CW_FAKE_DATE;
if (pinned) {
  const fixedMs = new Date(pinned).getTime();
  if (Number.isNaN(fixedMs)) {
    process.stderr.write(`fake-date-for-reproduction: CW_FAKE_DATE is not a valid date: ${pinned}\n`);
    process.exit(1);
  }
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return fixedMs;
    }
  }
  global.Date = FakeDate;
}
