import { STATUS_LABEL, type TicketStatus } from './contracts';

// New code, not a port. The reference system does not enforce a `FIX_PROPOSED -> DONE` guard
// today — its admin status-override path is a full override, and its own test suite locks that in
// on purpose. This module gives a first, real implementation of the discipline the doctrine behind
// it already states in prose ("the agent fixes, the reporter closes"). It is intentionally left
// unwired from the reference system's own override path for now — wiring it in would break that
// system's frozen test; a second, newer consumer is the first real caller.

/**
 * `actor` is the SEMANTIC role in the verification loop, not a system/auth role. The reference
 * system has no distinct "agent" role — its triage agent authenticates as a plain admin, same as a
 * human admin acting on the reporter's behalf — so the library cannot infer this from a session.
 * The caller maps its own auth onto one of these three values before calling `assertTransition`:
 * - `'reporter'` — the person who filed the ticket, or an admin acting explicitly on their behalf.
 * - `'agent'`    — the automated triage/fix loop (or an admin acting as the agent, e.g. running the
 *   fix pipeline), never allowed to close its own fix.
 * - `'system'`   — an automated process that is neither the reporter nor the agent (e.g. the
 *   runtime-error intake creating a ticket).
 */
export type TransitionActor = 'reporter' | 'agent' | 'system';

interface TransitionRule {
    from: TicketStatus;
    to: TicketStatus;
    actors: readonly TransitionActor[];
}

// Derived from the reference system's actually-guarded transition rules — specifically the FIVE
// rows that already have a guard in its own ticket-loop procedures (question / answer /
// confirm-fix / reject-fix / reopen). Its other two admin-only operations (mark-duplicate, a
// generic status override) have NO status guard in the source system today ("any -> any") and are
// deliberately left OUT of this table: baking them in as an allow-all would defeat the one rule
// this library exists to enforce. Consuming systems keep their own unguarded admin override path
// for plain progression
// (NEW -> TRIAGE -> ACCEPTED -> IN_PROGRESS, REWORK -> IN_PROGRESS, any -> DUPLICATE/REJECTED,
// NEEDS_OWNER handling) outside `assertTransition`.
export const ALLOWED_TRANSITIONS: readonly TransitionRule[] = [
    // ticket.question — agent/admin asks, ticket goes to NEEDS_INFO.
    { from: 'TRIAGE', to: 'NEEDS_INFO', actors: ['agent'] },
    { from: 'ACCEPTED', to: 'NEEDS_INFO', actors: ['agent'] },
    { from: 'IN_PROGRESS', to: 'NEEDS_INFO', actors: ['agent'] },
    // ticket.answer — reporter (or admin on their behalf) answers, back to TRIAGE.
    { from: 'NEEDS_INFO', to: 'TRIAGE', actors: ['reporter'] },
    // ticket.confirmFix — the one rule worth building a library for: only the reporter closes.
    { from: 'FIX_PROPOSED', to: 'DONE', actors: ['reporter'] },
    // ticket.rejectFix — only the reporter sends a proposed fix back for rework.
    { from: 'FIX_PROPOSED', to: 'REWORK', actors: ['reporter'] },
    // ticket.reopen — only the reporter reopens a closed ticket.
    { from: 'DONE', to: 'TRIAGE', actors: ['reporter'] },
];

/**
 * Throws with a Polish message when `from -> to` is not allowed for `actor`. A transition that
 * simply is not in `ALLOWED_TRANSITIONS` at all (e.g. plain admin progression like
 * `NEW -> TRIAGE`) is equally rejected — this function only knows the guarded subset of the loop;
 * callers that need the unguarded progression steps do not route them through this guard.
 */
export function assertTransition(from: TicketStatus, to: TicketStatus, actor: TransitionActor): void {
    const allowed = ALLOWED_TRANSITIONS.some((rule) => rule.from === from && rule.to === to && rule.actors.includes(actor));
    if (!allowed) {
        throw new Error(
            `Niedozwolone przejście statusu: z „${STATUS_LABEL[from]}” do „${STATUS_LABEL[to]}” dla roli „${actor}”.`,
        );
    }
}
