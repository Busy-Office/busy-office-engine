#!/usr/bin/env node
// bo-audit (PRN-12, rules in erp ADR-30). The system audits itself from
// artifacts it already has: the graph, the contracts, PR history. No audit
// data model, no dashboard — those would be another component needing its
// own audit.
//
// The design rule that matters here: a check either reads real evidence or
// it does not exist. An audit that reports "PASS" for something it cannot
// actually see is worse than no audit, because it manufactures confidence.
// Checks that need evidence this repo cannot reach are listed as
// UNAVAILABLE with the reason, never silently skipped or assumed green.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const findings = [];
const finding = (check, severity, message, evidence) =>
  findings.push({ check, severity, message, evidence });

/** Every ID the graph defines, by type. */
function readGraph(repo) {
  const path = join(repo, "DESIGN-GRAPH.md");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const ids = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(?:~~)?([A-Z][A-Z0-9]*-[A-Za-z0-9-]+)(?:~~)?\s*\|/);
    if (m) ids.add(m[1]);
  }
  return { text, ids };
}

/** Every contract in module_core, by kind. */
function readContracts(repo) {
  const out = { ontologies: [], stateMachines: [], opContracts: [], markup: [] };
  const moduleCore = join(repo, "module_core");
  if (!existsSync(moduleCore)) return out;

  for (const mod of readdirSync(moduleCore)) {
    const dir = join(moduleCore, mod, "contracts");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const doc = () => JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (f.endsWith(".ontology.json")) out.ontologies.push(doc());
      else if (f.endsWith(".state-machine.json")) out.stateMachines.push(doc());
      else if (f.endsWith(".op-contract.json")) out.opContracts.push(doc());
      else if (f.endsWith(".markup.json")) out.markup.push(doc());
    }
  }
  return out;
}

// ---- check 1: coverage — cited nodes exist ------------------------------
// Every TYPE-ID mentioned anywhere in the repo's markdown must be a node the
// graph actually defines. A citation to a node that was renamed or removed
// is a dangling reference, and the graph is meant to be the one truth.
function checkCoverage(repo, graph) {
  if (!graph) return finding("coverage", "unavailable", "no DESIGN-GRAPH.md found", null);

  const KNOWN_EXTERNAL = /^(ADR-0\d\d)$/; // three-digit IDs belong to sibling repos
  const docs = ["ARCHITECTURE.md", "PROJECT-PLAN.md", "AGENTS.md", "SESSIONS.md", "README.md"];
  let checked = 0;

  for (const doc of docs) {
    const path = join(repo, doc);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(/\b((?:PRN|ADR|DA|OQ|KRN)-[A-Za-z0-9-]*[A-Za-z0-9])\b/g)) {
      const id = m[1];
      checked += 1;
      if (!graph.ids.has(id) && !KNOWN_EXTERNAL.test(id)) {
        finding("coverage", "error", `${doc} cites ${id}, which the graph does not define`, doc);
      }
    }
  }
  return checked;
}

// ---- check 2: consistency — operations cited but never declared ---------
// This is the gap ADR-29 found and named: an operation can appear in change
// documents and tests while no op contract declares it. Trigger-coverage
// misses it, because such an operation drives no transition.
function checkConsistency(repo, contracts) {
  const declared = new Set(contracts.opContracts.map((o) => o.operation));
  if (declared.size === 0) return;

  const cited = new Map();
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) scan(full);
      } else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/operation:\s*"([a-z][A-Za-z0-9]*)"/g)) {
          if (!cited.has(m[1])) cited.set(m[1], full.replace(`${repo}/`, ""));
        }
      }
    }
  };
  scan(join(repo, "tests"));
  scan(join(repo, "module_core"));

  for (const [op, where] of cited) {
    if (!declared.has(op)) {
      finding("consistency", "error", `operation '${op}' is used but no op contract declares it`, where);
    }
  }
}

