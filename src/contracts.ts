import { z } from 'zod';

// Ported from the reference implementation's ticket-contracts module. Behaviour is copied
// verbatim — this is not the place to improve the logic. Anything that stays with the reference
// system (a `Role` schema, agent-task orchestration, a ticket-patch schema, and the full
// ticket/ticket-create shapes with system-specific fields) is intentionally absent; consuming
// systems extend the core exported here with their own fields.

// --- Byte-size limits --------------------------------------------------------------------------

export const SUPPORT_ERROR_PAYLOAD_MAX_BYTES = 16 * 1024;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const SUPPORT_CONSOLE_LOG_MAX_BYTES = 20 * 1024;

// --- Ticket status: rigid 11-value enum (D-3, binding) -----------------------------------------

export const TicketStatusSchema = z.enum([
    'NEW',
    'TRIAGE',
    'ACCEPTED',
    'IN_PROGRESS',
    'FIX_PROPOSED',
    'DONE',
    'REJECTED',
    'DUPLICATE',
    'NEEDS_INFO',
    'REWORK',
    // Frozen-scope guard: the fix would change a computed number, a decision rule, or contradict a
    // recorded decision, so it waits on the system owner's call. Deliberately its own status rather
    // than NEEDS_INFO — that one means "waiting on the reporter" and opens their answer panel.
    'NEEDS_OWNER',
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

// Terminal statuses. NEEDS_INFO, REWORK and NEEDS_OWNER are non-terminal — deliberately excluded.
export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = ['DONE', 'REJECTED', 'DUPLICATE'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
    NEW: 'Nowe',
    TRIAGE: 'W analizie',
    ACCEPTED: 'Przyjęte',
    IN_PROGRESS: 'W trakcie',
    FIX_PROPOSED: 'Do testów',
    DONE: 'Zrealizowane',
    REJECTED: 'Odrzucone',
    DUPLICATE: 'Duplikat',
    NEEDS_INFO: 'Czeka na wyjaśnienie',
    REWORK: 'Do poprawy',
    NEEDS_OWNER: 'Czeka na decyzję właściciela',
};

// --- Ticket priority / type / source / error-group / severity -------------------------------
// Priority, error-group status and severity have no system-specific values. TicketType and
// TicketSource each carry one value that only makes sense for one origin system (`OFFER_REQUEST`,
// `GITHUB_SYNC`); unlike the status and event-type enums below, these two were kept whole for
// `v0.1.0` rather than split into a core/extension pair — a decision explicitly flagged as open,
// not settled by omission.

export const TicketPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TicketTypeSchema = z.enum(['BUG', 'FEATURE', 'OFFER_REQUEST', 'SUPPORT', 'TEST_FEEDBACK', 'RUNTIME_ERROR']);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const TicketSourceSchema = z.enum(['TESTER_FORM', 'RUNTIME_ERROR', 'ADMIN_CREATED', 'GITHUB_SYNC']);
export type TicketSource = z.infer<typeof TicketSourceSchema>;

export const ErrorGroupStatusSchema = z.enum(['NEW', 'TRIAGE', 'LINKED', 'IGNORED', 'RESOLVED']);
export type ErrorGroupStatus = z.infer<typeof ErrorGroupStatusSchema>;

export const AppErrorSeveritySchema = z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
export type AppErrorSeverity = z.infer<typeof AppErrorSeveritySchema>;

// --- Ticket event types: rigid core of 8 -------------------------------------------------------
// Three values from the reference system's own integrations (an issue-tracker sync and an
// agent-task queue) stay with that system, which composes its own
// `z.enum([...CORE_TICKET_EVENT_TYPES, ...ITS_OWN_VALUES])`. Do not add system-specific event
// types here.

export const CORE_TICKET_EVENT_TYPES = [
    'CREATED',
    'COMMENT',
    'STATUS_CHANGED',
    'PRIORITY_CHANGED',
    'ERROR_GROUP_LINKED',
    'DUPLICATE_MARKED',
    'QUESTION',
    'ANSWER',
] as const;
export type CoreTicketEventType = (typeof CORE_TICKET_EVENT_TYPES)[number];
export const CoreTicketEventTypeSchema = z.enum(CORE_TICKET_EVENT_TYPES);

// --- Safe error payload (jsonb column on the error-events tables) ------------------------------

function jsonByteLength(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value ?? {})).length;
}

function hasForbiddenKey(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasForbiddenKey);

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const normalized = key.toLowerCase();
        if (
            normalized === 'body' ||
            normalized.includes('password') ||
            normalized.includes('secret') ||
            normalized.includes('token') ||
            normalized.includes('cookie') ||
            normalized === 'authorization'
        ) {
            return true;
        }
        if (hasForbiddenKey(nested)) return true;
    }
    return false;
}

