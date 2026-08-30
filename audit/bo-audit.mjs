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

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { loadGraph, graphIds } from "../lints/shared/graph-shards.mjs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const findings = [];
const finding = (check, severity, message, evidence) =>
  findings.push({ check, severity, message, evidence });

/**
 * What a check actually examined (ADR-60).
 *
 * Four times now a check has been the defect rather than the code, and
 * every one was a SCOPE error: the shard check read module_core only
 * (ADR-41), the graph cap counted lines while rows doubled (ADR-43), the
 * citation check read five named files (ADR-56), and this tool never asked
 * whether SESSIONS.md was current (ADR-59). Each sat adjacent to the thing
 * it should have caught, facing slightly the wrong way.
 *
 * A fixture proves a check can fail (ADR-42). It cannot prove the check
 * looks in the right places — ADR-41's mis-scoped version would have passed
 * a fixture happily.
 *
 * So each check says what it looked at, and the reader compares that to
 * what they know is there. "scanned 5 documents" beside a repo of sixty
 * markdown files is visibly wrong in a way that reading the source is not.
 * This does not verify scope; it makes scope legible, which is the cheapest
 * thing that would have caught all four.
 */
const scopes = [];
const scope = (check, examined) => scopes.push({ check, examined });

/** Every ID the graph defines, by type. */
function readGraph(repo) {
  const path = join(repo, "DESIGN-GRAPH.md");
  if (!existsSync(path)) return null;
  // The graph may be sharded (ADR-48). Reading only the index would report
  // every node in a shard as undefined — turning a correct citation into a
  // finding, which is the worst kind of false positive: it trains readers to
  // ignore the check.
  const graph = loadGraph(path);
  return { text: graph.index.text, ids: graphIds(graph), shards: graph.shards.length };
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
/**
 * What a node id looks like, in one place. Two shapes and neither is
 * "TYPE- anything": PRN, ADR, DA and KRN are numbered; OQ ids are
 * uppercase words. Used for both citations and exemptions, so the two can
 * never disagree about what an id is.
 */
const NODE_ID = /\b((?:PRN|ADR|DA|KRN)-\d+|OQ-[A-Z][A-Z-]*[A-Z])\b/g;

function checkCoverage(repo, graph) {
  if (!graph) return finding("coverage", "unavailable", "no DESIGN-GRAPH.md found", null);

  const KNOWN_EXTERNAL = /^(ADR-0\d\d)$/; // three-digit IDs belong to sibling repos
  let checked = 0;

  // Every markdown file in the repo, not a hardcoded five (ADR-56).
  //
  // This check read exactly ARCHITECTURE.md, PROJECT-PLAN.md, AGENTS.md,
  // SESSIONS.md and README.md — a list that was right when it was written
  // and stopped covering where citations actually live. ADRs cite node ids
  // constantly. So do package shards. So do source comments. None of them
  // was checked, and a node cited five times and defined nowhere passed
  // clean.
  //
  // Same shape as the shard check ADR-41 fixed: a hardcoded scope that
  // reports green about the places it does not look.
  const files = markdownAndSource(repo);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(`${repo}/`, "");

    // A file may DISCUSS an id it does not cite — an ADR explaining that a
    // citation was wrong, a test asserting the error message. Without an
    // opt-out you cannot write about a dangling citation without creating
    // one, which conflict-lint hit first and solved by anchoring its
    // pattern. An id in prose looks exactly like an id in a citation, so
    // anchoring cannot work here and the exemption has to be explicit.
    //
    // Named ids only, never a blanket skip, so it stays greppable and so a
    // file cannot quietly excuse everything it says.
    // The ids in an exemption are found with the SAME pattern that finds
    // citations, not a second looser one. The first attempt used a
    // character class including `-`, which swallowed an HTML comment's
    // `-->` and produced an id called "OQ-LICENSE --" that matched nothing.
    // Two patterns for one concept is the ADR-52 mistake, in miniature and
    // within a single function.
    const exempt = new Set();
    for (const e of text.matchAll(/graph-cite-exempt:([^\n>]*)/g)) {
      for (const m of e[1].matchAll(NODE_ID)) exempt.add(m[1]);
    }
    for (const id of exempt) {
      // An exemption for an id the graph DOES define is stale — the same
      // rot check ADR-50 put on contract exemptions.
      if (graph.ids.has(id)) {
        finding("coverage", "error", `${rel} exempts ${id} from citation checking, but the graph defines it — drop the exemption`, rel);
      }
    }
    // Node ids have two shapes and neither is "TYPE- anything". PRN, ADR,
    // DA and KRN are numbered; OQ ids are uppercase words. The looser
    // pattern this replaces matched filename slugs — `ADR-15-stack` came
    // back as a citation of a node called `ADR-15-stack` — which would have
    // buried the real finding under thirty false ones.
    for (const m of text.matchAll(NODE_ID)) {
      const id = m[1];
      checked += 1;
      if (!graph.ids.has(id) && !KNOWN_EXTERNAL.test(id) && !exempt.has(id)) {
        finding("coverage", "error", `${rel} cites ${id}, which the graph does not define`, rel);
      }
    }
  }
  scope("coverage", `${files.length} file(s) — every .md/.mjs/.js outside node_modules, DESIGN-GRAPH.md excluded (it defines the ids)`);
  return checked;
}

