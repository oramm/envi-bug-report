const test = require("node:test");
const assert = require("node:assert/strict");
const {
  occurrenceLabel,
  parseQuestionPayload,
  latestQuestionPayload,
  answerOptionIndex,
  redundantStatusBodyEventIds,
  eventSide,
  groupAttachmentsByEvent,
} = require("../dist/text.js");

// --- occurrenceLabel: Polish numeral declension (1 / 2-4 / 5+) ---------------------------------

test("occurrenceLabel: 1 -> singular 'wystąpienie'", () => {
  assert.equal(occurrenceLabel(1), "1 wystąpienie");
});

test("occurrenceLabel: 2..4 -> 'wystąpienia'", () => {
  assert.equal(occurrenceLabel(2), "2 wystąpienia");
  assert.equal(occurrenceLabel(3), "3 wystąpienia");
  assert.equal(occurrenceLabel(4), "4 wystąpienia");
});

test("occurrenceLabel: 0, 5..11 -> 'wystąpień'", () => {
  assert.equal(occurrenceLabel(5), "5 wystąpień");
  assert.equal(occurrenceLabel(0), "0 wystąpień");
});

// The source rule only special-cases n===1 exactly for the singular form; it does not special-case
// numbers ending in 1 the way strict Polish grammar would (21, 31, ...). Ported verbatim, not
// "fixed" — this test documents the behaviour as it exists in the reference implementation today.
test("occurrenceLabel: 21 -> 'wystąpień', not the ends-in-1 singular a linguist might expect (verbatim source behaviour)", () => {
  assert.equal(occurrenceLabel(21), "21 wystąpień");
});

test("occurrenceLabel: teens (11-19) are always 'wystąpień', not 'wystąpienia', despite mod10 2-4", () => {
  assert.equal(occurrenceLabel(12), "12 wystąpień");
  assert.equal(occurrenceLabel(13), "13 wystąpień");
  assert.equal(occurrenceLabel(14), "14 wystąpień");
});

test("occurrenceLabel: 22..24 -> 'wystąpienia' again (mod100 >= 20 re-enters the 2-4 rule)", () => {
  assert.equal(occurrenceLabel(22), "22 wystąpienia");
  assert.equal(occurrenceLabel(24), "24 wystąpienia");
  assert.equal(occurrenceLabel(25), "25 wystąpień");
});

// --- ticketQa helpers ---------------------------------------------------------------------------

test("parseQuestionPayload returns null for an absent or empty payload", () => {
  assert.equal(parseQuestionPayload(null), null);
  assert.equal(parseQuestionPayload(undefined), null);
  assert.equal(parseQuestionPayload({}), null);
});

test("parseQuestionPayload returns the parsed payload when it has options or a recommendation", () => {
  const payload = parseQuestionPayload({ options: ["a", "b"], recommendation: "pick a" });
  assert.deepEqual(payload, { options: ["a", "b"], recommendation: "pick a" });
});

test("latestQuestionPayload finds the newest QUESTION event's payload", () => {
  const events = [
    { id: 1, eventType: "QUESTION", payloadJson: { recommendation: "old" }, ticketId: 1, body: null, oldStatus: null, newStatus: null, createdBy: null, createdAt: "" },
    { id: 2, eventType: "COMMENT", payloadJson: null, ticketId: 1, body: "hi", oldStatus: null, newStatus: null, createdBy: null, createdAt: "" },
    { id: 3, eventType: "QUESTION", payloadJson: { recommendation: "new" }, ticketId: 1, body: null, oldStatus: null, newStatus: null, createdBy: null, createdAt: "" },
  ];
  assert.deepEqual(latestQuestionPayload(events), { recommendation: "new" });
});

test("answerOptionIndex finds the matching trimmed option, or -1 when none matches", () => {
  assert.equal(answerOptionIndex(["Tak", "Nie"], " Tak "), 0);
  assert.equal(answerOptionIndex(["Tak", "Nie"], "Nie"), 1);
  assert.equal(answerOptionIndex(["Tak", "Nie"], "Może"), -1);
  assert.equal(answerOptionIndex(undefined, "Tak"), -1);
});

