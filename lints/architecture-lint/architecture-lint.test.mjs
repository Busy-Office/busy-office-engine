// architecture-lint's rules, one file for this gate (ADR-62).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, run } from "../shared/harness.mjs";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");

test("architecture-lint: a component the documents do not declare is drift", () => {
  const dir = fixture({
    "ARCHITECTURE.md": "│   ├── journal/    the spine\n",
    "kernel/journal/x.mjs": "export const a = 1;\n",
    "kernel/surprise/y.mjs": "export const b = 2;\n",
  });
  const r = run(GATE, [dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /surprise/);
});
