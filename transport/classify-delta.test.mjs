import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDelta, deployPlan } from "./classify-delta.mjs";

// A KRN-0-shaped ontology contract, as the classifier will really see it.
const vendor = () => ({
  version: "0.1.0",
  entity: "Vendor",
  labelKey: "masterdata.vendor",
  identity: ["vendorId"],
  fields: [
    { name: "vendorId", type: "string", labelKey: "masterdata.vendor.id", required: true },
    { name: "name", type: "string", labelKey: "masterdata.vendor.name", required: true },
  ],
});

const clone = (o) => JSON.parse(JSON.stringify(o));

test("an identical contract is hot", () => {
  const r = classifyDelta(vendor(), vendor());
  assert.equal(r.class, "hot");
  assert.equal(r.reasons.length, 0);
});

test("changing display text only is hot", () => {
  const after = clone(vendor());
  after.labelKey = "masterdata.supplier";
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "hot");
});

test("adding an optional field is additive", () => {
  const after = clone(vendor());
  after.fields.push({ name: "taxId", type: "string", labelKey: "masterdata.vendor.taxid", required: false });
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "additive");
  assert.match(r.reasons[0].why, /added fields\["taxId"\]/);
});

test("adding a REQUIRED field is breaking — existing documents lack it", () => {
  const after = clone(vendor());
  after.fields.push({ name: "taxId", type: "string", labelKey: "masterdata.vendor.taxid", required: true });
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "breaking");
  assert.match(r.reasons[0].why, /required/);
});

test("removing a field is breaking", () => {
  const after = clone(vendor());
  after.fields = after.fields.filter((f) => f.name !== "name");
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "breaking");
  assert.match(r.reasons[0].why, /removed fields\["name"\]/);
});

test("making an optional field required is breaking", () => {
  const before = clone(vendor());
  before.fields[1].required = false;
  const r = classifyDelta(before, vendor());
  assert.equal(r.class, "breaking");
  assert.match(r.reasons[0].why, /optional became required/);
});

test("relaxing a required field to optional is additive", () => {
  const after = clone(vendor());
  after.fields[1].required = false;
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "additive");
});

test("reordering fields is not a change — identity is by name, not position", () => {
  const after = clone(vendor());
  after.fields.reverse();
  assert.equal(classifyDelta(vendor(), after).class, "hot");
});

test("changing a field's type is breaking", () => {
  const after = clone(vendor());
  after.fields[0].type = "integer";
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "breaking");
});

test("widening an enum is additive, narrowing it is breaking", () => {
  const before = { values: ["draft", "approved"] };
  const wider = { values: ["draft", "approved", "cancelled"] };
  assert.equal(classifyDelta(before, wider).class, "additive");
  assert.equal(classifyDelta(wider, before).class, "breaking");
});

test("a state machine gaining a transition is additive; losing one is breaking", () => {
  const sm = {
    version: "0.1.0",
    machine: "PurchaseOrderLifecycle",
    states: [{ name: "draft" }, { name: "approved" }],
    transitions: [{ name: "approve", from: "draft", to: "approved" }],
  };
  const grown = clone(sm);
  grown.transitions.push({ name: "cancel", from: "draft", to: "cancelled" });
  grown.states.push({ name: "cancelled" });
  assert.equal(classifyDelta(sm, grown).class, "additive");
  assert.equal(classifyDelta(grown, sm).class, "breaking");
});

test("changing an operation's authz is breaking — permission is contract surface", () => {
  const before = { operation: "approvePurchaseOrder", authz: { object: "PurchaseOrder", action: "approve" } };
  const after = clone(before);
  after.authz.action = "post";
  const r = classifyDelta(before, after);
  assert.equal(r.class, "breaking");
});

test("a version pin moving on its own is hot", () => {
  const after = clone(vendor());
  after.version = "0.2.0";
  assert.equal(classifyDelta(vendor(), after).class, "hot");
});

test("the most severe change wins when a delta mixes classes", () => {
  const after = clone(vendor());
  after.labelKey = "masterdata.supplier";                                    // hot
  after.fields.push({ name: "taxId", type: "string", required: false });     // additive
  after.fields = after.fields.filter((f) => f.name !== "name");              // breaking
  const r = classifyDelta(vendor(), after);
  assert.equal(r.class, "breaking");
  assert.ok(r.reasons.length >= 3, "every reason is reported, not just the worst");
});

test("every class carries a deploy plan citing ADR-07", () => {
  for (const cls of ["hot", "additive", "breaking"]) {
    assert.ok(deployPlan(cls).length > 0);
  }
  assert.match(deployPlan("breaking"), /flag cutover/);
});