// ---- check 3: completeness — modules ship what ADR-10 requires ----------
function checkCompleteness(repo, contracts) {
  const entities = new Set(contracts.ontologies.map((o) => o.entity));
  for (const sm of contracts.stateMachines) {
    if (!entities.has(sm.entity)) {
      finding("completeness", "error", `state machine ${sm.machine} governs '${sm.entity}', which no ontology defines`, sm.machine);
    }
  }
  for (const op of contracts.opContracts) {
    const target = op.output?.entity;
    if (target && !entities.has(target)) {
      finding("completeness", "error", `operation ${op.operation} outputs '${target}', which no ontology defines`, op.operation);
    }
  }
}

// ---- check 4: coverage — declared things nothing exercises --------------
// Adopted at the S0.28 round table. The proposal was an agent owner who
// would review each package; what survived grilling was the mechanical
// half — an operation nobody tests, a package nobody documents. Those are
// checkable, and a check cannot be satisfied by the thing it checks.
//
// It reports what is DECLARED but unexercised, never guessing at what
// should have been declared. A missing test for a real operation is a
// fact; a missing operation is an opinion.
function checkCoverage2(repo, contracts) {
  // Every op contract should be named by at least one test.
  const testFiles = [];
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) scan(full);
      } else if (/\.test\.[a-z]+$/.test(e.name)) {
        testFiles.push(readFileSync(full, "utf8"));
      }
    }
  };
  for (const d of ["kernel", "module_core", "tests"]) scan(join(repo, d));

  if (testFiles.length === 0) {
    finding("coverage-tests", "unavailable", "no test files found — operation coverage cannot be judged", null);
  } else {
    const untested = contracts.opContracts
      .map((o) => o.operation)
      .filter((op) => !testFiles.some((t) => t.includes(op)));
    if (untested.length > 0) {
      finding(
        "coverage-tests",
        "error",
        `${untested.length} of ${contracts.opContracts.length} declared operations are named by no test`,
        untested.join(" "),
      );
    }
  }

  // Every package with contracts should carry a shard, and it should name
  // its owning seat — ADR-13 says the shard is owned, not merely present.
  const moduleCore = join(repo, "module_core");
  if (existsSync(moduleCore)) {
    for (const mod of readdirSync(moduleCore)) {
      const dir = join(moduleCore, mod);
      const hasContracts = existsSync(join(dir, "contracts"));
      if (!hasContracts) continue;

      const shardPath = join(dir, "CLAUDE.md");
      if (!existsSync(shardPath)) {
        finding("coverage-docs", "error", `module_core/${mod} has contracts but no CLAUDE.md shard`, `module_core/${mod}`);
        continue;
      }
      const shard = readFileSync(shardPath, "utf8");
      const lines = shard.split("\n").length;
      if (lines > 60) {
        finding("coverage-docs", "error", `module_core/${mod}/CLAUDE.md is ${lines} lines — the cap is 60`, `module_core/${mod}`);
      }
      if (!/^\s*(?:Owner|Seat):/mi.test(shard)) {
        finding("coverage-docs", "error", `module_core/${mod}/CLAUDE.md names no owning seat — a shard is owned, not merely present`, `module_core/${mod}`);
      }
    }
  }
}

// ---- check 4: separation of duties -------------------------------------
// The check DA-12's "audit-ready by construction" claim rests on, and the
// one Rex flagged as unbacked. It reads real PR history; if gh is
// unavailable it reports UNAVAILABLE rather than passing.
/**
 * A ratified exception is reported, never suppressed. An exception nobody
 * can see has not been managed, only hidden — and one that fails the build
 * becomes a gate people route around (ADR-32).
 */
function ratifiedSoDException(graph) {
  if (!graph) return null;
  const row = graph.text.split("\n").find((l) => /^\|\s*DA-13\s*\|/.test(l));
  if (!row) return null;
  const reopen = row.split("|")[4]?.trim();
  return { node: "DA-13", reopen: reopen ?? "(reopen trigger not stated)" };
}

