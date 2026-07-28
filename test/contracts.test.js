const test = require("node:test");
const assert = require("node:assert/strict");
const { STATUS_LABEL, CLOSED_TICKET_STATUSES, TicketStatusSchema, CORE_TICKET_EVENT_TYPES } = require("../dist/contracts.js");

const ALL_11_STATUSES = [
  "NEW",
  "TRIAGE",
  "ACCEPTED",
  "IN_PROGRESS",
  "FIX_PROPOSED",
  "DONE",
  "REJECTED",
  "DUPLICATE",
  "NEEDS_INFO",
  "REWORK",
  "NEEDS_OWNER",
];

test("STATUS_LABEL covers all 11 canonical statuses and no more", () => {
  const keys = Object.keys(STATUS_LABEL).sort();
  assert.deepEqual(keys, [...ALL_11_STATUSES].sort());
  assert.equal(keys.length, 11);
});

test("STATUS_LABEL matches the canon wording verbatim", () => {
  assert.equal(STATUS_LABEL.NEW, "Nowe");
  assert.equal(STATUS_LABEL.TRIAGE, "W analizie");
  assert.equal(STATUS_LABEL.ACCEPTED, "Przyjęte");
  assert.equal(STATUS_LABEL.IN_PROGRESS, "W trakcie");
  assert.equal(STATUS_LABEL.FIX_PROPOSED, "Do testów");
  assert.equal(STATUS_LABEL.DONE, "Zrealizowane");
  assert.equal(STATUS_LABEL.REJECTED, "Odrzucone");
  assert.equal(STATUS_LABEL.DUPLICATE, "Duplikat");
  assert.equal(STATUS_LABEL.NEEDS_INFO, "Czeka na wyjaśnienie");
  assert.equal(STATUS_LABEL.REWORK, "Do poprawy");
  assert.equal(STATUS_LABEL.NEEDS_OWNER, "Czeka na decyzję właściciela");
});

test("CLOSED_TICKET_STATUSES is exactly DONE/REJECTED/DUPLICATE", () => {
  assert.deepEqual([...CLOSED_TICKET_STATUSES].sort(), ["DONE", "DUPLICATE", "REJECTED"]);
  assert.equal(CLOSED_TICKET_STATUSES.length, 3);
});

test("CLOSED_TICKET_STATUSES excludes the non-terminal statuses", () => {
  for (const nonTerminal of ["NEEDS_INFO", "REWORK", "NEEDS_OWNER", "NEW", "TRIAGE", "ACCEPTED", "IN_PROGRESS", "FIX_PROPOSED"]) {
    assert.equal(CLOSED_TICKET_STATUSES.includes(nonTerminal), false, `${nonTerminal} must not be terminal`);
  }
});

test("TicketStatusSchema accepts all 11 statuses and rejects an unknown one", () => {
  for (const status of ALL_11_STATUSES) {
    assert.equal(TicketStatusSchema.safeParse(status).success, true, `${status} should parse`);
  }
  assert.equal(TicketStatusSchema.safeParse("BOGUS_STATUS").success, false);
});

test("CORE_TICKET_EVENT_TYPES is exactly the 8-value core, no system-specific extras", () => {
  assert.deepEqual(
    [...CORE_TICKET_EVENT_TYPES].sort(),
    ["ANSWER", "COMMENT", "CREATED", "DUPLICATE_MARKED", "ERROR_GROUP_LINKED", "PRIORITY_CHANGED", "QUESTION", "STATUS_CHANGED"].sort(),
  );
  for (const systemSpecific of ["GITHUB_LINKED", "AGENT_TASK_CREATED", "AGENT_STATUS_CHANGED"]) {
    assert.equal(CORE_TICKET_EVENT_TYPES.includes(systemSpecific), false, `${systemSpecific} must stay with the owning system, not in the core`);
  }
});
