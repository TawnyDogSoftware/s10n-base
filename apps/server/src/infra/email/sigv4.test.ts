import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeSignature, signRequest, verifySignature, type SignableRequest } from "./sigv4";

const SUITE = path.join(import.meta.dirname, "sigv4-test-suite");

interface SuiteContext {
  readonly credentials: {
    readonly access_key_id: string;
    readonly secret_access_key: string;
    readonly token?: string;
  };
  readonly normalize: boolean;
  readonly region: string;
  readonly service: string;
  readonly sign_body: boolean;
  readonly timestamp: string;
  readonly omit_session_token?: boolean;
}

interface SuiteRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Array<[string, string]>;
  readonly body: string;
}

/**
 * Parses a suite `request.txt`: a request line, `Name:value` headers (a line starting with
 * whitespace continues the previous value), a blank line and the body. The request target is
 * taken as sent, so `/ሴ` and `/example space/` stay raw.
 */
function parseSuiteRequest(text: string): SuiteRequest {
  const [head = "", body = ""] = text.split(/\n\n/, 2);
  const [requestLine = "", ...headerLines] = head.split("\n");
  const firstSpace = requestLine.indexOf(" ");
  const method = requestLine.slice(0, firstSpace);
  const target = requestLine.slice(firstSpace + 1, requestLine.lastIndexOf(" HTTP/"));
  const queryStart = target.indexOf("?");
  const headers: Array<[string, string]> = [];
  for (const line of headerLines) {
    if (line === "") continue;
    const last = headers.at(-1);
    if (/^\s/.test(line) && last !== undefined) {
      last[1] = `${last[1]}\n${line}`;
      continue;
    }
    const colon = line.indexOf(":");
    headers.push([line.slice(0, colon), line.slice(colon + 1)]);
  }
  return {
    method,
    path: queryStart === -1 ? target : target.slice(0, queryStart),
    query: queryStart === -1 ? "" : target.slice(queryStart + 1),
    headers,
    body,
  };
}

