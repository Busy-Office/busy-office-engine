#!/usr/bin/env node
// Chuck pass, automated: line cap + unique-ID check on a DESIGN-GRAPH.md file.
// Generalized from busy-office-erp/scripts/graph-lint.mjs.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const pathArg = args.find((a) => !a.startsWith("--")) ?? "DESIGN-GRAPH.md";
const capArg = args.find((a) => a.startsWith("--cap="));
const LINE_CAP = capArg ? Number(capArg.split("=")[1]) : 150;

const text = readFileSync(pathArg, "utf8");
const lines = text.split("\n");

let failed = false;

if (lines.length > LINE_CAP) {
  console.error(`FAIL line-cap: ${pathArg} is ${lines.length} lines, cap is ${LINE_CAP}`);
  failed = true;
} else {
  console.log(`OK line-cap: ${lines.length}/${LINE_CAP}`);
}

const idPattern = /^\|\s*((?:PRN|ADR|DA|OQ|KRN)-[A-Za-z0-9]+)\s*\|/;
const seen = new Map();
for (const [i, line] of lines.entries()) {
  const m = line.match(idPattern);
  if (!m) continue;
  const id = m[1];
  if (seen.has(id)) {
    console.error(`FAIL duplicate-id: ${id} defined at line ${seen.get(id)} and line ${i + 1}`);
    failed = true;
  } else {
    seen.set(id, i + 1);
  }
}
console.log(`OK unique-ids: ${seen.size} node definitions checked`);

if (failed) {
  process.exit(1);
}
console.log("PASS graph-lint");
