#!/usr/bin/env node
// Conflict-marker lint. Trivial, and it exists because the absence of it
// let `<<<<<<< HEAD` reach a default branch: a merge resolution went in
// with markers still in SESSIONS.md, and nothing noticed. graph-lint reads
// only the design graph; bo-audit reads structure, not raw text; the
// contract validators read JSON. No check looked at ordinary prose files
// for the most obvious defect there is.
//
// Usage: bo-conflict-lint [path...]   (defaults to every tracked file)

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

// Anchored and exact-width, so prose that merely mentions markers — an ADR
// explaining a merge, say — does not trip the lint on itself.
const MARKERS = [/^<{7}( |$)/, /^={7}$/, /^>{7}( |$)/];

const args = process.argv.slice(2);
let files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  try {
    files = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    console.error("FAIL not a git repository, and no paths given");
    process.exit(2);
  }
}

let failed = false;
let scanned = 0;

for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary
  scanned += 1;

  for (const [i, line] of text.split("\n").entries()) {
    if (MARKERS.some((m) => m.test(line))) {
      console.error(`FAIL ${file}:${i + 1} unresolved conflict marker: ${line.slice(0, 40)}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`PASS conflict-lint — ${scanned} file(s), no unresolved markers`);
