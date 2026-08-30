// The shard loader (ADR-48). Untested until now, and it is the thing that
// decides which nodes exist as far as every other check is concerned — a
// wrong answer here makes correct citations look dangling and duplicate
// ids look unique.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadGraph, graphIds, graphRows } from "./graph-shards.mjs";

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "bo-graph-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

test("an unsharded graph loads, and declares no shards", () => {
  const dir = repo({ "DESIGN-GRAPH.md": "| PRN-01 | a | accepted |\n| ADR-02 | b | accepted |\n" });
  const g = loadGraph(join(dir, "DESIGN-GRAPH.md"));
  assert.equal(g.shards.length, 0);
  assert.deepEqual([...graphIds(g)].sort(), ["ADR-02", "PRN-01"]);
});

test("a declared shard's nodes are part of the graph", () => {
  const dir = repo({
    "DESIGN-GRAPH.md": "## DECISIONS\n\nSharded to docs/graph/decisions.md\n\n| PRN-01 | a | accepted |\n",
    "docs/graph/decisions.md": "| ADR-02 | b | accepted |\n| ADR-03 | c | accepted |\n",
  });
  const g = loadGraph(join(dir, "DESIGN-GRAPH.md"));
  assert.equal(g.shards.length, 1);
  assert.deepEqual([...graphIds(g)].sort(), ["ADR-02", "ADR-03", "PRN-01"]);
});

test("a shard is declared, never discovered", () => {
  // A file dropped in the right directory must not silently become truth.
  const dir = repo({
    "DESIGN-GRAPH.md": "| PRN-01 | a | accepted |\n",
    "docs/graph/decisions.md": "| ADR-99 | not declared, not loaded | accepted |\n",
  });
  const g = loadGraph(join(dir, "DESIGN-GRAPH.md"));
  assert.equal(g.shards.length, 0);
  assert.equal(graphIds(g).has("ADR-99"), false);
});

test("a declared shard that does not exist is reported, not skipped", () => {
  const dir = repo({ "DESIGN-GRAPH.md": "Sharded to docs/graph/gone.md\n\n| PRN-01 | a | accepted |\n" });
  const g = loadGraph(join(dir, "DESIGN-GRAPH.md"));
  assert.deepEqual(g.missing, ["docs/graph/gone.md"]);
  assert.equal(g.shards.length, 0);
});

test("struck-through ids still count as defined", () => {
  // A closed question keeps its row so documents citing it resolve.
  const dir = repo({ "DESIGN-GRAPH.md": "| ~~OQ-STACK~~ | closed | — |\n" });
  assert.equal(graphIds(loadGraph(join(dir, "DESIGN-GRAPH.md"))).has("OQ-STACK"), true);
});

test("rows carry where they came from, so a duplicate names two files", () => {
  const dir = repo({
    "DESIGN-GRAPH.md": "Sharded to s.md\n\n| ADR-01 | in the index | accepted |\n",
    "s.md": "| ADR-01 | and in the shard | accepted |\n",
  });
  const rows = graphRows(loadGraph(join(dir, "DESIGN-GRAPH.md")));
  const dupes = rows.filter((r) => r.id === "ADR-01");
  assert.equal(dupes.length, 2);
  assert.notEqual(dupes[0].source, dupes[1].source, "the sources differ, which is what makes the duplicate reportable");
});

test("prose that merely mentions a node id is not a definition", () => {
  // Only a table row defines. Otherwise an ADR discussing PRN-04 would
  // create it.
  const dir = repo({ "DESIGN-GRAPH.md": "PRN-04 is mentioned here in prose.\n\n| ADR-01 | a | accepted |\n" });
  const ids = graphIds(loadGraph(join(dir, "DESIGN-GRAPH.md")));
  assert.equal(ids.has("PRN-04"), false);
  assert.equal(ids.has("ADR-01"), true);
});
