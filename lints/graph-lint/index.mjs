#!/usr/bin/env node
// Chuck pass, automated: line cap + unique-ID check on a DESIGN-GRAPH.md file.
// Generalized from busy-office-erp/scripts/graph-lint.mjs.
import { readFileSync } from "node:fs";
import { loadGraph, graphRows } from "../shared/graph-shards.mjs";

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

// The caps apply to the INDEX, not to the whole graph — that is the point
// of sharding (ADR-48). A shard exists so the index can stay readable in one
// pass; measuring index+shards together would make sharding pointless.
// Row-cap and uniqueness apply everywhere, because a summary row and a
// duplicate id are wrong wherever they sit.
let failed = false;

const graph = loadGraph(pathArg);
const text = graph.index.text;
const lines = text.split("\n");

for (const rel of graph.missing) {
  console.error(`FAIL shard: index declares a shard at ${rel}, which does not exist`);
  failed = true;
}
if (graph.shards.length > 0) {
  console.log(`OK shards: ${graph.shards.length} declared and present`);
}

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
for (const row of graphRows(graph)) {
  if (row.line.length <= ROW_CAP) continue;
  console.error(
    `FAIL row-cap: ${row.id} at ${row.source}:${row.lineNumber} is ${row.line.length} characters, cap is ${ROW_CAP} — state the decision here and leave the reasoning in its own document`,
  );
  overlong++;
  failed = true;
}
if (overlong === 0) console.log(`OK row-cap: no row over ${ROW_CAP} characters`);
// Across index and shards: a node defined twice is two answers to one
// question, and sharding makes that easier to do by accident rather than
// harder — the second definition is now in a different file.
const seen = new Map();
for (const row of graphRows(graph)) {
  const where = `${row.source}:${row.lineNumber}`;
  if (seen.has(row.id)) {
    console.error(`FAIL duplicate-id: ${row.id} defined at ${seen.get(row.id)} and ${where}`);
    failed = true;
  } else {
    seen.set(row.id, where);
  }
}
console.log(`OK unique-ids: ${seen.size} node definitions checked across ${graph.shards.length + 1} file(s)`);

if (failed) {
  process.exit(1);
}
console.log("PASS graph-lint");