export const SafeErrorPayloadSchema = z
    .record(z.unknown())
    .refine((value) => jsonByteLength(value) <= SUPPORT_ERROR_PAYLOAD_MAX_BYTES, {
        message: `payloadJson must be at most ${SUPPORT_ERROR_PAYLOAD_MAX_BYTES} bytes`,
    })
    .refine((value) => !hasForbiddenKey(value), {
        message: 'payloadJson must not contain request bodies, secrets, tokens, cookies or passwords',
    });
export type SafeErrorPayload = z.infer<typeof SafeErrorPayloadSchema>;

// --- Question / answer payload (QUESTION events only) ------------------------------------------

export const QuestionPayloadSchema = z.object({
    options: z.array(z.string().trim().min(1).max(200)).min(1).max(6).optional(),
    recommendation: z.string().trim().min(1).max(500).optional(),
});
export type QuestionPayload = z.infer<typeof QuestionPayloadSchema>;

// --- Ticket events ------------------------------------------------------------------------------

const nullableString = z.string().nullable();
const optionalNullableString = z.string().nullable().optional();
const optionalNullableInt = z.number().int().nullable().optional();

export const SupportTicketEventSchema = z.object({
    id: z.number().int(),
    ticketId: z.number().int(),
    eventType: CoreTicketEventTypeSchema,
    body: nullableString,
    oldStatus: TicketStatusSchema.nullable(),
    newStatus: TicketStatusSchema.nullable(),
    // Set only on QUESTION events; every other event type leaves this NULL.
    payloadJson: z.record(z.unknown()).nullable(),
    createdBy: z.number().int().nullable(),
    createdAt: z.string(),
});
export type SupportTicketEvent = z.infer<typeof SupportTicketEventSchema>;

export const SupportTicketEventCreateSchema = z.object({
    ticketId: z.number().int(),
    eventType: CoreTicketEventTypeSchema,
    body: optionalNullableString,
    oldStatus: TicketStatusSchema.nullable().optional(),
    newStatus: TicketStatusSchema.nullable().optional(),
    payloadJson: z.record(z.unknown()).nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
});
export type SupportTicketEventCreate = z.infer<typeof SupportTicketEventCreateSchema>;

// --- Attachments ---------------------------------------------------------------------------------

export const SupportAttachmentMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type SupportAttachmentMimeType = z.infer<typeof SupportAttachmentMimeTypeSchema>;

export const SupportTicketAttachmentInputSchema = z.object({
    ticketId: z.number().int().positive(),
    ticketEventId: optionalNullableInt,
    description: z.string().trim().min(10).max(1000),
    fileName: z.string().trim().min(1).max(255),
    mimeType: SupportAttachmentMimeTypeSchema,
    byteSize: z.number().int().min(1).max(SUPPORT_ATTACHMENT_MAX_BYTES),
});
export type SupportTicketAttachmentInput = z.infer<typeof SupportTicketAttachmentInputSchema>;

export const SupportTicketAttachmentMetadataSchema = SupportTicketAttachmentInputSchema.extend({
    id: z.number().int().positive(),
    createdAt: z.string(),
});
export type SupportTicketAttachmentMetadata = z.infer<typeof SupportTicketAttachmentMetadataSchema>;

// --- Runtime error groups / events (feed the fingerprint loop) ---------------------------------

export const AppErrorGroupSchema = z.object({
    id: z.number().int(),
    fingerprint: z.string(),
    message: z.string(),
    stackSignature: nullableString,
    route: nullableString,
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    occurrenceCount: z.number().int().nonnegative(),
    lastTicketId: z.number().int().nullable(),
    status: ErrorGroupStatusSchema,
});
export type AppErrorGroup = z.infer<typeof AppErrorGroupSchema>;

export const AppErrorGroupCreateSchema = z.object({
    fingerprint: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(1000),
    stackSignature: optionalNullableString,
    route: optionalNullableString,
    status: ErrorGroupStatusSchema.optional().default('NEW'),
});
export type AppErrorGroupCreate = z.input<typeof AppErrorGroupCreateSchema>;

export const AppErrorEventSchema = z.object({
    id: z.number().int(),
    groupId: z.number().int(),
    userId: z.number().int().nullable(),
    organizationId: z.number().int().nullable(),
    requestId: nullableString,
    url: nullableString,
    method: nullableString,
    appVersion: nullableString,
    browser: nullableString,
    severity: AppErrorSeveritySchema,
    payloadJson: SafeErrorPayloadSchema,
    createdAt: z.string(),
});
export type AppErrorEvent = z.infer<typeof AppErrorEventSchema>;

