#!/usr/bin/env node
// Collect a layered project's architecture AS BUILT, and compare it to what
// the documents claim.
//
// The point is the comparison. An ARCHITECTURE.md is a rendering, and
// renderings go stale silently — a directory appears, a component is never
// built, a declared count stops matching reality, and nothing complains
// because prose has no build step. This reads the filesystem and the import
// graph first, then checks the documents against it, never the reverse.
//
// Usage: node collect-architecture.mjs [repoPath]

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repo = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.cwd();
const read = (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : null);

const out = {
  repo,
  collectedAt: new Date().toISOString(),
  collectedAtLocal: new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
  layers: [],
  modules: [],
  declared: {},
  drift: [],
  dependencies: { edges: [], violations: [] },
  contracts: { byModule: {} },
  warnings: [],
};

const note = (kind, message, evidence) => out.drift.push({ kind, message, evidence });

// ---- layers as built ----------------------------------------------------
// A layer is a top-level source directory. Ordering matters for the
// dependency rule, so it is declared here rather than inferred.
const LAYER_ORDER = ["kernel", "module_core", "module_extension", "projects"];

for (const layer of LAYER_ORDER) {
  const dir = join(repo, layer);
  if (!existsSync(dir)) continue;
  const components = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  out.layers.push({ name: layer, rank: LAYER_ORDER.indexOf(layer), components });
}

// ---- what the documents claim ------------------------------------------
const arch = read("ARCHITECTURE.md");
const graph = read("DESIGN-GRAPH.md");

if (arch) {
  // Components named in the ASCII tree, per layer.
  const treeMatch = arch.match(/```[\s\S]*?```/);
  const tree = treeMatch ? treeMatch[0] : "";
  const declaredIn = (layer) => {
    const names = new Set();
    let inLayer = false;
    for (const line of tree.split("\n")) {
      if (new RegExp(`[├└]──\\s+${layer}/`).test(line)) { inLayer = true; continue; }
      if (inLayer && /^[├└]──/.test(line.trim().replace(/^│\s*/, "")) && !/^│/.test(line)) break;
      if (inLayer) {
        const m = line.match(/│\s+[├└]──\s+([a-z0-9-]+)\//);
        if (m) names.add(m[1]);
      }
    }
    return [...names];
  };
  out.declared.kernel = declaredIn("kernel");
  out.declared.module_core = declaredIn("module_core");
} else {
  out.warnings.push("no ARCHITECTURE.md — nothing to check the build against");
}

// Counts asserted in the graph, e.g. "Kernel ×8", "module_core ×6".
if (graph) {
  for (const m of graph.matchAll(/\|\s*(ADR-\d+)\s*\|\s*([^|]*?)(?:Kernel|kernel)\s*×\s*(\d+)/g)) {
    out.declared.kernelCount = { node: m[1], count: Number(m[3]) };
  }
  for (const m of graph.matchAll(/\|\s*(ADR-\d+)\s*\|\s*([^|]*?)module_core\s*×\s*(\d+)/g)) {
    out.declared.moduleCoreCount = { node: m[1], count: Number(m[3]) };
  }
}

// ---- drift: built vs declared ------------------------------------------
const built = (layer) => out.layers.find((l) => l.name === layer)?.components ?? [];

// Two findings that look alike and are not. In a phased project a declared
// component that does not exist yet is the plan working — depth is built
// when a slice needs it. A component that exists and is declared NOWHERE is
// drift: it entered without the document that describes the system being
// told. Only the second is a defect; reporting both as problems would make
// the report cry wolf and get ignored.
for (const layer of ["kernel", "module_core"]) {
  const declared = out.declared[layer];
  if (!declared) continue;

  for (const c of built(layer)) {
    if (!declared.includes(c)) {
      note("undeclared", `${layer}/${c} exists but ARCHITECTURE.md does not list it`, `${layer}/${c}`);
    }
  }
  for (const c of declared) {
    if (!built(layer).includes(c)) {
      out.pending = out.pending ?? [];
      out.pending.push({ layer, component: c, note: "declared, not yet built" });
    }
  }
}

// Compare SETS, not counts. The first version of this check compared
// lengths, and passed on a kernel where eight were declared and eight
// existed — while two of the declared were unbuilt and two of the built
// were undeclared. Equal totals hid a real mismatch.
for (const [layer, key] of [["kernel", "kernelCount"], ["module_core", "moduleCoreCount"]]) {
  const claim = out.declared[key];
  if (!claim) continue;

  const declared = out.declared[layer] ?? [];
  const actual = built(layer);
  const extra = actual.filter((c) => !declared.includes(c));

  if (declared.length !== claim.count) {
    note(
      "count",
      `${claim.node} asserts ${layer} ×${claim.count}, but ARCHITECTURE.md lists ${declared.length} — the node and its rendering disagree`,
      claim.node,
    );
  }
  if (extra.length > 0) {
    note(
      "count",
      `${claim.node} asserts ${layer} ×${claim.count}; ${extra.length} component(s) exist outside that set (${extra.join(", ")}) — either the node is amended or they justify their place`,
      claim.node,
    );
  }
}

// ---- dependency direction ----------------------------------------------
// The rule most layered projects state and few enforce: dependencies point
// inward only. This reads real imports rather than trusting the statement.
const rankOf = (path) => {
  const top = path.split("/")[0];
  const i = LAYER_ORDER.indexOf(top);
  return i === -1 ? null : i;
};

const scan = (dir) => {
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(full);
      } else if (/\.(mjs|js|ts|tsx)$/.test(e.name)) {
        files.push(full);
      }
    }
  };
  walk(dir);
  return files;
};