test("redundantStatusBodyEventIds flags a STATUS_CHANGED event whose body repeats the previous event's body", () => {
  const events = [
    { id: 1, eventType: "COMMENT", body: "Naprawiono w wersji 5.1", ticketId: 1, oldStatus: null, newStatus: null, payloadJson: null, createdBy: 1, createdAt: "" },
    { id: 2, eventType: "STATUS_CHANGED", body: "Naprawiono w wersji 5.1", ticketId: 1, oldStatus: "IN_PROGRESS", newStatus: "FIX_PROPOSED", payloadJson: null, createdBy: 1, createdAt: "" },
    { id: 3, eventType: "STATUS_CHANGED", body: "Inna notatka", ticketId: 1, oldStatus: "FIX_PROPOSED", newStatus: "DONE", payloadJson: null, createdBy: 2, createdAt: "" },
  ];
  const ids = redundantStatusBodyEventIds(events);
  assert.equal(ids.has(2), true);
  assert.equal(ids.has(3), false);
});

test("eventSide: QUESTION is always agent, ANSWER is always reporter", () => {
  const ticket = { userId: 7 };
  const question = { id: 1, eventType: "QUESTION", createdBy: 7, ticketId: 1, body: null, oldStatus: null, newStatus: null, payloadJson: null, createdAt: "" };
  const answer = { id: 2, eventType: "ANSWER", createdBy: null, ticketId: 1, body: null, oldStatus: null, newStatus: null, payloadJson: null, createdAt: "" };
  assert.equal(eventSide(question, ticket), "agent");
  assert.equal(eventSide(answer, ticket), "reporter");
});

test("eventSide: COMMENT follows the author (reporter vs agent), null author is agent-side", () => {
  const ticket = { userId: 7 };
  const byReporter = { id: 1, eventType: "COMMENT", createdBy: 7, ticketId: 1, body: "hi", oldStatus: null, newStatus: null, payloadJson: null, createdAt: "" };
  const byAgent = { id: 2, eventType: "COMMENT", createdBy: 99, ticketId: 1, body: "hi", oldStatus: null, newStatus: null, payloadJson: null, createdAt: "" };
  const bySystem = { id: 3, eventType: "COMMENT", createdBy: null, ticketId: 1, body: "hi", oldStatus: null, newStatus: null, payloadJson: null, createdAt: "" };
  assert.equal(eventSide(byReporter, ticket), "reporter");
  assert.equal(eventSide(byAgent, ticket), "agent");
  assert.equal(eventSide(bySystem, ticket), "agent");
});

test("eventSide: a bare STATUS_CHANGED with no visible body is a centered system chip", () => {
  const ticket = { userId: 7 };
  const bare = { id: 1, eventType: "STATUS_CHANGED", createdBy: 7, ticketId: 1, body: null, oldStatus: "TRIAGE", newStatus: "ACCEPTED", payloadJson: null, createdAt: "" };
  assert.equal(eventSide(bare, ticket, false), "system");
  assert.equal(eventSide(bare, ticket, true), "reporter");
});

test("groupAttachmentsByEvent splits ticket-level (null ticketEventId) from per-event attachments", () => {
  const attachments = [
    { id: 1, ticketId: 1, ticketEventId: null, description: "d".repeat(10), fileName: "a.png", mimeType: "image/png", byteSize: 10, createdAt: "" },
    { id: 2, ticketId: 1, ticketEventId: 5, description: "d".repeat(10), fileName: "b.png", mimeType: "image/png", byteSize: 10, createdAt: "" },
    { id: 3, ticketId: 1, ticketEventId: 5, description: "d".repeat(10), fileName: "c.png", mimeType: "image/png", byteSize: 10, createdAt: "" },
  ];
  const grouped = groupAttachmentsByEvent(attachments);
  assert.equal(grouped.ticketLevel.length, 1);
  assert.equal(grouped.ticketLevel[0].id, 1);
  assert.equal(grouped.byEventId.get(5).length, 2);
});
