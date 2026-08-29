#!/usr/bin/env node
// bo-transport classify — the one transport verb that has a consumer today.
//
// ADR-05 names five: assemble · impact · gate · route · stamp. Only the
// classifier is built, because it is the only one KRN-0 gives something to
// act on; building the rest now would be depth no slice consumes (PRN-11).
// The exit code is the interface a CI gate wants: 0 hot, 1 additive,
// 2 breaking.

import { readFileSync } from "node:fs";
import { classifyDelta, deployPlan } from "./classify-delta.mjs";

const [, , command, beforePath, afterPath] = process.argv;

if (command !== "classify" || !beforePath || !afterPath) {
  console.error("usage: bo-transport classify <before.json> <after.json>");
  console.error("exit codes: 0 = hot, 1 = additive, 2 = breaking");
  process.exit(64);
}

const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
const result = classifyDelta(before, after);

console.log(`${result.class.toUpperCase()}  ${beforePath} → ${afterPath}`);
console.log(deployPlan(result.class));

if (result.reasons.length > 0) {
  console.log("");
  // Most severe first, so the reason that set the class is the one read.
  const order = { breaking: 0, additive: 1, hot: 2 };
  for (const r of [...result.reasons].sort((a, b) => order[a.class] - order[b.class])) {
    console.log(`  ${r.class.padEnd(8)} ${r.why}`);
  }
}

process.exit({ hot: 0, additive: 1, breaking: 2 }[result.class]);
