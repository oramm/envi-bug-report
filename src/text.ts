import {
    QuestionPayloadSchema,
    type CoreTicketEventType,
    type QuestionPayload,
    type SupportTicketAttachmentMetadata,
    type SupportTicketEvent,
    type TicketPriority,
    type TicketSource,
    type TicketType,
} from './contracts';

// Ported verbatim from the reference implementation's label module (labels/icons) and the whole
// of its Q&A/timeline helper module. A status badge component and its colour map (Tailwind
// classes/JSX) stay with the source system — colour choices are the system's, not the loop's.
// `TICKET_TYPE_LABEL` and `TICKET_SOURCE_LABEL` cover the full enum, including two values that only
// make sense for the origin system, for the same reason `TicketTypeSchema`/`TicketSourceSchema`
// are exported whole from `./contracts` — see the note there. `EVENT_LABEL`/`EVENT_ICON` are
// restricted to the core 8 event types; the three entries specific to the source system's own
// integrations stay in that system's own map.

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
    BUG: 'Błąd',
    FEATURE: 'Nowa funkcja',
    OFFER_REQUEST: 'Zapytanie ofertowe',
    SUPPORT: 'Wsparcie',
    TEST_FEEDBACK: 'Uwagi testowe',
    RUNTIME_ERROR: 'Błąd aplikacji',
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
    LOW: 'Niski',
    NORMAL: 'Normalny',
    HIGH: 'Wysoki',
    CRITICAL: 'Krytyczny',
};

export const TICKET_SOURCE_LABEL: Record<TicketSource, string> = {
    TESTER_FORM: 'Zgłoszenie ręczne',
    RUNTIME_ERROR: 'Wykryte automatycznie',
    ADMIN_CREATED: 'Utworzone przez administratora',
    GITHUB_SYNC: 'GitHub',
};

export const EVENT_ICON: Record<CoreTicketEventType, string> = {
    CREATED: '📝',
    COMMENT: '💬',
    STATUS_CHANGED: '🔄',
    PRIORITY_CHANGED: '🔺',
    ERROR_GROUP_LINKED: '🔗',
    DUPLICATE_MARKED: '📑',
    QUESTION: '❓',
    ANSWER: '✅',
};

export const EVENT_LABEL: Record<CoreTicketEventType, string> = {
    CREATED: 'Utworzono',
    COMMENT: 'Komentarz',
    STATUS_CHANGED: 'Zmiana statusu',
    PRIORITY_CHANGED: 'Zmiana priorytetu',
    ERROR_GROUP_LINKED: 'Powiązano z błędem',
    DUPLICATE_MARKED: 'Oznaczono jako duplikat',
    QUESTION: 'Pytanie do testera',
    ANSWER: 'Odpowiedź testera',
};

