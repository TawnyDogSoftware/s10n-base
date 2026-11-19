/**
 * The local SES capture server: a stand-in for Amazon SES v2 that keeps emails in memory instead
 * of sending them, so sign-up and password reset work on a fresh clone with no AWS account.
 *
 * - `POST /v2/email/outbound-emails`: SES v2 `SendEmail` with simple content. The SigV4 signature
 *   is checked against the local placeholder keys (403 otherwise), so every local email is also
 *   a test of the server's signer. Raw MIME and templates are refused with 400.
 * - `GET /store`: `{ emails: [...] }`, oldest first. The live tests read emails from here.
 * - `POST /clear-store`, `GET /health-check`, and an inbox page at `/`.
 *
 * It listens on loopback only, since nothing here is authenticated, keeps at most `maxEmails`
 * (dropping the oldest), and limits request bodies.
 */
import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { readBody } from "../../apps/server/src/http/body";
import { LOCAL_SES_CREDENTIALS } from "../../apps/server/src/infra/email/local";
import { verifySignature } from "../../apps/server/src/infra/email/sigv4";

export interface StoredEmail {
  readonly messageId: string;
  /** ISO 8601. */
  readonly at: string;
  readonly from: string;
  readonly destination: {
    readonly to: readonly string[];
    readonly cc: readonly string[];
    readonly bcc: readonly string[];
  };
  readonly replyTo: readonly string[];
  readonly subject: string;
  readonly body: { readonly text?: string; readonly html?: string };
}

export interface SesLocalOptions {
  readonly host: string;
  readonly port: number;
  readonly maxEmails?: number;
  readonly bodyLimitBytes?: number;
}

export interface SesLocal {
  /** `http://host:port`, with the port actually bound. */
  readonly url: string;
  readonly emails: () => readonly StoredEmail[];
  readonly stop: () => Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SEND_PATH = "/v2/email/outbound-emails";

function sendJson(response: ServerResponse, status: number, body: unknown, errorType?: string) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  if (errorType !== undefined) response.setHeader("x-amzn-ErrorType", errorType);
  response.end(JSON.stringify(body));
}