export const AppErrorEventCreateSchema = z.object({
    fingerprint: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(1000),
    stackSignature: optionalNullableString,
    route: optionalNullableString,
    userId: optionalNullableInt,
    organizationId: optionalNullableInt,
    requestId: optionalNullableString,
    url: optionalNullableString,
    method: optionalNullableString,
    appVersion: optionalNullableString,
    browser: optionalNullableString,
    severity: AppErrorSeveritySchema.optional().default('ERROR'),
    payloadJson: SafeErrorPayloadSchema.optional().default({}),
});
export type AppErrorEventCreate = z.input<typeof AppErrorEventCreateSchema>;

// --- Manual ticket intake (tester form) ---------------------------------------------------------

function textByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

const manualTitleSchema = z.string().trim().min(10).max(200);
const optionalManualAnswerSchema = z.string().trim().max(4000).nullable().optional();
const manualContextShape = {
    priority: TicketPrioritySchema.optional().default('NORMAL'),
    url: z.string().trim().max(1000).nullable().optional(),
    environment: z.string().trim().max(120).nullable().optional(),
    appVersion: z.string().trim().max(120).nullable().optional(),
    browser: z.string().trim().max(500).nullable().optional(),
};

export const consoleLogSchema = z
    .string()
    .refine((value) => textByteLength(value) <= SUPPORT_CONSOLE_LOG_MAX_BYTES, {
        message: `consoleLog must be at most ${SUPPORT_CONSOLE_LOG_MAX_BYTES} bytes`,
    })
    // Best-effort secret guard. Tolerates an optional quote around the delimiter so JSON/header
    // dumps like "Authorization": "Bearer ..." are caught too, plus bare Bearer/x-api-key shapes.
    // Defense-in-depth over an opt-in field, not a full DLP.
    .refine(
        (value) =>
            !/\b(?:authorization|cookie|password|secret|token|x-api-key)["']?\s*[:=]\s*["']?\S/i.test(value) &&
            // Bare token only when it looks like a real credential (>=16 token chars), so prose
            // like "bearer of quality" or "Bearer token missing" is not a false positive.
            !/\bbearer\s+[A-Za-z0-9._-]{16,}/i.test(value),
        {
            message: 'consoleLog must not contain authorization, cookie, password, secret or token assignments',
        },
    )
    .nullable()
    .optional();

export const manualRequirements = {
    BUG: [
        ['description', 20],
        ['stepsToReproduce', 20],
        ['actualResult', 10],
        ['expectedResult', 10],
    ],
    FEATURE: [
        ['description', 20],
        ['expectedResult', 20],
    ],
    SUPPORT: [
        ['description', 20],
        ['expectedResult', 10],
    ],
    TEST_FEEDBACK: [
        ['description', 20],
        ['actualResult', 10],
        ['expectedResult', 10],
    ],
} as const;

export const ManualSupportTicketCreateSchema = z
    .object({
        ...manualContextShape,
        type: TicketTypeSchema.exclude(['RUNTIME_ERROR']),
        title: z.string().trim().min(1).max(200),
        description: optionalManualAnswerSchema,
        stepsToReproduce: optionalManualAnswerSchema,
        actualResult: optionalManualAnswerSchema,
        expectedResult: optionalManualAnswerSchema,
        consoleLog: consoleLogSchema,
    })
    .superRefine((input, ctx) => {
        if (input.consoleLog != null && input.type !== 'BUG' && input.type !== 'TEST_FEEDBACK') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['consoleLog'],
                message: 'consoleLog is available only for BUG and TEST_FEEDBACK',
            });
        }
        if (input.type === 'OFFER_REQUEST') return;
        if (!manualTitleSchema.safeParse(input.title).success) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'title must be 10..200 characters' });
        }
        for (const [field, min] of manualRequirements[input.type]) {
            if ((input[field]?.length ?? 0) < min) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: `${field} must be ${min}..4000 characters`,
                });
            }
        }
    });
export type ManualSupportTicketCreate = z.input<typeof ManualSupportTicketCreateSchema>;

// --- List filter ----------------------------------------------------------------------------------

export const ListSupportTicketsFilterSchema = z.object({
    organizationId: z.number().int().nullable().optional(),
    userId: z.number().int().nullable().optional(),
    type: TicketTypeSchema.optional(),
    source: TicketSourceSchema.optional(),
    status: TicketStatusSchema.optional(),
    priority: TicketPrioritySchema.optional(),
    errorGroupId: z.number().int().optional(),
    q: z.string().optional(),
    // When false (default) and no explicit `status` filter, terminal statuses are excluded.
    includeClosed: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(100),
});
export type ListSupportTicketsFilter = z.input<typeof ListSupportTicketsFilterSchema>;