const cases = readdirSync(SUITE, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted((left, right) => left.localeCompare(right));

function read(name: string, file: string): string {
  return readFileSync(path.join(SUITE, name, file), "utf8");
}

function suiteCase(name: string) {
  const context = JSON.parse(read(name, "context.json")) as SuiteContext;
  const request = parseSuiteRequest(read(name, "request.txt"));
  const signable: SignableRequest = {
    method: request.method,
    path: request.path,
    query: request.query,
    headers: request.headers,
    body: request.body,
  };
  return {
    context,
    signable,
    options: {
      credentials: {
        accessKeyId: context.credentials.access_key_id,
        secretAccessKey: context.credentials.secret_access_key,
        ...(context.credentials.token === undefined
          ? {}
          : { sessionToken: context.credentials.token }),
      },
      region: context.region,
      service: context.service,
      date: new Date(context.timestamp),
      normalizePath: context.normalize,
      signBody: context.sign_body,
      signSessionToken: context.omit_session_token !== true,
    },
  };
}

describe("signRequest against the AWS SigV4 test suite", () => {
  it("has the published cases", () => {
    expect(cases).toHaveLength(38);
  });

  it.each(cases)("%s", (name) => {
    const { signable, options } = suiteCase(name);

    const signed = signRequest(signable, options);

    expect(signed.canonicalRequest).toBe(read(name, "header-canonical-request.txt"));
    expect(signed.stringToSign).toBe(read(name, "header-string-to-sign.txt"));
    expect(signed.signature).toBe(read(name, "header-signature.txt"));
    const authorization = read(name, "header-signed-request.txt")
      .split("\n")
      .find((line) => line.startsWith("Authorization:"));
    expect(signed.headers.authorization).toBe(authorization?.slice("Authorization:".length));
  });
});

describe("signRequest", () => {
  const options = {
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
    region: "us-east-1",
    service: "ses",
    date: new Date("2026-11-19T12:00:00Z"),
  };
  const request: SignableRequest = {
    method: "POST",
    path: "/v2/email/outbound-emails",
    query: "",
    headers: [
      ["host", "email.us-east-1.amazonaws.com"],
      ["content-type", "application/json"],
    ],
    body: '{"a":1}',
  };

  it("adds x-amz-date and the authorization header, signing every header it was given", () => {
    const signed = signRequest(request, options);

    expect(signed.headers["x-amz-date"]).toBe("20261119T120000Z");
    expect(signed.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261119\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(signed.headers["x-amz-security-token"]).toBeUndefined();
  });

  it("signs the session token when there is one", () => {
    const signed = signRequest(request, {
      ...options,
      credentials: { ...options.credentials, sessionToken: "token" },
    });

    expect(signed.headers["x-amz-security-token"]).toBe("token");
    expect(signed.headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token,",
    );
  });

  it("changes the signature when the body changes", () => {
    const first = signRequest(request, options);
    const second = signRequest({ ...request, body: '{"a":2}' }, options);

    expect(first.signature).not.toBe(second.signature);
  });

  it("double-encodes a path that is already percent-encoded, as AWS expects outside S3", () => {
    const signed = signRequest({ ...request, path: "/a%20b" }, options);

    expect(signed.canonicalRequest.split("\n")[1]).toBe("/a%2520b");
  });

  it("refuses a request without a host header", () => {
    expect(() => signRequest({ ...request, headers: [] }, options)).toThrow(/host/);
  });
});

describe("verifySignature", () => {
  const credentials = { accessKeyId: "local", secretAccessKey: "local" };
  const now = new Date("2026-11-19T12:00:00Z");
  const request: SignableRequest = {
    method: "POST",
    path: "/v2/email/outbound-emails",
    query: "",
    headers: [
      ["host", "127.0.0.1:8005"],
      ["content-type", "application/json"],
    ],
    body: '{"a":1}',
  };

  function signedRequest(overrides: Partial<SignableRequest> = {}, secret = "local") {
    const signed = signRequest(request, {
      credentials: { accessKeyId: "local", secretAccessKey: secret },
      region: "us-east-1",
      service: "ses",
      date: now,
    });
    return {
      ...request,
      headers: [...request.headers, ...Object.entries(signed.headers)],
      ...overrides,
    } satisfies SignableRequest;
  }

  it("accepts a request signed with the expected credentials", () => {
    expect(verifySignature(signedRequest(), { credentials, now })).toEqual({ ok: true });
  });

  it("rejects a request signed with another secret", () => {
    expect(verifySignature(signedRequest({}, "other"), { credentials, now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a request whose body changed after signing", () => {
    expect(verifySignature(signedRequest({ body: '{"a":2}' }), { credentials, now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a request with another access key id", () => {
    expect(
      verifySignature(signedRequest(), {
        credentials: { accessKeyId: "someone", secretAccessKey: "local" },
        now,
      }),
    ).toEqual({ ok: false, reason: "unknown_access_key" });
  });

  it("rejects a request without an authorization header", () => {
    expect(verifySignature(request, { credentials, now })).toEqual({
      ok: false,
      reason: "missing_authorization",
    });
  });

  it("rejects a malformed authorization header", () => {
    const malformed = {
      ...request,
      headers: [...request.headers, ["authorization", "AWS4-HMAC-SHA256 nonsense"]] as Array<
        [string, string]
      >,
    };
    expect(verifySignature(malformed, { credentials, now })).toEqual({
      ok: false,
      reason: "malformed_authorization",
    });
  });

  it("rejects a request signed more than 15 minutes away from now", () => {
    const later = new Date(now.getTime() + 16 * 60 * 1000);
    expect(verifySignature(signedRequest(), { credentials, now: later })).toEqual({
      ok: false,
      reason: "clock_skew",
    });
  });

  it("matches computeSignature for the same signed headers", () => {
    const signed = signedRequest();
    const header = signed.headers.find(([name]) => name === "authorization")?.[1] ?? "";
    const signature = /Signature=([0-9a-f]+)/.exec(header)?.[1];
    const recomputed = computeSignature(
      {
        ...signed,
        headers: signed.headers.filter(([name]) => name !== "authorization"),
      },
      { credentials, region: "us-east-1", service: "ses", amzDate: "20261119T120000Z" },
    );
    expect(recomputed.signature).toBe(signature);
  });
});