/**
 * Where citations live: prose and code comments alike. A node id in a
 * source comment is a citation with the same claim as one in a document —
 * that the reader can go and look the node up.
 */
function markdownAndSource(repo) {
  const out = [];
  const skip = new Set(["node_modules", ".git", "must-fail"]);
  const stack = [repo];
  while (stack.length) {
    const dir = stack.pop();
    let items = [];
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const p = join(dir, it.name);
      if (it.isDirectory()) { if (!skip.has(it.name)) stack.push(p); continue; }
      // The graph defines the ids; citing itself is not a citation.
      if (p === join(repo, "DESIGN-GRAPH.md")) continue;
      if (/\.(md|mjs|js)$/.test(it.name)) out.push(p);
    }
  }
  return out;
}

// ---- check 1b: the session log is current -------------------------------
// Fifteen sessions went unlogged in busy-office-erp before anyone noticed,
// because every entry was written by anchoring on the previous entry's last
// line — the first write silently no-opped and each one after it anchored
// on text that was not there.
//
// Nothing caught it. This check reads the citations IN SESSIONS.md and
// never asked whether SESSIONS.md was current, which is the ADR-41 shape
// again: a check adjacent to the defect, looking the other way.
//
// The newest node in the graph is the cheapest thing to test against. A
// session that decided nothing adds no node and is not caught here — that
// limit is real and stated, but a session that ratified an ADR and did not
// log it now cannot merge.
function checkSessionLog(repo, graph) {
  const path = join(repo, "SESSIONS.md");
  if (!existsSync(path)) return finding("session-log", "unavailable", "no SESSIONS.md found", null);
  if (!graph) return finding("session-log", "unavailable", "no graph to take the newest node from", null);

  const numbered = [...graph.ids]
    .map((id) => /^(PRN|ADR|DA)-(\d+)$/.exec(id))
    .filter(Boolean)
    .map((m) => ({ id: m[0], type: m[1], n: Number(m[2]) }));

  const sessions = readFileSync(path, "utf8");
  scope("session-log", `SESSIONS.md against the newest numbered ADR and DA in the graph — a session that decided nothing is NOT covered`);
  for (const type of ["ADR", "DA"]) {
    const ofType = numbered.filter((x) => x.type === type);
    if (ofType.length === 0) continue;
    const newest = ofType.reduce((a, b) => (b.n > a.n ? b : a));
    if (!new RegExp(`\\b${newest.id}\\b`).test(sessions)) {
      finding("session-log", "error", `${newest.id} is the newest ${type} in the graph and SESSIONS.md does not mention it — the session that ratified it did not log itself`, "SESSIONS.md");
    }
  }
  return true;
}

