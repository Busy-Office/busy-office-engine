#!/usr/bin/env node
// Chuck pass, automated: line cap + unique-ID check on a DESIGN-GRAPH.md file.
// Generalized from busy-office-erp/scripts/graph-lint.mjs.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const pathArg = args.find((a) => !a.startsWith("--")) ?? "DESIGN-GRAPH.md";
const capArg = args.find((a) => a.startsWith("--cap="));
const LINE_CAP = capArg ? Number(capArg.split("=")[1]) : 150;

// The line cap alone measures the wrong thing, and it took thirty-odd
// sessions to notice (ADR-43). A graph can sit comfortably under it while
// individual rows grow to a thousand characters — which is what happened:
// rows doubled in length, the file reached 30KB, and the cap reported
// 140/150 the whole way, because pushing content into fewer longer lines
// satisfies a line cap perfectly.
//
// The cap exists so the graph can be read in one pass. Lines are a proxy
// for that and density is the other half, so both are measured.
const rowCapArg = args.find((a) => a.startsWith("--row-cap="));
const ROW_CAP = rowCapArg ? Number(rowCapArg.split("=")[1]) : 600;
const totalCapArg = args.find((a) => a.startsWith("--total-cap="));
const TOTAL_CAP = totalCapArg ? Number(totalCapArg.split("=")[1]) : 26000;

const text = readFileSync(pathArg, "utf8");
const lines = text.split("\n");

let failed = false;

if (lines.length > LINE_CAP) {
  console.error(`FAIL line-cap: ${pathArg} is ${lines.length} lines, cap is ${LINE_CAP}`);
  failed = true;
} else {
  console.log(`OK line-cap: ${lines.length}/${LINE_CAP}`);
}

if (text.length > TOTAL_CAP) {
  console.error(`FAIL total-size: ${pathArg} is ${text.length} characters, cap is ${TOTAL_CAP} — the index is becoming the document it indexes`);
  failed = true;
} else {
  console.log(`OK total-size: ${text.length}/${TOTAL_CAP}`);
}

const idPattern = /^\|\s*((?:PRN|ADR|DA|OQ|KRN)-[A-Za-z0-9]+)\s*\|/;

// A row longer than the cap has stopped being an index entry and become a
// summary — which duplicates the node's own document, the thing
// link-don't-duplicate exists to prevent.
let overlong = 0;
for (const [i, line] of lines.entries()) {
  if (!idPattern.test(line) || line.length <= ROW_CAP) continue;
  const id = line.match(idPattern)[1];
  console.error(
    `FAIL row-cap: ${id} at line ${i + 1} is ${line.length} characters, cap is ${ROW_CAP} — state the decision here and leave the reasoning in its own document`,
  );
  overlong++;
  failed = true;
}
if (overlong === 0) console.log(`OK row-cap: no row over ${ROW_CAP} characters`);
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
