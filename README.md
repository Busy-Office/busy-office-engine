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

## Not here yet

Transport v0 (assemble·impact·gate·route·stamp, ADR-05), the third lint,
remaining skills, and npm publishing/pinning — erp still vendors its own
copies of graph-lint/trust-lint locally until transport can pin this repo
by version (tracked in erp issue #1).
