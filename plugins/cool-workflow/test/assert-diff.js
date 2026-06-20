"use strict";
// assert-diff — a tiny zero-dependency helper for readable deep-equality diffs.
// Intended for smoke tests that compare large JSON payloads. Use it as:
//   const diff = require("./assert-diff");
//   const fail = diff(expected, actual, "label");
//   if (fail) { process.stderr.write(fail + "\n"); process.exit(1); }
//
// Returns undefined when equal, or a multi-line human-readable diff string
// when they differ.

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function linesOf(value) {
  return stringify(value).split("\n");
}

function diff(leftValue, rightValue, label) {
  const left = stringify(leftValue);
  const right = stringify(rightValue);
  if (left === right) return undefined;

  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const prefix = label ? `${label}: ` : "";
  let output = `${prefix}objects differ — ${leftLines.length} vs ${rightLines.length} lines\n`;

  for (let i = 0; i < Math.min(leftLines.length, rightLines.length); i++) {
    if (leftLines[i] !== rightLines[i]) {
      output += `  L: ${leftLines[i]}\n  R: ${rightLines[i]}\n\n`;
      break;
    }
  }
  if (leftLines.length !== rightLines.length) {
    const remainder = leftLines.length > rightLines.length ? leftLines : rightLines;
    const tag = leftLines.length > rightLines.length ? "left extra" : "right extra";
    for (let i = Math.min(leftLines.length, rightLines.length); i < Math.min(maxLen, Math.min(leftLines.length, rightLines.length) + 3); i++) {
      output += `  ${tag}: ${remainder[i]}\n`;
    }
  }
  return output.trimEnd();
}

module.exports = diff;
