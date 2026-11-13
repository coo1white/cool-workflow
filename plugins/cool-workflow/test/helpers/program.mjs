// test/helpers/program.mjs — a fake program on PATH (a vendor CLI, gh, a
// reviewer).
//
// Consumers: every test that imports it (grep for helpers/program.mjs).
//
// writeProgram(dir, name, source) writes <dir>/<name>: the node `source`
// behind a `#!/usr/bin/env node` line (one already there is kept), mode 755,
// run as CommonJS. Gives back <dir>/<name>.

import fs from "node:fs";
import path from "node:path";

export function writeProgram(dir, name, source) {
  const file = path.join(dir, name);
  const body = source.startsWith("#!") ? source : `#!/usr/bin/env node\n${source}`;
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}
