// Shared scaffolding for gate tests (ADR-62).
//
// One file per gate, so a gate with no test file is visible as a missing
// file rather than as an absence inside a bundle. `lints.test.mjs` covered
// three of four lints and read as covering all four — which is exactly how
// a coverage claim went wrong at ADR-61.
//
// Only the scaffolding is shared. Assertions stay in each gate's own file,
// because a shared assertion helper is a second definition of what the gate
// promises (ADR-52).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway repo containing exactly the files a test names. */
export function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "bo-gate-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/**
 * Run a gate. A non-zero exit is the expected path in most of these, so it
 * is returned rather than thrown.
 */
export function run(script, args = []) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
