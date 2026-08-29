// Delta classifier (ADR-05, rules in erp ADR-20). Given the old and new
// version of a contract document, decide how its change must be deployed:
//
//   hot      — no contract surface changed (labels, prose, ordering).
//              Deployable in seconds, no coordination.
//   additive — the contract grew. Old callers keep working, so this can
//              roll out with dual-run under expand-contract (ADR-07).
//   breaking — the contract shrank or tightened. Some existing caller or
//              stored document becomes invalid, so it needs expand →
//              dual-run → flag cutover → removal on a later train.
//
// The asymmetry is the whole point: growing a contract is safe, shrinking
// or tightening one is not. When in doubt the classifier returns the more
// severe class — a false "breaking" costs a slower deploy, a false
// "additive" costs a production incident.

const CLASSES = ["hot", "additive", "breaking"];
const moreSevere = (a, b) => (CLASSES.indexOf(a) >= CLASSES.indexOf(b) ? a : b);

/**
 * @param {object} before - the contract as currently deployed
 * @param {object} after  - the contract as proposed
 * @returns {{class: "hot"|"additive"|"breaking", reasons: {class: string, why: string}[]}}
 */
export function classifyDelta(before, after) {
  const reasons = [];
  const note = (cls, why) => reasons.push({ class: cls, why });

  walk(before, after, "", note);

  const cls = reasons.reduce((acc, r) => moreSevere(acc, r.class), "hot");
  return { class: cls, reasons };
}

// Fields whose change never affects a caller: display text and prose.
// Everything else is contract surface until proven otherwise — that
// default is deliberate, since the failure mode of guessing "cosmetic"
// is an unannounced breaking change.
const COSMETIC = new Set(["description", "title", "labelKey", "rationale", "note", "$comment"]);

function walk(before, after, path, note) {
  if (before === after) return;

  const at = path || "(root)";

  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const childPath = path ? `${path}.${key}` : key;
      const had = key in before;
      const has = key in after;

      if (had && !has) {
        note(COSMETIC.has(key) ? "hot" : "breaking", `removed ${childPath}`);
        continue;
      }
      if (!had && has) {
        note(classifyAddition(key, after[key], childPath), `added ${childPath}`);
        continue;
      }
      walk(before[key], after[key], childPath, note);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    walkArray(before, after, path, note);
    return;
  }

  // Scalar change.
  const key = path.split(".").pop();
  if (COSMETIC.has(key)) {
    note("hot", `changed ${at} (display text only)`);
  } else if (key === "required" && before === false && after === true) {
    note("breaking", `${at}: optional became required — existing documents omit it`);
  } else if (key === "required" && before === true && after === false) {
    note("additive", `${at}: required became optional`);
  } else if (key === "version") {
    note("hot", `${at}: version pin moved`);
  } else {
    note("breaking", `${at}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  }
}

function walkArray(before, after, path, note) {
  const identify = (v) => (isObject(v) ? v.name ?? v.operation ?? v.entity ?? v.id ?? null : v);

  const beforeKeys = before.map(identify);
  const afterKeys = after.map(identify);

  // Arrays of identifiable members (fields, states, transitions) compare as
  // sets — reordering them is not a contract change. Arrays of anonymous
  // objects fall back to positional comparison.
  if (beforeKeys.every((k) => k !== null) && afterKeys.every((k) => k !== null)) {
    for (const [i, key] of beforeKeys.entries()) {
      const j = afterKeys.indexOf(key);
      if (j === -1) {
        note("breaking", `removed ${path}[${JSON.stringify(key)}]`);
      } else if (isObject(before[i])) {
        walk(before[i], after[j], `${path}[${key}]`, note);
      }
    }
    for (const [j, key] of afterKeys.entries()) {
      if (!beforeKeys.includes(key)) {
        const member = after[j];
        // A new required field invalidates every existing document.
        const breaking = isObject(member) && member.required === true;
        note(breaking ? "breaking" : "additive", `added ${path}[${JSON.stringify(key)}]${breaking ? " (required)" : ""}`);
      }
    }
    return;
  }

  // Anonymous arrays — most often enum value lists. Growing the set of
  // accepted values is additive; shrinking it rejects data that used to
  // be valid.
  for (const v of before) {
    if (!after.some((w) => deepEqual(v, w))) note("breaking", `removed ${path} value ${JSON.stringify(v)}`);
  }
  for (const v of after) {
    if (!before.some((w) => deepEqual(v, w))) note("additive", `added ${path} value ${JSON.stringify(v)}`);
  }
}

function classifyAddition(key, value, path) {
  if (COSMETIC.has(key)) return "hot";
  // An added field that is itself required leaves existing documents invalid.
  if (isObject(value) && value.required === true) return "breaking";
  if (key === "required" && value === true) return "breaking";
  return "additive";
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function deepEqual(a, b) {
  if (a === b) return true;
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}

/** How ADR-07 says each class must be deployed. */
export function deployPlan(cls) {
  return {
    hot: "Deploy directly. No schema coordination needed.",
    additive: "Roll with expand + dual-run (ADR-07). Old callers keep working.",
    breaking: "Expand → dual-run → flag cutover → removal on a later train (ADR-07). Needs a sponsor sign-off per the AGENTS.md gate map.",
  }[cls];
}
