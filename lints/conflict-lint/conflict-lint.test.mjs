// conflict-lint's rules, one file for this gate (ADR-62).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, run } from "../shared/harness.mjs";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");

test("conflict-lint: an unresolved marker fails, and prose about one does not", () => {
  const m = (c) => c.repeat(7);
  const dir = fixture({
    "bad.md": `x\n${m("<")} HEAD\na\n${m("=")}\nb\n${m(">")} branch\n`,
    "prose.md": "An ADR explaining a merge may write <<<<<<< inline without tripping this.\n",
  });
  assert.match(run(GATE, [join(dir, "bad.md")]).out, /conflict marker/i);
  assert.equal(run(GATE, [join(dir, "prose.md")]).code, 0, "anchored and exact-width, so a mention is not a marker");
});