// ---- check 2: consistency — operations cited but never declared ---------
// This is the gap ADR-29 found and named: an operation can appear in change
// documents and tests while no op contract declares it. Trigger-coverage
// misses it, because such an operation drives no transition.
function checkConsistency(repo, contracts) {
  const declared = new Set(contracts.opContracts.map((o) => o.operation));
  scope("consistency", `${declared.size} declared operation(s) against every source and doc under kernel/, module_core/, tests/`);
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
  scope("coverage-tests", `${contracts.opContracts.length} operation(s) against ${testFiles.length} test file(s) — asks whether each is NAMED, never whether the test asserts anything`);

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

  // Every package should carry a shard, and it should name its owning seat
  // — ADR-13 says the shard is owned, not merely present.
  //
  // This check used to read `module_core/*` only, and only where a
  // `contracts/` directory existed. Both halves were wrong in the same
  // direction: kernel components ship no contracts, so eight of them went
  // unshaded for thirty sessions and this check reported clean the whole
  // time. It was found by a person asking, not by the audit.
  //
  // So the gate is now "does this directory hold code or contracts",
  // which is the actual condition ADR-13 states, rather than a proxy that
  // happened to match module_core.
  const shardsSeen = [];
  for (const root of ["kernel", "module_core", "module_extension", "projects"]) {
    const base = join(repo, root);
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base)) {
      const dir = join(base, pkg);
      if (!statSync(dir).isDirectory()) continue;
      if (!holdsWork(dir)) continue;
      shardsSeen.push(`${root}/${pkg}`);
      checkShard(dir, `${root}/${pkg}`, finding);
    }
  }

  // tests/ is a package by this rule too, and the sharpest one to leave
  // undocumented: in a repo where modules are declarative, the end-to-end
  // tests are the only thing that assembles them.
  const tests = join(repo, "tests");
  if (existsSync(tests) && holdsWork(tests)) { checkShard(tests, "tests", finding); shardsSeen.push("tests"); }
  scope("coverage-docs", `${shardsSeen.length} package(s) holding code or contracts across kernel/, module_core/, module_extension/, projects/, tests/`);
}

/** A directory holds work if it has code or contracts — not merely files. */
function holdsWork(dir) {
  if (existsSync(join(dir, "contracts"))) return true;
  return readdirSync(dir).some((f) => f.endsWith(".mjs") || f.endsWith(".js") || f.endsWith(".ts"));
}

function checkShard(dir, label, finding) {
  const shardPath = join(dir, "CLAUDE.md");
  if (!existsSync(shardPath)) {
    finding("coverage-docs", "error", `${label} holds work but has no CLAUDE.md shard`, label);
    return;
  }
  const shard = readFileSync(shardPath, "utf8");
  const lines = shard.split("\n").length;
  if (lines > 60) {
    finding("coverage-docs", "error", `${label}/CLAUDE.md is ${lines} lines — the cap is 60`, label);
  }
  if (!/^\s*(?:Owner|Seat):/mi.test(shard)) {
    finding("coverage-docs", "error", `${label}/CLAUDE.md names no owning seat — a shard is owned, not merely present`, label);
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

  scope("sod", `the last ${limit} merged PR(s) of ${slug}, plus direct commits when there are none — reviews only, so an approval from the author's own second account would still read as reviewed`);

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
checkSessionLog(repo, graph);
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

if (scopes.length > 0) {
  console.log("\nWhat each check examined (ADR-60 — scope is where checks have gone wrong, not logic):");
  for (const sc of scopes) console.log(`  [${sc.check}] ${sc.examined}`);
}

if (unavailable.length > 0) {
  console.log("\nNot checked (evidence unavailable — not the same as passing):");
  for (const f of unavailable) console.log(`  [${f.check}] ${f.message}`);
}

console.log(`\n${errors.length} finding(s), ${accepted.length} accepted exception(s), ${unavailable.length} check(s) unavailable`);

// Exit 1 on findings so a gate can act, but only on real findings —
// unavailable checks must not fail a build they cannot judge.
process.exit(errors.length > 0 ? 1 : 0);
