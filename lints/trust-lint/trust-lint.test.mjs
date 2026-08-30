// trust-lint has no tests, and this file exists to say so (ADR-62).
//
// A gate with no test file is invisible; a gate whose tests live inside a
// bundle covering three of four reads as covered, which is what happened
// at ADR-61. So every gate gets a file, and one with nothing in it says
// what is missing and why.
//
// What it needs: a signed manifest fixture and a key. ADR-42 named that as
// real work rather than an oversight when the erp harness skipped it, and
// nothing since has made it smaller. It touches trust material rather than
// test scaffolding, which is why it has not been done in passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("trust-lint exists and is reachable — the only thing asserted here", () => {
  // Deliberately weak, and labelled. It proves the file is there and
  // nothing about whether it works.
  assert.ok(existsSync(join(here, "index.mjs")));
});

test("the manifest fixture trust-lint would need is still absent", () => {
  // Fails the day somebody adds the fixture without adding the tests,
  // which is the only way this gap closes quietly.
  assert.equal(
    existsSync(join(here, "fixtures", "bo-manifest.signed.json")),
    false,
    "a signed fixture exists — write the trust-lint tests it was added for",
  );
});
