"use strict";

// fake-date-for-reproduction.js — a Node `--require` preload used ONLY by
// verify-bump-reproduction.sh. It pins `new Date()` (no-args construction)
// and `Date.now()` to a fixed instant, read from CW_FAKE_DATE (an ISO date or
// YYYY-MM-DD string). `new Date(explicit args)` is left untouched.
//
// WHY a runtime-level override, not an application-level env var: the
// scratch worktree checks out the APPROVED PARENT commit and runs ITS OWN
// copy of bump-version.js/sync-project-index.js — which, for every commit
// that predates this mechanism (i.e. every real release ever cut so far),
// has no idea any such override exists. An app-level env var a script has to
// explicitly read is a no-op against code that doesn't know to read it — it
// can only ever help releases cut AFTER the mechanism itself lands, making
// "reproduce a past release" true only by calendar coincidence (confirmed:
// re-running v0.2.0's real approved-parent/tagged pair on a day other than
// its actual cut day fails with a date-only diff in project-index.md).
// Intercepting the Date GLOBAL, before any application code runs, works
// identically regardless of which script version executes — old or new.
//
// Usage: NODE_OPTIONS="--require /path/to/this/file.js" CW_FAKE_DATE=2026-07-05 <command>

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
