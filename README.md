# busy-office-engine

Engine repo per ARCHITECTURE.md: skills ×6 · lints ×3 · transport · trust.
Pinned by version from every consumer repo (busy-office-erp, ui, output).
Status: extraction in progress (erp issue #1).

Decisions about this repo's own internals live in its own graph once a
round-table runs here (ADR-11 boundary) — nothing in this repo is
ratified yet; this is bootstrap scaffolding only.

Licensed **Apache-2.0**, ratified by the sponsor — see ADR-18 in
busy-office-erp (closes OQ-LICENSE-ENGINE).

## What's here so far

- `lints/graph-lint/` — line-cap + unique-ID check for a DESIGN-GRAPH.md
  file, generalized from busy-office-erp's `scripts/graph-lint.mjs`.
- `lints/trust-lint/` — bo-manifest structure/consistency check +
  workflow SHA-pin check, generalized from busy-office-erp's
  `scripts/trust-lint.mjs`.

- `transport/` — the delta classifier (ADR-05, rules in erp ADR-20) and
  its CLI. Given two versions of a contract it answers hot / additive /
  breaking, and exits 0 / 1 / 2 so a CI gate can act on it:

  ```
  bo-transport classify before.json after.json
  ```

- `lints/conflict-lint/` — `bo-conflict-lint`: fails on unresolved
  `<<<<<<<` markers in any tracked file. It exists because their absence
  let markers reach a default branch unnoticed.

- `audit/` — `bo-audit` (PRN-12): coverage, consistency, completeness and
  separation-of-duties checks read from artifacts that already exist. A
  check that cannot see its evidence reports UNAVAILABLE rather than
  passing, and only real findings exit non-zero.

  ```
  bo-audit <repo-path> [--repo=owner/name] [--limit=N]
  ```

## Not here yet

The remaining transport verbs (assemble·impact·gate·route·stamp, ADR-05 —
only the classifier has a consumer today), the third lint, remaining
skills, and npm publishing. erp consumes this repo by exact commit SHA
since S0.16; a version pin waits for npm.
