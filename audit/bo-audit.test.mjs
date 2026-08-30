// bo-audit, tested in the repo that owns it.
//
// It was covered only from busy-office-erp's must-fail harness (ADR-42) —
// black-box, in another repo, one rule per gate. 506 lines gating every
// merge, with no test here at all. Asked when the unit test was coming,
// the honest answer was that the engine had exactly one test file and it
// was for the delta classifier.
//
// These are still black-box: bo-audit is a script with top-level effects,
// so it is exercised by running it. What changes is that the rules are
// asserted individually, against fixtures this repo controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), "bo-audit.mjs");

const GRAPH = [
  "| PRN-01 | a principle | accepted |",
  "| ADR-01 | a decision | accepted |",
  "| DA-01 | an absence | replacement | trigger | accepted |",
  "",
].join("\n");

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "bo-audit-"));
  for (const [rel, text] of Object.entries({ "DESIGN-GRAPH.md": GRAPH, ...files })) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

function run(dir) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [AUDIT, dir], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

// ---------- citations (ADR-56) ----------

test("a citation the graph does not define is a finding", () => {
  const r = run(repo({ "SESSIONS.md": "ADR-01 · cites OQ-NOWHERE\n" }));
  assert.equal(r.code, 1);
  assert.match(r.out, /cites OQ-NOWHERE/);
});

test("citations are read from ADRs and source, not five named files", () => {
  // The scope error ADR-56 fixed: an ADR is where citations live.
  const r = run(repo({ "SESSIONS.md": "ADR-01\n", "docs/adr/ADR-01-x.md": "cites OQ-GONE\n" }));
  assert.match(r.out, /docs\/adr\/ADR-01-x\.md cites OQ-GONE/);
});

test("a filename slug is not a citation", () => {
  // ADR-15-stack must not read as a node called ADR-15-stack.
  const r = run(repo({ "SESSIONS.md": "ADR-01 · see docs/adr/ADR-01-a-long-slug-here.md\n" }));
  assert.equal(r.out.includes("ADR-01-a-long-slug-here"), false);
});

test("graph-cite-exempt suppresses one named id and no others", () => {
  const r = run(repo({ "SESSIONS.md": "ADR-01\n",
    "docs/adr/ADR-01-x.md": "<!-- graph-cite-exempt: OQ-GONE -->\n\nDiscusses OQ-GONE and cites OQ-ALSOGONE.\n" }));
  assert.equal(r.out.includes("cites OQ-GONE"), false);
  assert.match(r.out, /cites OQ-ALSOGONE/);
});

test("an exemption for an id the graph defines is stale and reported", () => {
  const r = run(repo({ "SESSIONS.md": "ADR-01\n",
    "docs/adr/ADR-01-x.md": "<!-- graph-cite-exempt: ADR-01 -->\n" }));
  assert.match(r.out, /exempts ADR-01 .* the graph defines it/);
});

// ---------- the session log (ADR-59) ----------

test("the newest ADR must appear in SESSIONS.md", () => {
  const r = run(repo({ "SESSIONS.md": "S0.1 · nothing about the newest decision\n" }));
  assert.equal(r.code, 1);
  assert.match(r.out, /ADR-01 is the newest ADR .* did not log itself/);
});

test("a logged session passes", () => {
  const r = run(repo({ "SESSIONS.md": "S0.1 · ratified ADR-01 and DA-01\n" }));
  assert.equal(r.out.includes("did not log itself"), false);
});

// ---------- shards (ADR-41) ----------

test("a package holding code with no shard is a finding, in any root", () => {
  for (const root of ["kernel", "module_core", "module_extension"]) {
    const r = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n", [`${root}/thing/x.mjs`]: "export const a = 1;\n" }));
    assert.match(r.out, new RegExp(`${root}/thing holds work but has no CLAUDE.md shard`), root);
  }
});

test("a shard over the cap, and one naming no seat, are both findings", () => {
  const long = ["# x", "Seat: t", ...Array.from({ length: 70 }, (_, i) => `line ${i}`)].join("\n");
  const over = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n", "kernel/a/x.mjs": "export const a=1;\n", "kernel/a/CLAUDE.md": long }));
  assert.match(over.out, /is \d+ lines — the cap is 60/);

  const anon = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n", "kernel/b/x.mjs": "export const a=1;\n", "kernel/b/CLAUDE.md": "# b\n\nno seat line\n" }));
  assert.match(anon.out, /names no owning seat/);
});

// ---------- scope reporting (ADR-60) ----------

test("every check that ran reports what it examined", () => {
  const r = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n", "kernel/a/x.mjs": "export const a=1;\n", "kernel/a/CLAUDE.md": "# a\n\nSeat: a\n" }));
  assert.match(r.out, /What each check examined/);
  for (const check of ["coverage", "session-log", "coverage-docs"]) {
    assert.match(r.out, new RegExp(`\\[${check}\\] `), `${check} reports no scope`);
  }
  // The number is the point: a scope line with no magnitude cannot look wrong.
  assert.match(r.out, /\[coverage\] \d+ file\(s\)/);
});

test("an unavailable check is not reported as passing", () => {
  const r = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n" }));
  assert.match(r.out, /Not checked \(evidence unavailable — not the same as passing\)/);
});

test("findings exit non-zero, unavailable checks do not", () => {
  const clean = run(repo({ "SESSIONS.md": "ADR-01 DA-01\n" }));
  assert.equal(clean.code, 0, "unavailable checks must not fail a build they cannot judge");
});
