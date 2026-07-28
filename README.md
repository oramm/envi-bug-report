# @envi/bug-report

Shared bug-report / verification-loop primitives for ENVI apps. One library, four entry points:

```text
@envi/bug-report             -> ticket status/priority/type enums, STATUS_LABEL,
                                 CLOSED_TICKET_STATUSES, zod schemas for the loop's data shapes
                                 (zero dependencies beyond zod)
@envi/bug-report/transitions -> ALLOWED_TRANSITIONS, assertTransition(from, to, actor)
@envi/bug-report/fingerprint -> fingerprint, stackSignature, safeLocation, sanitizeReport,
                                 shouldAutoTicket, priorityForSeverity
@envi/bug-report/text        -> occurrenceLabel + the rest of the tester Q&A / timeline helpers
```

## The loop this library encodes

**Agent naprawia, tester zamyka** — an agent (or admin acting as one) fixes a ticket and moves it
to "Do testów" (`FIX_PROPOSED`), but only the **reporter** can close it (`DONE`). When the agent
doesn't understand a ticket it asks a question (`NEEDS_INFO`); the reporter's answer returns it to
triage. A rejected fix goes to "Do poprawy" (`REWORK`) with a mandatory comment. Full model, status
table and event model: see the canon this library implements —
`40_wiki/firma/technologie/modul-zgloszen-wzorzec.md` in the ENVI Second Brain vault.

## Install

```bash
npm i github:oramm/envi-bug-report#v0.1.0
```

`npm install` runs this package's `prepare` script (`tsc`), so `dist/` is built at install time —
the repo does not commit compiled output.

---

## `@envi/bug-report` (contracts)

11 canonical ticket statuses (`TicketStatusSchema`), `STATUS_LABEL` (Polish, single source of
truth — UI must never compose a status name itself), `CLOSED_TICKET_STATUSES` (exactly `DONE`,
`REJECTED`, `DUPLICATE`), plus the zod schemas for tickets' events, attachments, runtime-error
groups/events, and the manual (tester-filed) intake form.

`CORE_TICKET_EVENT_TYPES` is the rigid **core 8** event types (`CREATED`, `COMMENT`,
`STATUS_CHANGED`, `PRIORITY_CHANGED`, `ERROR_GROUP_LINKED`, `DUPLICATE_MARKED`, `QUESTION`,
`ANSWER`). A system with its own extra event types (e.g. an issue-tracker sync) composes its own
enum: `z.enum([...CORE_TICKET_EVENT_TYPES, 'MY_SYSTEM_EVENT', ...])` and extends
`SupportTicketEventSchema` accordingly — do not add system-specific event types here.

`TicketTypeSchema` and `TicketSourceSchema` are exported whole, including two values that only make
sense for one origin system (`OFFER_REQUEST`, `GITHUB_SYNC`). Unlike the status and event-type
enums, these were **not** split into a core/extension pair for `v0.1.0` — flagged as an open
question for a later version, not a decision made here.

## `@envi/bug-report/transitions`

```ts
export type TransitionActor = 'reporter' | 'agent' | 'system';
export function assertTransition(from: TicketStatus, to: TicketStatus, actor: TransitionActor): void;
```

`actor` is the **semantic role in the loop**, not a system/auth role. Your app has no obligation to
have an "agent" user role — map your own auth onto these three values before calling
`assertTransition`:

- `'reporter'` — the person who filed the ticket, or an admin acting explicitly on their behalf.
- `'agent'` — the automated fix loop (or an admin driving it), **never allowed to close its own
  fix**.
- `'system'` — an automated process that is neither of the above.

`ALLOWED_TRANSITIONS` is a plain data table (not an `if` chain) covering the five **guarded**
operations of the loop: question, answer, confirm-fix, reject-fix, reopen. Plain admin progression
(`NEW -> TRIAGE -> ACCEPTED -> IN_PROGRESS`, `REWORK -> IN_PROGRESS`, any status `-> DUPLICATE` or
`-> REJECTED`, `NEEDS_OWNER` handling) is deliberately **not** in this table — those transitions
have no actor restriction in the reference implementation, and baking them in as an allow-all would
defeat the one rule this library exists to enforce. Route those through your own admin-override
path, not through `assertTransition`.

An unlisted `from -> to` pair, or a listed pair called with the wrong `actor`, throws with a Polish
message naming both statuses.

## `@envi/bug-report/fingerprint`

