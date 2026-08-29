#!/usr/bin/env node
// ADR-06 trust A-floor: manifest structure/consistency + workflow SHA-pin check.
// Generalized from busy-office-erp/scripts/trust-lint.mjs. No external deps
// (stdlib/platform-first): hand-rolled checks, not a JSON-schema lib.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const manifestPath = flag("manifest", "bo-manifest.json");
const workflowDir = flag("workflows", ".github/workflows");

let failed = false;
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  failed = true;
};
const ok = (msg) => console.log(`OK ${msg}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.schemaVersion !== 1) fail(`manifest: schemaVersion must be 1, got ${manifest.schemaVersion}`);
else ok("manifest: schemaVersion == 1");

if (!Number.isInteger(manifest.counter) || manifest.counter < 0) {
  fail(`manifest: counter must be a non-negative integer, got ${manifest.counter}`);
} else {
  ok(`manifest: counter == ${manifest.counter}`);
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;
for (const [i, a] of (manifest.artifacts ?? []).entries()) {
  if (!digestPattern.test(a.digest)) fail(`manifest: artifacts[${i}].digest malformed: ${a.digest}`);
  if (!Number.isInteger(a.size) || a.size < 0) fail(`manifest: artifacts[${i}].size invalid: ${a.size}`);
}

if (manifest.counter === 0) {
  if (manifest.signature !== null) fail("manifest: counter is 0 (unsigned) but signature is not null");
  if ((manifest.artifacts ?? []).length !== 0) fail("manifest: counter is 0 (unsigned) but artifacts is non-empty");
  if (manifest.expires !== "SET-AT-FIRST-SIGNING") {
    fail(`manifest: counter is 0 but expires is not the unsigned sentinel: ${manifest.expires}`);
  }
  ok("manifest: unsigned-scaffold invariants hold");
} else {
  if (!manifest.signature) fail("manifest: counter > 0 but signature is missing");
  if ((manifest.artifacts ?? []).length === 0) fail("manifest: counter > 0 but artifacts is empty");
  if (manifest.expires === "SET-AT-FIRST-SIGNING") fail("manifest: counter > 0 but expires was never set");
  else if (new Date(manifest.expires).getTime() < Date.now()) fail(`manifest: expired at ${manifest.expires}`);
  else ok(`manifest: signed, expires ${manifest.expires}`);
}

let workflowFiles = [];
try {
  workflowFiles = readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
} catch {
  // no workflows dir — nothing to check
}

const usesPattern = /^\s*-?\s*uses:\s*([^\s#]+)/;
const shaRefPattern = /^[^@]+@[0-9a-f]{40}$/;

for (const file of workflowFiles) {
  const content = readFileSync(join(workflowDir, file), "utf8");
  for (const [i, line] of content.split("\n").entries()) {
    const m = line.match(usesPattern);
    if (!m) continue;
    const ref = m[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
    if (!shaRefPattern.test(ref)) {
      fail(`workflow: ${file}:${i + 1} action not SHA-pinned: ${ref}`);
    }
  }
}
if (workflowFiles.length > 0) ok(`workflows: ${workflowFiles.length} file(s) checked for SHA pins`);

if (failed) process.exit(1);
console.log("PASS trust-lint");
