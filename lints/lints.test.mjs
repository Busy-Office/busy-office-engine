// The four lints, tested where they live.
//
// They were exercised only from busy-office-erp's gates-can-fail harness
// (ADR-42) — one rule per lint, black-box, in a repo that pins them by
// SHA. So a rule could break here and stay green until a consumer bumped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lint = (name) => join(here, name, "index.mjs");

function tmp(files) {
  const dir = mkdtempSync(join(tmpdir(), "bo-lint-"));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
}

function run(script, args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

// ---------- graph-lint ----------

const rows = (...r) => r.join("\n") + "\n";

test("graph-lint: a duplicate id fails, naming both places", () => {
  const dir = tmp({ "g.md": rows("| ADR-01 | a | accepted |", "| ADR-01 | again | accepted |") });
  const r = run(lint("graph-lint"), [join(dir, "g.md")]);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate-id: ADR-01/);
});

test("graph-lint: the line cap and the total-size cap are separate rules", () => {
  const many = tmp({ "g.md": rows(...Array.from({ length: 40 }, (_, i) => `| ADR-${i + 1} | x | accepted |`)) });
  assert.match(run(lint("graph-lint"), ["--cap=10", join(many, "g.md")]).out, /FAIL line-cap/);
  assert.match(run(lint("graph-lint"), ["--total-cap=50", join(many, "g.md")]).out, /FAIL total-size/);
});

test("graph-lint: a row past the row cap fails even though the file is short", () => {
  // The ADR-43 failure: content pushed into fewer, longer lines satisfies a
  // line cap perfectly.
  const dir = tmp({ "g.md": rows(`| ADR-01 | ${"x".repeat(700)} | accepted |`) });
  const r = run(lint("graph-lint"), [join(dir, "g.md")]);
  assert.match(r.out, /OK line-cap/);
  assert.match(r.out, /FAIL row-cap: ADR-01/);
});

test("graph-lint: caps measure the index, uniqueness measures everything", () => {
  // A shard exists so the index stays readable; measuring both together
  // would defeat it (ADR-48).
  const dir = tmp({
    "g.md": "Sharded to s.md\n\n| ADR-01 | a | accepted |\n",
    "s.md": rows(...Array.from({ length: 40 }, (_, i) => `| ADR-${i + 10} | x | accepted |`)),
  });
  const r = run(lint("graph-lint"), ["--cap=10", join(dir, "g.md")]);
  assert.match(r.out, /OK line-cap: \d+\/10/, "the shard's forty lines are not counted against the index");
  assert.match(r.out, /across 2 file\(s\)/);
});

// ---------- conflict-lint ----------

test("conflict-lint: an unresolved marker fails, and prose about one does not", () => {
  const m = (c) => c.repeat(7);
  const dir = tmp({
    "bad.md": `x\n${m("<")} HEAD\na\n${m("=")}\nb\n${m(">")} branch\n`,
    "prose.md": "An ADR explaining a merge may write <<<<<<< inline without tripping this.\n",
  });
  assert.match(run(lint("conflict-lint"), [join(dir, "bad.md")]).out, /conflict marker/i);
  assert.equal(run(lint("conflict-lint"), [join(dir, "prose.md")]).code, 0, "anchored and exact-width, so a mention is not a marker");
});

// ---------- trust-lint: NOT covered here, and why ----------
//
// It needs a signed manifest fixture and a key. ADR-42 named that as real
// work rather than an oversight when the erp harness skipped it, and the
// same holds here. Written down because a `lints.test.mjs` that exercises
// three of four lints otherwise reads as covering all of them — which is
// how a coverage claim becomes false without anybody lying.

// ---------- architecture-lint ----------

test("architecture-lint: a component the documents do not declare is drift", () => {
  const dir = tmp({
    "ARCHITECTURE.md": "│   ├── journal/    the spine\n",
    "kernel/journal/x.mjs": "export const a = 1;\n",
    "kernel/surprise/y.mjs": "export const b = 2;\n",
  });
  const r = run(lint("architecture-lint"), [dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /surprise/);
});