for (const layer of LAYER_ORDER) {
  const dir = join(repo, layer);
  if (!existsSync(dir)) continue;

  for (const file of scan(dir)) {
    const rel = relative(repo, file);
    const fromRank = rankOf(rel);
    const text = readFileSync(file, "utf8");

    for (const m of text.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // package imports are not layer edges

      // Resolve the relative import to a repo path.
      const fileDir = file.slice(0, file.lastIndexOf("/"));
      const resolved = relative(repo, join(fileDir, spec));
      const toRank = rankOf(resolved);
      if (toRank === null || fromRank === null) continue;

      const edge = { from: rel, to: resolved, fromLayer: LAYER_ORDER[fromRank], toLayer: LAYER_ORDER[toRank] };
      out.dependencies.edges.push(edge);

      // Lower rank is more inward. Importing outward is the violation.
      if (toRank > fromRank) {
        out.dependencies.violations.push({
          ...edge,
          message: `${LAYER_ORDER[fromRank]} imports from ${LAYER_ORDER[toRank]} — dependencies point inward only`,
        });
      }
    }
  }
}

// ---- contract coverage per module --------------------------------------
const SUFFIXES = {
  ".ontology.json": "L2 ontology",
  ".state-machine.json": "L3 state machine",
  ".op-contract.json": "L4 op contract",
  ".markup.json": "L5 markup",
};

for (const mod of built("module_core")) {
  const dir = join(repo, "module_core", mod, "contracts");
  const have = new Set();
  let files = [];
  try { files = readdirSync(dir); } catch { /* none */ }
  for (const f of files) {
    for (const [suffix, label] of Object.entries(SUFFIXES)) {
      if (f.endsWith(suffix)) have.add(label);
    }
  }
  out.contracts.byModule[mod] = {
    have: [...have].sort(),
    missing: Object.values(SUFFIXES).filter((l) => !have.has(l)),
    fileCount: files.length,
  };
}

// ---- code volume, as a rough sense of where the weight sits -------------
for (const layer of out.layers) {
  layer.components = layer.components.map((name) => {
    const dir = join(repo, layer.name, name);
    let lines = 0, files = 0, tests = 0;
    for (const f of scan(dir)) {
      files += 1;
      if (/\.test\.[a-z]+$/.test(f)) tests += 1;
      try { lines += readFileSync(f, "utf8").split("\n").length; } catch { /* skip */ }
    }
    return { name, files, tests, lines };
  });
}

if (out.layers.length === 0) {
  out.warnings.push("no recognised source layers — is this a layered project?");
}

process.stdout.write(JSON.stringify(out, null, 2));