// Polish plural for "wystąpienie" — how heavy a runtime error is, shown on the error-group chips
// and in the ticket's technical details.
export function occurrenceLabel(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return '1 wystąpienie';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} wystąpienia`;
    return `${n} wystąpień`;
}

// --- apps/web/src/lib/ticketQa.ts (whole file) --------------------------------------------------
// Kept JSX-free so both a tester screen and an admin screen can share one implementation and
// `node --test` can exercise it without a React test runner.

/**
 * `payloadJson` is an untyped `Record<string, unknown>` on the wire, so never cast it — parse.
 * Returns null when the payload is absent or does not match the contract (extras are then simply
 * not rendered; the question body itself always shows).
 */
export function parseQuestionPayload(payloadJson: Record<string, unknown> | null | undefined): QuestionPayload | null {
    if (!payloadJson) return null;
    const parsed = QuestionPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) return null;
    if (!parsed.data.options?.length && !parsed.data.recommendation) return null;
    return parsed.data;
}

/** Payload of the newest QUESTION event — drives the answer panel's option picker. */
export function latestQuestionPayload(events: readonly SupportTicketEvent[]): QuestionPayload | null {
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.eventType === 'QUESTION') return parseQuestionPayload(event.payloadJson);
    }
    return null;
}

/**
 * Which offered option the answer text currently echoes (-1 = none). The API knows nothing about
 * option indices — picking an option only fills the answer text, and the tester may edit it, at
 * which point the radio simply stops being selected.
 */
export function answerOptionIndex(options: readonly string[] | undefined, body: string): number {
    if (!options?.length) return -1;
    const normalized = body.trim();
    if (normalized.length === 0) return -1;
    return options.findIndex((option) => option.trim() === normalized);
}

/**
 * `question`, `answer`, `confirmFix` and `rejectFix` pass the same text twice: once as the
 * QUESTION/ANSWER event body and once as the status-change note, which feeds the status mail and
 * therefore has to stay on the API side. In the timeline that renders the identical paragraph
 * twice, so hide the STATUS_CHANGED copy here.
 *
 * Returns the ids of STATUS_CHANGED events whose body equals (after trim) the body of the
 * immediately preceding event. Only the duplicated paragraph is redundant — the entry itself,
 * with its label and timestamp, still belongs in the history.
 */
export function redundantStatusBodyEventIds(events: readonly SupportTicketEvent[]): ReadonlySet<number> {
    const ids = new Set<number>();
    for (let i = 1; i < events.length; i += 1) {
        const event = events[i];
        if (event.eventType !== 'STATUS_CHANGED') continue;
        const body = event.body?.trim();
        if (!body) continue;
        if (body === events[i - 1].body?.trim()) ids.add(event.id);
    }
    return ids;
}

export interface GroupedAttachments {
    /** `ticketEventId === null` — the ticket-level gallery. */
    ticketLevel: SupportTicketAttachmentMetadata[];
    byEventId: Map<number, SupportTicketAttachmentMetadata[]>;
}

export type EventSide = 'agent' | 'reporter' | 'system';

/** The minimal ticket shape `eventSide` needs — the full `SupportTicket` stays in the consumer. */
export interface EventSideTicket {
    userId: number | null;
}

/**
 * Which chat side an event belongs to: the agent (support/admin) speaks on the left, the reporter
 * on the right, and lifecycle events render as a centered system chip. Decided by BOTH the event
 * type and the author (`event.createdBy` vs `ticket.userId`):
 * - QUESTION is always the agent's; ANSWER is always the reporter's.
 * - COMMENT follows its author: the reporter (createdBy === ticket.userId) speaks on the right,
 *   anyone else — an admin/agent, or a null system author — on the left. The explicit null guard
 *   keeps a system-authored comment on an owner-less ticket (userId null, e.g. a RUNTIME_ERROR
 *   report) on the agent side rather than mislabelling it as the reporter's.
 * - STATUS_CHANGED, CREATED and every *_LINKED event are lifecycle. A bare transition (no text of
 *   its own) stays a centered system chip; one that CARRIES a body is somebody talking — the
 *   agent's note, the tester's rejection reason — so it joins the chat on its author's side.
 *   Without this, every written note the agent attaches to a status change lands in the centered
 *   lane and reads as system noise instead of a message.
 *
 * `hasVisibleBody` is the caller's decision, not `Boolean(event.body)`: a body hidden as a
 * duplicate (see `redundantStatusBodyEventIds`) must not turn the entry into an empty bubble.
 */
export function eventSide(event: SupportTicketEvent, ticket: EventSideTicket, hasVisibleBody = false): EventSide {
    switch (event.eventType) {
        case 'QUESTION':
            return 'agent';
        case 'ANSWER':
            return 'reporter';
        case 'COMMENT':
            return authorSide(event, ticket);
        default:
            return hasVisibleBody ? authorSide(event, ticket) : 'system';
    }
}

/** Reporter on the right, anyone else (admin/agent, or a null system author) on the left. */
function authorSide(event: SupportTicketEvent, ticket: EventSideTicket): EventSide {
    return event.createdBy !== null && event.createdBy === ticket.userId ? 'reporter' : 'agent';
}

/** Splits attachments into the ticket-level gallery and per-timeline-event buckets. */
export function groupAttachmentsByEvent(attachments: readonly SupportTicketAttachmentMetadata[]): GroupedAttachments {
    const ticketLevel: SupportTicketAttachmentMetadata[] = [];
    const byEventId = new Map<number, SupportTicketAttachmentMetadata[]>();
    for (const attachment of attachments) {
        const eventId = attachment.ticketEventId ?? null;
        if (eventId === null) {
            ticketLevel.push(attachment);
            continue;
        }
        const bucket = byEventId.get(eventId);
        if (bucket) bucket.push(attachment);
        else byEventId.set(eventId, [attachment]);
    }
    return { ticketLevel, byEventId };
}
