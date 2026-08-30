// graph-lint's rules, one file for this gate (ADR-62).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, run } from "../shared/harness.mjs";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");

const rows = (...r) => r.join("\n") + "\n";

test("graph-lint: a duplicate id fails, naming both places", () => {
  const dir = fixture({ "g.md": rows("| ADR-01 | a | accepted |", "| ADR-01 | again | accepted |") });
  const r = run(GATE, [join(dir, "g.md")]);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate-id: ADR-01/);
});

test("graph-lint: the line cap and the total-size cap are separate rules", () => {
  const many = fixture({ "g.md": rows(...Array.from({ length: 40 }, (_, i) => `| ADR-${i + 1} | x | accepted |`)) });
  assert.match(run(GATE, ["--cap=10", join(many, "g.md")]).out, /FAIL line-cap/);
  assert.match(run(GATE, ["--total-cap=50", join(many, "g.md")]).out, /FAIL total-size/);
});

test("graph-lint: a row past the row cap fails even though the file is short", () => {
  // The ADR-43 failure: content pushed into fewer, longer lines satisfies a
  // line cap perfectly.
  const dir = fixture({ "g.md": rows(`| ADR-01 | ${"x".repeat(700)} | accepted |`) });
  const r = run(GATE, [join(dir, "g.md")]);
  assert.match(r.out, /OK line-cap/);
  assert.match(r.out, /FAIL row-cap: ADR-01/);
});

test("graph-lint: caps measure the index, uniqueness measures everything", () => {
  // A shard exists so the index stays readable; measuring both together
  // would defeat it (ADR-48).
  const dir = fixture({
    "g.md": "Sharded to s.md\n\n| ADR-01 | a | accepted |\n",
    "s.md": rows(...Array.from({ length: 40 }, (_, i) => `| ADR-${i + 10} | x | accepted |`)),
  });
  const r = run(GATE, ["--cap=10", join(dir, "g.md")]);
  assert.match(r.out, /OK line-cap: \d+\/10/, "the shard's forty lines are not counted against the index");
  assert.match(r.out, /across 2 file\(s\)/);
});

