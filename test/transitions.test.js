const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTransition, ALLOWED_TRANSITIONS } = require("../dist/transitions.js");

test("ALLOWED_TRANSITIONS is a plain data table, not empty", () => {
  assert.equal(Array.isArray(ALLOWED_TRANSITIONS), true);
  assert.equal(ALLOWED_TRANSITIONS.length > 0, true);
});

// The one rule worth building this library for (BUG-1 acceptance, verbatim):
// assertTransition('FIX_PROPOSED', 'DONE', 'agent') throws; ('reporter') passes.
test("confirmFix: FIX_PROPOSED -> DONE by the agent throws", () => {
  assert.throws(() => assertTransition("FIX_PROPOSED", "DONE", "agent"), /Niedozwolone przejście/);
});

test("confirmFix: FIX_PROPOSED -> DONE by the reporter passes", () => {
  assert.doesNotThrow(() => assertTransition("FIX_PROPOSED", "DONE", "reporter"));
});

test("confirmFix: FIX_PROPOSED -> DONE by 'system' throws (only the reporter closes)", () => {
  assert.throws(() => assertTransition("FIX_PROPOSED", "DONE", "system"), /Niedozwolone przejście/);
});

// Pytanie (question): agent asks from TRIAGE/ACCEPTED/IN_PROGRESS, ticket goes to NEEDS_INFO.
test("question: TRIAGE -> NEEDS_INFO by the agent passes", () => {
  assert.doesNotThrow(() => assertTransition("TRIAGE", "NEEDS_INFO", "agent"));
});

test("question: TRIAGE -> NEEDS_INFO by the reporter throws (only the agent asks)", () => {
  assert.throws(() => assertTransition("TRIAGE", "NEEDS_INFO", "reporter"), /Niedozwolone przejście/);
});

// Odpowiedź (answer): reporter answers, back to TRIAGE.
test("answer: NEEDS_INFO -> TRIAGE by the reporter passes", () => {
  assert.doesNotThrow(() => assertTransition("NEEDS_INFO", "TRIAGE", "reporter"));
});

test("answer: NEEDS_INFO -> TRIAGE by the agent throws (only the reporter answers)", () => {
  assert.throws(() => assertTransition("NEEDS_INFO", "TRIAGE", "agent"), /Niedozwolone przejście/);
});

// Odrzucenie poprawki (rejectFix): reporter sends a proposed fix back to REWORK.
test("rejectFix: FIX_PROPOSED -> REWORK by the reporter passes", () => {
  assert.doesNotThrow(() => assertTransition("FIX_PROPOSED", "REWORK", "reporter"));
});

test("rejectFix: FIX_PROPOSED -> REWORK by the agent throws", () => {
  assert.throws(() => assertTransition("FIX_PROPOSED", "REWORK", "agent"), /Niedozwolone przejście/);
});

// Ponowne otwarcie (reopen): reporter reopens a DONE ticket.
test("reopen: DONE -> TRIAGE by the reporter passes", () => {
  assert.doesNotThrow(() => assertTransition("DONE", "TRIAGE", "reporter"));
});

test("reopen: DONE -> TRIAGE by the agent throws", () => {
  assert.throws(() => assertTransition("DONE", "TRIAGE", "agent"), /Niedozwolone przejście/);
});

test("an entirely unlisted transition throws regardless of actor", () => {
  assert.throws(() => assertTransition("NEW", "DONE", "agent"), /Niedozwolone przejście/);
  assert.throws(() => assertTransition("NEW", "DONE", "reporter"), /Niedozwolone przejście/);
  assert.throws(() => assertTransition("NEW", "DONE", "system"), /Niedozwolone przejście/);
});

test("the thrown message is in Polish and names both statuses", () => {
  try {
    assertTransition("FIX_PROPOSED", "DONE", "agent");
    assert.fail("expected assertTransition to throw");
  } catch (error) {
    assert.match(error.message, /Do testów/);
    assert.match(error.message, /Zrealizowane/);
    assert.match(error.message, /agent/);
  }
});
