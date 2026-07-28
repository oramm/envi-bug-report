const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  fingerprint,
  stackSignature,
  safeLocation,
  sanitizeReport,
  shouldAutoTicket,
  priorityForSeverity,
} = require("../dist/fingerprint.js");

// --- fingerprint: stability + sensitivity to each of the four inputs ----------------------------

test("fingerprint is stable for the same input", () => {
  const report = { message: "Boom", stackSignature: "a.ts:1 | b.ts:2", route: "/x", appVersion: "5.0" };
  assert.equal(fingerprint(report), fingerprint({ ...report }));
});

test("fingerprint matches the documented sha256([message, stackSignature, route, appVersion].join('\\n'))", () => {
  const report = { message: "Boom", stackSignature: "sig", route: "/x", appVersion: "5.0" };
  const expected = crypto.createHash("sha256").update(["Boom", "sig", "/x", "5.0"].join("\n")).digest("hex");
  assert.equal(fingerprint(report), expected);
});

test("fingerprint changes when message changes", () => {
  const base = { message: "Boom", stackSignature: "s", route: "/x", appVersion: "1.0" };
  assert.notEqual(fingerprint(base), fingerprint({ ...base, message: "Other" }));
});

test("fingerprint changes when stackSignature changes", () => {
  const base = { message: "Boom", stackSignature: "s", route: "/x", appVersion: "1.0" };
  assert.notEqual(fingerprint(base), fingerprint({ ...base, stackSignature: "different" }));
});

test("fingerprint changes when route changes", () => {
  const base = { message: "Boom", stackSignature: "s", route: "/x", appVersion: "1.0" };
  assert.notEqual(fingerprint(base), fingerprint({ ...base, route: "/y" }));
});

test("fingerprint changes when appVersion changes (P-2 relevance: stale cached bundle pollutes groups)", () => {
  const base = { message: "Boom", stackSignature: "s", route: "/x", appVersion: "1.0" };
  assert.notEqual(fingerprint(base), fingerprint({ ...base, appVersion: "2.0" }));
});

test("fingerprint treats null/undefined stackSignature, route, appVersion as empty string", () => {
  const withNulls = fingerprint({ message: "Boom", stackSignature: null, route: null, appVersion: null });
  const withEmpty = fingerprint({ message: "Boom", stackSignature: "", route: "", appVersion: "" });
  assert.equal(withNulls, withEmpty);
});

// --- stackSignature --------------------------------------------------------------------------

test("stackSignature returns null for null/undefined input", () => {
  assert.equal(stackSignature(null), null);
  assert.equal(stackSignature(undefined), null);
});

test("stackSignature keeps only the first 3 non-empty trimmed lines joined by ' | '", () => {
  const stack = "Error: boom\n  at a (x.ts:1:1)\n\n  at b (y.ts:2:2)\n  at c (z.ts:3:3)\n  at d (w.ts:4:4)";
  assert.equal(stackSignature(stack), "Error: boom | at a (x.ts:1:1) | at b (y.ts:2:2)");
});

// --- safeLocation ------------------------------------------------------------------------------

test("safeLocation redacts credential-shaped query params and truncates to 1000 chars", () => {
  const result = safeLocation("/x?token=SECRETVALUE&ok=1");
  assert.match(result, /token=\[redacted\]/);
  assert.match(result, /ok=1/);
  const long = safeLocation("/" + "a".repeat(2000));
  assert.equal(long.length, 1000);
});

// --- sanitizeReport: cuts forbidden keys / truncates -------------------------------------------

test("sanitizeReport redacts password/secret/token/cookie/authorization assignments in message and stack", () => {
  const report = {
    message: "login failed password=hunter2",
    stack: "token=abc123secret\nat x",
    stackSignature: "cookie=abc",
    route: "/a?authorization=Bearer xyz",
    url: "/b?secret=zzz",
    previousRoute: null,
    appVersion: "1.0",
    browser: null,
    os: null,
    requestId: null,
    timestamp: null,
    severity: "ERROR",
    breadcrumbs: [],
    lastFailedRequest: null,
    userNote: null,
  };
  const sanitized = sanitizeReport(report);
  assert.match(sanitized.message, /password=\[redacted\]/);
  assert.doesNotMatch(sanitized.message, /hunter2/);
  assert.match(sanitized.stack, /token=\[redacted\]/);
  assert.match(sanitized.stackSignature, /cookie=\[redacted\]/);
  assert.match(sanitized.route, /authorization=\[redacted\]/);
  assert.match(sanitized.url, /secret=\[redacted\]/);
});

test("sanitizeReport truncates message to 1000 chars and stack to 8000 chars", () => {
  const report = {
    message: "m".repeat(2000),
    stack: "s".repeat(9000),
    stackSignature: null,
    route: null,
    url: null,
    previousRoute: null,
    appVersion: null,
    browser: null,
    os: null,
    requestId: null,
    timestamp: null,
    severity: "ERROR",
    breadcrumbs: [],
    lastFailedRequest: null,
    userNote: null,
  };
  const sanitized = sanitizeReport(report);
  assert.equal(sanitized.message.length, 1000);
  assert.equal(sanitized.stack.length, 8000);
});

test("sanitizeReport also redacts the nested lastFailedRequest.endpoint", () => {
  const report = {
    message: "m",
    stack: null,
    stackSignature: null,
    route: null,
    url: null,
    previousRoute: null,
    appVersion: null,
    browser: null,
    os: null,
    requestId: null,
    timestamp: null,
    severity: "ERROR",
    breadcrumbs: [],
    lastFailedRequest: { endpoint: "/api/x?token=SECRET", status: 500, requestId: null },
    userNote: null,
  };
  const sanitized = sanitizeReport(report);
  assert.match(sanitized.lastFailedRequest.endpoint, /token=\[redacted\]/);
});

// --- priorityForSeverity / shouldAutoTicket thresholds -----------------------------------------

test("priorityForSeverity: CRITICAL -> CRITICAL, ERROR -> HIGH, WARNING/INFO -> NORMAL", () => {
  assert.equal(priorityForSeverity("CRITICAL"), "CRITICAL");
  assert.equal(priorityForSeverity("ERROR"), "HIGH");
  assert.equal(priorityForSeverity("WARNING"), "NORMAL");
  assert.equal(priorityForSeverity("INFO"), "NORMAL");
});

test("shouldAutoTicket: CRITICAL always auto-tickets regardless of occurrence count", () => {
  assert.equal(shouldAutoTicket("CRITICAL", 1), true);
  assert.equal(shouldAutoTicket("CRITICAL", 0), true);
});

test("shouldAutoTicket: non-CRITICAL auto-tickets only from the 2nd occurrence", () => {
  assert.equal(shouldAutoTicket("ERROR", 1), false);
  assert.equal(shouldAutoTicket("ERROR", 2), true);
  assert.equal(shouldAutoTicket("WARNING", 2), true);
  assert.equal(shouldAutoTicket("INFO", 1), false);
});