Runtime-error grouping and sanitisation, used by a POST `/api/error-events`-style endpoint (both
server- and client-side error capture):

- `fingerprint({ message, stackSignature, route, appVersion })` — `sha256` over the four fields
  joined by `\n`. **`appVersion` is part of the fingerprint on purpose** — if your `index.html` is
  cached without a `Cache-Control` header, a stale client bundle will keep reporting under a
  version your server no longer runs, splitting one real error into two never-converging groups.
  Serve `index.html` with `Cache-Control: no-cache` (or equivalent) in front of any deployment that
  uses this fingerprint.
- `stackSignature(stack)` — first 3 non-empty trimmed stack-trace lines, capped at 500 chars.
- `safeLocation(url)` — redacts credential-shaped query params (`password`, `secret`, `token`,
  `cookie`, `authorization`, `session`), caps at 1000 chars. Accepts `string | null | undefined`
  because it already has two real call sites with different nullability (a server-side endpoint
  and a browser error-capture module) — pick whichever your caller has.
- `sanitizeReport(report)` — applies the above plus message/stack redaction and truncation to an
  entire error report.
- `shouldAutoTicket(severity, occurrenceCount)` — `CRITICAL` always auto-tickets; anything else
  needs a 2nd occurrence.
- `priorityForSeverity(severity)` — `CRITICAL -> CRITICAL`, `ERROR -> HIGH`, else `NORMAL`.

## `@envi/bug-report/text`

Polish UI copy and pure timeline/Q&A helpers, JSX-free so a Node test runner can exercise them
without a browser or a component test harness:

- `occurrenceLabel(n)` — Polish plural of "wystąpienie" (1 / 2–4 / 5+). Ported verbatim from the
  reference implementation: it special-cases exactly `n === 1`, not "numbers ending in 1" the way
  strict Polish grammar would (so `21` reads "21 wystąpień", not the grammatically fussier
  alternative) — this is existing behaviour, not something this library corrects.
- `TICKET_TYPE_LABEL`, `TICKET_PRIORITY_LABEL`, `TICKET_SOURCE_LABEL`, `EVENT_LABEL`, `EVENT_ICON` —
  single source of Polish labels/icons. `EVENT_LABEL`/`EVENT_ICON` cover only
  `CORE_TICKET_EVENT_TYPES`; extend them for any system-specific event types.
- `parseQuestionPayload`, `latestQuestionPayload`, `answerOptionIndex`, `redundantStatusBodyEventIds`,
  `eventSide`, `groupAttachmentsByEvent` — the tester Q&A / timeline logic. Colour/JSX badges
  (`StatusBadge` and similar) are **not** included — those are a system's own visual decision, not
  part of the loop.

---

## What stays a recipe, not a dependency

The pieces below are **not** in this package on purpose — they bind to one system's database
schema, transport, auth, or UI kit. Copy the pattern into your system instead:

1. **Database migration.** Add the 11 status values / core 8 event-type values to your enums. On
   PostgreSQL 12+, `ALTER TYPE ... ADD VALUE` is allowed **inside a transaction** (an ordinary
   migration) as long as the new value is not **used** in that same transaction — a separate
   transaction is only needed if the same migration both adds and immediately uses/compares the
   new value, or on PG < 12.
2. Add `payload_json jsonb NULL` on the ticket-events table and a nullable `ticket_event_id` FK on
   the attachments table (`NULL` = ticket-level attachment).
3. Wire up your repository layer against your own schema (table/column names, ORM).
4. Add four API operations — question (agent), answer (reporter), confirm-fix (reporter),
   reject-fix (reporter, mandatory comment) — each checking its source status and calling
   `assertTransition` from this package before writing the new status through **one** function that
   every status change goes through (that's the hook a future mailer/notifier attaches to; writing
   a status directly to SQL bypasses it and reporters silently stop hearing about their tickets).
5. Wire up your own UI: timeline, tester panel at "Do testów", question form, attachments, status
   badges — using `STATUS_LABEL`/`TICKET_*_LABEL`/`EVENT_LABEL` from this package as the only
   source of the Polish wording, never composed locally.
6. Smoke-test the full loop once wired: question → answer → fix → reject → re-fix → confirm.

## Version

`0.1.0` — first cut, intentionally narrow. The library grows behind its second real consumer, not
ahead of it; see the parent workspace's planning pack for what's still deliberately out of scope
(the browser/Express capture wiring, an issue-tracker sync, agent-task orchestration).
