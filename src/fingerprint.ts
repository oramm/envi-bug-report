import crypto from 'node:crypto';
import { z } from 'zod';
import { AppErrorSeveritySchema, type AppErrorSeverity, type TicketPriority } from './contracts';

// Ported verbatim from the reference implementation's runtime-error intake module. None of these
// five functions is exported in the source system today — they are private module functions wired
// into its own request-recording/capture pipeline, which stays there (repository- and
// licence-gate-dependent). `stackSignature` and `safeLocation` additionally port a body that
// already lives a second time, byte for byte, in that system's client-side error-capture module —
// a real second consumer already existed in the source, so both graduate to this library now
// rather than waiting for a later extraction round. Only the parameter type widens from
// `string | undefined` to `string | null | undefined` to cover both call sites; the algorithm is
// untouched.

const breadcrumbSchema = z
    .object({
        actionType: z.string().trim().min(1).max(80),
    })
    .strip();

const failedRequestSchema = z
    .object({
        endpoint: z.string().trim().min(1).max(300),
        status: z.number().int().min(100).max(599),
        requestId: z.string().trim().max(120).nullable().optional(),
    })
    .strip();

export const errorReportSchema = z
    .object({
        message: z.string().trim().min(1).max(1000),
        stack: z.string().max(8000).nullable().optional(),
        stackSignature: z.string().trim().max(500).nullable().optional(),
        route: z.string().trim().max(500).nullable().optional(),
        url: z.string().trim().max(1000).nullable().optional(),
        previousRoute: z.string().trim().max(500).nullable().optional(),
        appVersion: z.string().trim().max(120).nullable().optional(),
        browser: z.string().trim().max(500).nullable().optional(),
        os: z.string().trim().max(200).nullable().optional(),
        requestId: z.string().trim().max(120).nullable().optional(),
        timestamp: z.string().trim().max(80).nullable().optional(),
        severity: AppErrorSeveritySchema.optional().default('ERROR'),
        breadcrumbs: z.array(breadcrumbSchema).max(20).optional().default([]),
        lastFailedRequest: failedRequestSchema.nullable().optional(),
        userNote: z.string().trim().max(1000).nullable().optional(),
    })
    .strip();

export type ErrorReport = z.infer<typeof errorReportSchema>;

/** `sha256` over `[message, stackSignature, route, appVersion]` — identical to the source algorithm. */
export function fingerprint(report: Pick<ErrorReport, 'message' | 'stackSignature' | 'route' | 'appVersion'>): string {
    return crypto
        .createHash('sha256')
        .update([report.message, report.stackSignature ?? '', report.route ?? '', report.appVersion ?? ''].join('\n'))
        .digest('hex');
}

function safeMessage(value: unknown): string {
    const raw = value instanceof Error ? value.message : String(value || 'Runtime error');
    return raw.replace(/(password|secret|token|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 1000);
}

function safeText(value: string | null | undefined, max = 1000): string | null {
    if (!value) return null;
    return value.replace(/(password|secret|token|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, max);
}

/** Redacts credential-shaped query params from a URL/path and truncates to 1000 chars. */
export function safeLocation(value: string | null | undefined): string | null {
    if (!value) return null;
    return value
        .replace(/([?&][^=]*(password|secret|token|cookie|authorization|session)[^=]*=)[^&]*/gi, '$1[redacted]')
        .slice(0, 1000);
}

export function sanitizeReport(report: ErrorReport): ErrorReport {
    return {
        ...report,
        message: safeMessage(report.message),
        stack: safeText(report.stack, 8000),
        stackSignature: safeText(report.stackSignature, 500),
        route: safeLocation(report.route),
        url: safeLocation(report.url),
        previousRoute: safeLocation(report.previousRoute),
        lastFailedRequest: report.lastFailedRequest
            ? { ...report.lastFailedRequest, endpoint: safeLocation(report.lastFailedRequest.endpoint) ?? '' }
            : report.lastFailedRequest,
    };
}

/** First three non-empty stack-trace lines, joined with `" | "`, capped at 500 chars. */
export function stackSignature(stack: string | null | undefined): string | null {
    if (!stack) return null;
    return stack
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' | ')
        .slice(0, 500);
}

export function priorityForSeverity(severity: AppErrorSeverity): TicketPriority {
    if (severity === 'CRITICAL') return 'CRITICAL';
    if (severity === 'ERROR') return 'HIGH';
    return 'NORMAL';
}

export function shouldAutoTicket(severity: AppErrorSeverity, occurrenceCount: number): boolean {
    return severity === 'CRITICAL' || occurrenceCount >= 2;
}
