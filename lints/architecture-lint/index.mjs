#!/usr/bin/env node
// Architecture drift lint (erp ADR-33). Fails when a component exists that
// the architecture document names nowhere, or when a ratified count no
// longer matches the set it claims to describe.
//
// It deliberately does NOT fail on declared-but-unbuilt components. In a
// project that builds depth only when a slice needs it, those are the plan
// working — failing on them would make the gate cry wolf and get removed.
//
// Usage: bo-architecture-lint [repo-path]

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.cwd();

let state;
try {
  state = JSON.parse(execFileSync("node", [join(here, "collect.mjs"), repo], { encoding: "utf8" }));
} catch (e) {
  console.error(`FAIL architecture-lint could not read ${repo}: ${e.message}`);
  process.exit(2);
}

if (state.warnings?.length) {
  for (const w of state.warnings) console.log(`NOTE ${w}`);
}

const drift = state.drift ?? [];
const violations = state.dependencies?.violations ?? [];

for (const v of violations) {
  console.error(`FAIL ${v.message}`);
  console.error(`     ${v.from} -> ${v.to}`);
}
for (const d of drift) {
  console.error(`FAIL [${d.kind}] ${d.message}`);
}

const pending = state.pending ?? [];
if (pending.length > 0) {
  console.log(`OK ${pending.length} component(s) declared and not yet built — planned, not drift`);
}

if (drift.length > 0 || violations.length > 0) process.exit(1);

const built = (state.layers ?? []).reduce((n, l) => n + l.components.length, 0);
console.log(`PASS architecture-lint — ${built} component(s), ${state.dependencies?.edges.length ?? 0} edge(s), no drift, no outward dependencies`);
