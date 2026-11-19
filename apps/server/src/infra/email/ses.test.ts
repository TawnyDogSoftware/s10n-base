import { Schedule } from "effect";
import { describe, expect, it } from "vitest";

import { createSesClient, SesSendError, type SesClientOptions, type SesEmail } from "./ses";
import { verifySignature, type SignableRequest } from "./sigv4";

const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-key-never-logged",
};
const now = new Date("2026-11-19T12:00:00Z");

const email: SesEmail = {
  from: "no-reply@example.com",
  to: "someone@example.com",
  replyTo: "support@example.com",
  subject: "Hello",
  text: "Plain text",
  html: "<p>HTML</p>",
};

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

type Responder = (attempt: number) => Response | Error;

function fakeFetch(respond: Responder) {
  const calls: Recorded[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const result = respond(calls.length);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { calls, fetchImpl: fetchImpl };
}

function client(respond: Responder, overrides: Partial<SesClientOptions> = {}) {
  const fake = fakeFetch(respond);
  const ses = createSesClient({
    region: "eu-west-1",
    endpoint: undefined,
    credentials,
    fetch: fake.fetchImpl,
    now: () => now,
    retrySchedule: Schedule.recurs(2),
    ...overrides,
  });
  return { ses, calls: fake.calls };
}

function ok(messageId = "message-1") {
  return new Response(JSON.stringify({ MessageId: messageId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function awsError(status: number, type: string, message = "error") {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "content-type": "application/json", "x-amzn-errortype": `${type}:http://internal/` },
  });
}

function connectionRefused() {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8005"), {
      code: "ECONNREFUSED",
    }),
  });
}

async function failure(promise: Promise<unknown>): Promise<SesSendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SesSendError) return error;
    throw error;
  }
  throw new Error("expected the send to fail");
}

