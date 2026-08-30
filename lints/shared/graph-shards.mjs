// Loading a graph that may be sharded (ADR-48).
//
// ADR-13 said "graph index + capped per-package shards" and "hard cap 150
// lines; shard on breach". The breach arrived, and both tools that read the
// graph read exactly one file — so a shard would have made every node in it
// invisible to the citation check and the uniqueness check at once.
//
// A shard is declared in the index, never discovered. Discovery by
// convention would mean a file dropped in the right directory silently
// becomes truth; naming it means the index still says what the graph
// consists of.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const DECLARATION = /^\s*Sharded to\s+([^\s(]+)/gm;
const ROW_ID = /^\|\s*(?:~~)?([A-Z][A-Z0-9]*-[A-Za-z0-9-]+)(?:~~)?\s*\|/;

/**
 * @param {string} indexPath - path to DESIGN-GRAPH.md
 * @returns {{index: {path, text}, shards: {path, text}[], missing: string[]}}
 */
export function loadGraph(indexPath) {
  const text = readFileSync(indexPath, "utf8");
  const base = dirname(indexPath);
  const shards = [];
  const missing = [];

  for (const m of text.matchAll(DECLARATION)) {
    const rel = m[1];
    const p = isAbsolute(rel) ? rel : join(base, rel);
    if (!existsSync(p)) { missing.push(rel); continue; }
    shards.push({ path: p, text: readFileSync(p, "utf8") });
  }

  return { index: { path: indexPath, text }, shards, missing };
}

/** Every node id defined anywhere in the graph, index and shards alike. */
export function graphIds(graph) {
  const ids = new Set();
  for (const part of [graph.index, ...graph.shards]) {
    for (const line of part.text.split("\n")) {
      const m = line.match(ROW_ID);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

/** Rows across the whole graph, carrying where they came from. */
export function graphRows(graph) {
  const rows = [];
  for (const part of [graph.index, ...graph.shards]) {
    part.text.split("\n").forEach((line, i) => {
      const m = line.match(ROW_ID);
      if (m) rows.push({ id: m[1], line, lineNumber: i + 1, source: part.path });
    });
  }
  return rows;
}
