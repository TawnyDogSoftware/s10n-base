/**
 * Amazon SES v2 `SendEmail`, as one signed `fetch`. This replaces the AWS SDK, of which we used
 * one command (plan 000, phase 4). Static keys only: a project that needs role assumption, SSO or
 * instance credentials puts the SDK back behind `AuthEmailSender` (docs/auth.md).
 *
 * Retries run on an Effect `Schedule`, and only where SES certainly did not accept the email: a
 * refused connection, throttling and 5xx answers. A timeout is not retried: SES has no
 * idempotency key, and the first request may have been accepted, so a retry could send twice.
 */
import { Data, Effect, Schedule } from "effect";

import { signRequest, type AwsCredentials } from "./sigv4";

/** One email with one recipient, a plain-text and an HTML body. */
export interface SesEmail {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string | undefined;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export type SesErrorKind =
  /** SES refused this email: a bad address, a paused or suspended account. */
  | "rejected"
  /** The sender or (in the SES sandbox) the recipient is not a verified identity. */
  | "not_verified"
  /** Too many requests, or the sending quota is used up. */
  | "throttled"
  /** The keys are wrong, expired or not allowed to send. */
  | "credentials"
  /** SES could not be reached, timed out, or failed on its side. */
  | "unavailable";

/**
 * Sending failed. Carries no credentials, signature, address or SES message text, so it can be
 * logged as it is.
 */
export class SesSendError extends Data.TaggedError("SesSendError")<{
  readonly kind: SesErrorKind;
  /** The HTTP status, when SES answered. */
  readonly status: number | undefined;
  /** SES's error type, such as `MessageRejected`, when it gave one. */
  readonly awsErrorType: string | undefined;
  /** What went wrong without an answer: `timeout`, `network` or `no_message_id`. */
  readonly reason: string | undefined;
  readonly attempts: number;
}> {
  override get message(): string {
    const detail = [
      this.status === undefined ? undefined : `status ${this.status}`,
      this.awsErrorType,
      this.reason,
    ].filter((part) => part !== undefined);
    return `SES did not send the email (${this.kind}; ${detail.join(", ")}; ${this.attempts} attempt${this.attempts === 1 ? "" : "s"}).`;
  }
}

export interface SesClientOptions {
  readonly region: string;
  /** Replaces `https://email.<region>.amazonaws.com`, for the local capture server. */
  readonly endpoint: string | undefined;
  readonly credentials: AwsCredentials;
  /** Per attempt. Default 10 seconds. */
  readonly timeoutMs?: number;
  /** When to retry an attempt that may be retried. Default: up to two retries, backing off. */
  readonly retrySchedule?: Schedule.Schedule<unknown>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface SesClient {
  /** @throws {SesSendError} when SES did not accept the email. */
  readonly sendEmail: (email: SesEmail) => Promise<{ readonly messageId: string }>;
}

export const DEFAULT_RETRY_SCHEDULE: Schedule.Schedule<unknown> = Schedule.max([
  Schedule.exponential("250 millis").pipe(Schedule.jittered),
  Schedule.recurs(2),
]);

const PATH = "/v2/email/outbound-emails";

/** Codes for a connection that was never made, so nothing reached SES. */
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

const CREDENTIAL_ERRORS = new Set([
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "InvalidClientTokenId",
  "AccessDeniedException",
  "ExpiredTokenException",
  "MissingAuthenticationToken",
]);
const THROTTLING_ERRORS = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "LimitExceededException",
]);
const NOT_VERIFIED_ERRORS = new Set([
  "MailFromDomainNotVerifiedException",
  "FromEmailAddressNotVerifiedException",
]);

interface AttemptFailure {
  readonly kind: SesErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly awsErrorType?: string;
  readonly reason?: string;
}

function requestBody(email: SesEmail): string {
  return JSON.stringify({
    FromEmailAddress: email.from,
    Destination: { ToAddresses: [email.to] },
    ...(email.replyTo === undefined ? {} : { ReplyToAddresses: [email.replyTo] }),
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: email.text, Charset: "UTF-8" },
          Html: { Data: email.html, Charset: "UTF-8" },
        },
      },
    },
  });
}

function errorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const code = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

function networkFailure(error: unknown): AttemptFailure {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { kind: "unavailable", retryable: false, reason: "timeout" };
  }
  const code = errorCode(error);
  return {
    kind: "unavailable",
    retryable: code !== undefined && NOT_SENT_CODES.has(code),
    reason: "network",
  };
}

/** The error type from `x-amzn-ErrorType` (`Type:namespace`), or the body's `__type` or `code`. */
async function awsErrorType(response: Response): Promise<{ type?: string; message?: string }> {
  const header = response.headers.get("x-amzn-errortype")?.split(":", 1)[0]?.trim();
  let body: { __type?: unknown; code?: unknown; message?: unknown; Message?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON: a proxy's error page, for instance.
  }
  const fromBody = [body.__type, body.code].find((value) => typeof value === "string") as
    | string
    | undefined;
  const type = header || fromBody?.split("#").at(-1);
  const message = [body.message, body.Message].find((value) => typeof value === "string") as
    | string
    | undefined;
  return { ...(type ? { type } : {}), ...(message === undefined ? {} : { message }) };
}

function classify(status: number, type: string | undefined, message: string | undefined) {
  const base = { status, ...(type === undefined ? {} : { awsErrorType: type }) };
  if (type !== undefined && CREDENTIAL_ERRORS.has(type)) {
    return { ...base, kind: "credentials" as const, retryable: false };
  }
  if (status === 429 || (type !== undefined && THROTTLING_ERRORS.has(type))) {
    // A quota that is used up does not come back in a few hundred milliseconds.
    return { ...base, kind: "throttled" as const, retryable: type !== "LimitExceededException" };
  }
  if (status >= 500) return { ...base, kind: "unavailable" as const, retryable: true };
  if (
    (type !== undefined && NOT_VERIFIED_ERRORS.has(type)) ||
    (type === "MessageRejected" && message !== undefined && /not verified/i.test(message))
  ) {
    return { ...base, kind: "not_verified" as const, retryable: false };
  }
  if (status === 401 || status === 403) {
    return { ...base, kind: "credentials" as const, retryable: false };
  }
  return { ...base, kind: "rejected" as const, retryable: false };
}

/** Creates an SES client. Nothing is sent until `sendEmail`. */
export function createSesClient(options: SesClientOptions): SesClient {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const url = new URL(PATH, options.endpoint ?? `https://email.${options.region}.amazonaws.com`);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const schedule = options.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;

  async function attempt(body: string): Promise<{ messageId: string } | AttemptFailure> {
    const signed = signRequest(
      {
        method: "POST",
        path: url.pathname,
        query: "",
        headers: [
          ["host", url.host],
          ["content-type", "application/json"],
        ],
        body,
      },
      { credentials: options.credentials, region: options.region, service: "ses", date: now() },
    );
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json", ...signed.headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return networkFailure(error);
    }
    if (response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as { MessageId?: unknown };
      return typeof parsed.MessageId === "string" && parsed.MessageId !== ""
        ? { messageId: parsed.MessageId }
        : {
            kind: "unavailable",
            retryable: false,
            status: response.status,
            reason: "no_message_id",
          };
    }
    const { type, message } = await awsErrorType(response);
    return classify(response.status, type, message);
  }

  return {
    sendEmail: async (email) => {
      const body = requestBody(email);
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        const result = yield* Effect.promise(() => attempt(body));
        if ("messageId" in result) return result;
        return yield* Effect.fail(result);
      }).pipe(Effect.retry({ schedule, while: (failure) => failure.retryable }));
      const outcome = await Effect.runPromise(Effect.result(program));
      if (outcome._tag === "Success") return outcome.success;
      const failure = outcome.failure;
      throw new SesSendError({
        kind: failure.kind,
        status: failure.status,
        awsErrorType: failure.awsErrorType,
        reason: failure.reason,
        attempts,
      });
    },
  };
}