describe("createSesClient", () => {
  it("sends one SES v2 SendEmail request to the regional endpoint and returns the message id", async () => {
    const { ses, calls } = client(() => ok("abc-123"));

    await expect(ses.sendEmail(email)).resolves.toEqual({ messageId: "abc-123" });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(call?.body ?? "")).toEqual({
      FromEmailAddress: "no-reply@example.com",
      Destination: { ToAddresses: ["someone@example.com"] },
      ReplyToAddresses: ["support@example.com"],
      Content: {
        Simple: {
          Subject: { Data: "Hello", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Plain text", Charset: "UTF-8" },
            Html: { Data: "<p>HTML</p>", Charset: "UTF-8" },
          },
        },
      },
    });
  });

  it("signs the request so that it verifies with the same credentials", async () => {
    const { ses, calls } = client(() => ok());

    await ses.sendEmail(email);

    const [call] = calls;
    const url = new URL(call?.url ?? "");
    const request: SignableRequest = {
      method: call?.method ?? "",
      path: url.pathname,
      query: "",
      headers: [["host", url.host], ...(call?.headers.entries() ?? [])],
      body: call?.body ?? "",
    };
    expect(verifySignature(request, { credentials, now })).toEqual({ ok: true });
    expect(call?.headers.get("authorization")).toContain("/eu-west-1/ses/aws4_request");
  });

  it("uses SES_ENDPOINT instead of the regional endpoint when it is set", async () => {
    const { ses, calls } = client(() => ok(), { endpoint: "http://127.0.0.1:8005" });

    await ses.sendEmail(email);

    expect(calls[0]?.url).toBe("http://127.0.0.1:8005/v2/email/outbound-emails");
  });

  it("sends the session token when there is one", async () => {
    const { ses, calls } = client(() => ok(), {
      credentials: { ...credentials, sessionToken: "session-token" },
    });

    await ses.sendEmail(email);

    expect(calls[0]?.headers.get("x-amz-security-token")).toBe("session-token");
  });

  it("leaves ReplyToAddresses out when there is no reply-to address", async () => {
    const { ses, calls } = client(() => ok());

    await ses.sendEmail({ ...email, replyTo: undefined });

    expect(JSON.parse(calls[0]?.body ?? "")).not.toHaveProperty("ReplyToAddresses");
  });

  it("retries throttling, then succeeds", async () => {
    const { ses, calls } = client((attempt) =>
      attempt < 3 ? awsError(429, "TooManyRequestsException") : ok(),
    );

    await expect(ses.sendEmail(email)).resolves.toEqual({ messageId: "message-1" });
    expect(calls).toHaveLength(3);
  });

  it("retries a 5xx and a refused connection", async () => {
    const answers = [awsError(503, "ServiceUnavailable"), connectionRefused(), ok()];
    const { ses, calls } = client((attempt) => answers[attempt - 1] ?? ok());

    await expect(ses.sendEmail(email)).resolves.toEqual({ messageId: "message-1" });
    expect(calls).toHaveLength(3);
  });

  it("gives up after the schedule runs out", async () => {
    const { ses, calls } = client(() => awsError(500, "InternalFailure"));

    const error = await failure(ses.sendEmail(email));

    expect(error.kind).toBe("unavailable");
    expect(error.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it("retries at most twice by default, backing off", async () => {
    const fake = fakeFetch(() => awsError(503, "ServiceUnavailable"));
    const ses = createSesClient({
      region: "us-east-1",
      endpoint: undefined,
      credentials,
      fetch: fake.fetchImpl,
      now: () => now,
    });
    const started = performance.now();

    const error = await failure(ses.sendEmail(email));

    expect(error.attempts).toBe(3);
    expect(fake.calls).toHaveLength(3);
    expect(performance.now() - started).toBeGreaterThan(200);
  });

  it("does not retry a timeout, because SES may already have accepted the email", async () => {
    const { ses, calls } = client(
      () => new DOMException("The operation timed out.", "TimeoutError"),
      { timeoutMs: 50 },
    );

    const error = await failure(ses.sendEmail(email));

    expect(error.kind).toBe("unavailable");
    expect(error.reason).toBe("timeout");
    expect(calls).toHaveLength(1);
  });

  it("times out a request that never answers", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      })) as typeof fetch;
    const ses = createSesClient({
      region: "us-east-1",
      endpoint: undefined,
      credentials,
      fetch: hanging,
      now: () => now,
      timeoutMs: 20,
    });

    const error = await failure(ses.sendEmail(email));

    expect(error.reason).toBe("timeout");
  });

  it("does not retry a connection that failed after the request was sent", async () => {
    const reset = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    const { ses, calls } = client(() => reset);

    const error = await failure(ses.sendEmail(email));

    expect(error.kind).toBe("unavailable");
    expect(calls).toHaveLength(1);
  });

  it.each([
    [
      400,
      "MessageRejected",
      "Email address is not verified. The following identities failed",
      "not_verified",
    ],
    [400, "MailFromDomainNotVerifiedException", "x", "not_verified"],
    [400, "MessageRejected", "Illegal address", "rejected"],
    [400, "BadRequestException", "x", "rejected"],
    [400, "AccountSuspendedException", "x", "rejected"],
    [403, "UnrecognizedClientException", "x", "credentials"],
    [403, "InvalidSignatureException", "x", "credentials"],
    [403, "AccessDeniedException", "x", "credentials"],
    [400, "ExpiredTokenException", "x", "credentials"],
    [400, "LimitExceededException", "x", "throttled"],
    [429, "TooManyRequestsException", "x", "throttled"],
    [500, "InternalFailure", "x", "unavailable"],
  ] as const)("maps %i %s to %s", async (status, type, message, kind) => {
    const { ses } = client(() => awsError(status, type, message), {
      retrySchedule: Schedule.recurs(0),
    });

    const error = await failure(ses.sendEmail(email));

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.awsErrorType).toBe(type);
  });

  it("does not retry a rejection or a credentials error", async () => {
    for (const response of [
      () => awsError(400, "MessageRejected"),
      () => awsError(403, "InvalidSignatureException"),
      () => awsError(400, "LimitExceededException"),
    ]) {
      const { ses, calls } = client(response);
      await failure(ses.sendEmail(email));
      expect(calls).toHaveLength(1);
    }
  });

  it("reads the error type from the body when the header is missing, and copes with a body that is not JSON", async () => {
    const fromBody = client(
      () =>
        new Response(JSON.stringify({ __type: "MessageRejected", message: "x" }), { status: 400 }),
    );
    expect((await failure(fromBody.ses.sendEmail(email))).awsErrorType).toBe("MessageRejected");

    const notJson = client(() => new Response("<html>bad gateway</html>", { status: 502 }), {
      retrySchedule: Schedule.recurs(0),
    });
    const error = await failure(notJson.ses.sendEmail(email));
    expect(error.kind).toBe("unavailable");
    expect(error.awsErrorType).toBeUndefined();
  });

  it("treats a 200 without a message id as unavailable, not as sent", async () => {
    const { ses } = client(() => new Response("{}", { status: 200 }));

    expect((await failure(ses.sendEmail(email))).kind).toBe("unavailable");
  });

  it("never puts credentials, the signature or the recipient in the error", async () => {
    const { ses, calls } = client(() => awsError(403, "SignatureDoesNotMatch", "bad signature"), {
      credentials: { ...credentials, sessionToken: "session-token-never-logged" },
    });

    const error = await failure(ses.sendEmail(email));

    const signature = /Signature=([0-9a-f]+)/.exec(
      calls[0]?.headers.get("authorization") ?? "",
    )?.[1];
    for (const text of [error.message, String(error), JSON.stringify(error)]) {
      expect(text).not.toContain("secret-key-never-logged");
      expect(text).not.toContain("session-token-never-logged");
      expect(text).not.toContain(signature);
      expect(text).not.toContain("someone@example.com");
    }
  });
});

describe("failures it cannot place", () => {
  it.each([
    ["no cause", new TypeError("fetch failed")],
    [
      "a cause that is not an error",
      Object.assign(new TypeError("fetch failed"), { cause: "hang up" }),
    ],
    [
      "a cause whose code is not text",
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("x"), { code: 7 }),
      }),
    ],
  ])(
    "does not retry a network failure with %s: the email may have been sent",
    async (_case, thrown) => {
      const { ses, calls } = client(() => thrown);

      const error = await failure(ses.sendEmail(email));

      expect(error).toMatchObject({ kind: "unavailable", reason: "network", status: undefined });
      expect(error.message).toBe("SES did not send the email (unavailable; network; 1 attempt).");
      expect(calls).toHaveLength(1);
    },
  );

  it("reports a 200 whose body is not JSON as having no message id", async () => {
    const { ses } = client(() => new Response("OK", { status: 200 }));

    expect(await failure(ses.sendEmail(email))).toMatchObject({
      kind: "unavailable",
      status: 200,
      reason: "no_message_id",
    });
  });

  it("calls MessageRejected without a message a rejection", async () => {
    const { ses } = client(
      () =>
        new Response("{}", {
          status: 400,
          headers: { "x-amzn-errortype": "MessageRejected:http://internal/" },
        }),
    );

    expect(await failure(ses.sendEmail(email))).toMatchObject({
      kind: "rejected",
      awsErrorType: "MessageRejected",
    });
  });

  it("calls a 403 of a type it does not know a credentials problem", async () => {
    const { ses } = client(() => awsError(403, "SomethingNew"));

    expect(await failure(ses.sendEmail(email))).toMatchObject({ kind: "credentials", status: 403 });
  });
});