function checkSoD(slug, limit, exception) {
  let prs;
  try {
    prs = JSON.parse(
      execSync(
        `gh pr list --repo ${slug} --state merged --limit ${limit} --json number,author,reviews,title`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    );
  } catch {
    finding("sod", "unavailable", `cannot read PR history for ${slug} — gh unavailable or repo inaccessible`, null);
    return;
  }

  // A repo with no PRs at all must not score clean. The first version of
  // this check only examined merged PRs, so a repo where everything was
  // pushed straight to main had nothing to flag and reported "No findings"
  // — the check rewarded bypassing the process entirely, which is a worse
  // failure than the one it was built to catch. Found by running bo-audit
  // against this repo (erp S0.24).
  if (prs.length === 0) {
    let directCommits = 0;
    try {
      directCommits = JSON.parse(
        execSync(`gh api repos/${slug}/commits`, {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }),
      ).length;
    } catch { /* leave at 0 */ }

    if (directCommits > 0) {
      finding(
        "sod",
        exception ? "accepted" : "error",
        `${slug} has ${directCommits} commit(s) and no pull requests at all — every change went straight to the default branch, so no review was even possible`,
        slug,
      );
    } else {
      finding("sod", "unavailable", `${slug} has no merged PRs and no commits to judge`, slug);
    }
    return;
  }

  const unreviewed = prs.filter((p) => (p.reviews ?? []).length === 0);
  if (unreviewed.length > 0) {
    finding(
      "sod",
      exception ? "accepted" : "error",
      `${unreviewed.length} of ${prs.length} merged PRs had no review — AGENTS.md non-negotiable #1 is "no self-review, no self-merge, ever, any seat"`,
      unreviewed.map((p) => `#${p.number}`).join(" "),
    );
  }
}

// ---- checks that cannot run, named rather than skipped ------------------
function unavailableChecks() {
  finding("drift", "unavailable", "no running system to compare against its contracts — nothing is deployed yet", null);
  finding("gate-stamps", "unavailable", "no transport stamps exist yet, so 'no deploy skipped a gate' is unverifiable", null);
}

// ---- run ----------------------------------------------------------------
const args = process.argv.slice(2);
const repo = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const slugFlag = args.find((a) => a.startsWith("--repo="));
const limitFlag = args.find((a) => a.startsWith("--limit="));
const limit = limitFlag ? Number(limitFlag.split("=")[1]) : 30;

let slug = slugFlag?.split("=")[1];
if (!slug) {
  try {
    slug = execSync("git remote get-url origin", { cwd: repo, encoding: "utf8" })
      .trim()
      .replace(/^git@github\.com:/, "")
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
  } catch { /* no remote */ }
}

const graph = readGraph(repo);
const contracts = readContracts(repo);

checkCoverage(repo, graph);
checkConsistency(repo, contracts);
checkCompleteness(repo, contracts);
checkCoverage2(repo, contracts);
const sodException = ratifiedSoDException(graph);
if (slug) checkSoD(slug, limit, sodException);
else finding("sod", "unavailable", "no git remote — cannot read PR history", null);
unavailableChecks();

const errors = findings.filter((f) => f.severity === "error");
const accepted = findings.filter((f) => f.severity === "accepted");
const unavailable = findings.filter((f) => f.severity === "unavailable");

console.log(`bo-audit — ${repo}\n`);
for (const f of errors) {
  console.log(`FINDING [${f.check}] ${f.message}`);
  if (f.evidence) console.log(`         evidence: ${f.evidence}`);
}
if (errors.length === 0) console.log("No findings.");

if (accepted.length > 0) {
  console.log("\nAccepted exceptions (ratified, still true, still counted):");
  for (const f of accepted) {
    console.log(`  [${f.check}] ${f.message}`);
    if (f.evidence) console.log(`         evidence: ${f.evidence}`);
    if (sodException) console.log(`         accepted by ${sodException.node} — reopens on: ${sodException.reopen}`);
  }
}

if (unavailable.length > 0) {
  console.log("\nNot checked (evidence unavailable — not the same as passing):");
  for (const f of unavailable) console.log(`  [${f.check}] ${f.message}`);
}

console.log(`\n${errors.length} finding(s), ${accepted.length} accepted exception(s), ${unavailable.length} check(s) unavailable`);

// Exit 1 on findings so a gate can act, but only on real findings —
// unavailable checks must not fail a build they cannot judge.
process.exit(errors.length > 0 ? 1 : 0);