function awsError(response: ServerResponse, status: number, type: string, message: string) {
  sendJson(response, status, { message }, type);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escapes text and turns each http(s) URL in it into a link. */
function linkify(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const index = match.index;
    html += escapeHtml(text.slice(last, index));
    const url = escapeHtml(match[0]);
    html += `<a href="${url}">${url}</a>`;
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

function inboxPage(emails: readonly StoredEmail[]): string {
  const items = emails
    .toReversed()
    .map(
      (email) => `<article>
<h2>${escapeHtml(email.subject)}</h2>
<p class="meta">To ${escapeHtml(email.destination.to.join(", "))} · from ${escapeHtml(email.from)} · ${escapeHtml(email.at)}</p>
<pre>${linkify(email.body.text ?? "(no text part)")}</pre>
</article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local inbox</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:60rem}article{border-top:1px solid #ccc;padding:1rem 0}.meta{color:#555}pre{white-space:pre-wrap;word-break:break-word}</style>
</head><body>
<h1>Local inbox</h1>
<p>${String(emails.length)} email${emails.length === 1 ? "" : "s"}, newest first. Emails the server sends through <code>SES_ENDPOINT</code> land here instead of being delivered. Reload to see new ones.</p>
${items || "<p>No emails yet.</p>"}
</body></html>`;
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

interface Content {
  readonly Data?: unknown;
}

/** An SES v2 `SendEmail` body read as an email, or what is wrong with it. */
type ParsedSendEmail =
  | { readonly email: Omit<StoredEmail, "messageId" | "at"> }
  | { readonly error: string };

/** Reads an SES v2 `SendEmail` body with simple content, or describes what is wrong with it. */
function parseSendEmail(body: unknown): ParsedSendEmail {
  if (typeof body !== "object" || body === null)
    return { error: "The body must be a JSON object." };
  const request = body as {
    FromEmailAddress?: unknown;
    Destination?: { ToAddresses?: unknown; CcAddresses?: unknown; BccAddresses?: unknown };
    ReplyToAddresses?: unknown;
    Content?: {
      Simple?: { Subject?: Content; Body?: { Text?: Content; Html?: Content } };
      Raw?: unknown;
      Template?: unknown;
    };
  };
  if (request.Content?.Raw !== undefined || request.Content?.Template !== undefined) {
    return {
      error:
        "The local capture server accepts only Simple content: raw MIME and templates are not supported, and the server never sends them.",
    };
  }
  const simple = request.Content?.Simple;
  const to = stringArray(request.Destination?.ToAddresses);
  const cc = stringArray(request.Destination?.CcAddresses);
  const bcc = stringArray(request.Destination?.BccAddresses);
  const replyTo = stringArray(request.ReplyToAddresses);
  const subject = simple?.Subject?.Data;
  const text = simple?.Body?.Text?.Data;
  const html = simple?.Body?.Html?.Data;
  if (typeof request.FromEmailAddress !== "string")
    return { error: "FromEmailAddress is required." };
  if (to === undefined || cc === undefined || bcc === undefined || replyTo === undefined) {
    return { error: "Addresses must be arrays of strings." };
  }
  if (to.length + cc.length + bcc.length === 0) return { error: "Destination needs an address." };
  if (typeof subject !== "string") return { error: "Content.Simple.Subject.Data is required." };
  if (typeof text !== "string" && typeof html !== "string") {
    return { error: "Content.Simple.Body needs Text or Html data." };
  }
  return {
    email: {
      from: request.FromEmailAddress,
      destination: { to, cc, bcc },
      replyTo,
      subject,
      body: {
        ...(typeof text === "string" ? { text } : {}),
        ...(typeof html === "string" ? { html } : {}),
      },
    },
  };
}

function headerPairs(request: IncomingMessage): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
    pairs.push([request.rawHeaders[index] ?? "", request.rawHeaders[index + 1] ?? ""]);
  }
  return pairs;
}

/**
 * Starts the capture server.
 *
 * @throws {Error} when `host` is not a loopback address, or the port cannot be bound.
 */
export async function startSesLocal(options: SesLocalOptions): Promise<SesLocal> {
  if (!LOOPBACK.has(options.host)) {
    throw new Error(
      `ses-local listens on a loopback address only (127.0.0.1, localhost or ::1), not ${options.host}: its inbox has no authentication.`,
    );
  }
  const maxEmails = options.maxEmails ?? 200;
  const bodyLimit = options.bodyLimitBytes ?? 1024 * 1024;
  let emails: StoredEmail[] = [];

  async function receive(request: IncomingMessage, response: ServerResponse) {
    const read = await readBody(request, bodyLimit);
    if (!read.ok) {
      if (read.reason === "aborted") return;
      response.setHeader("Connection", "close");
      awsError(response, 413, "BadRequestException", "The request body is too large.");
      return;
    }
    const target = request.url ?? "/";
    const queryStart = target.indexOf("?");
    const verified = verifySignature(
      {
        method: request.method ?? "POST",
        path: queryStart === -1 ? target : target.slice(0, queryStart),
        query: queryStart === -1 ? "" : target.slice(queryStart + 1),
        headers: headerPairs(request),
        body: read.body,
      },
      { credentials: LOCAL_SES_CREDENTIALS, now: new Date() },
    );
    if (!verified.ok) {
      awsError(
        response,
        403,
        "InvalidSignatureException",
        `The request signature does not match the local keys (${verified.reason}). Use AWS_ACCESS_KEY_ID=${LOCAL_SES_CREDENTIALS.accessKeyId} and AWS_SECRET_ACCESS_KEY=${LOCAL_SES_CREDENTIALS.secretAccessKey}.`,
      );
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(read.body.toString("utf8"));
    } catch {
      awsError(response, 400, "BadRequestException", "The body is not valid JSON.");
      return;
    }
    const parsed = parseSendEmail(body);
    if ("error" in parsed) {
      awsError(response, 400, "BadRequestException", parsed.error);
      return;
    }
    const stored: StoredEmail = {
      messageId: randomUUID(),
      at: new Date().toISOString(),
      ...parsed.email,
    };
    emails = [...emails, stored].slice(-maxEmails);
    sendJson(response, 200, { MessageId: stored.messageId });
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = (request.url ?? "/").split("?", 1)[0];
    const route = `${request.method ?? ""} ${String(path)}`;
    if (route === `POST ${SEND_PATH}`) return receive(request, response);
    request.resume();
    if (route === "GET /store") {
      sendJson(response, 200, { emails });
      return;
    }
    if (route === "POST /clear-store") {
      emails = [];
      sendJson(response, 200, { ok: true });
      return;
    }
    if (route === "GET /health-check") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (route === "GET /") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      );
      response.setHeader("Cache-Control", "no-store");
      response.end(inboxPage(emails));
      return undefined;
    }
    awsError(response, 404, "NotFoundException", "Not found.");
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) awsError(response, 500, "InternalFailure", "Unexpected error.");
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${host}:${String(address.port)}`,
    emails: () => emails,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
