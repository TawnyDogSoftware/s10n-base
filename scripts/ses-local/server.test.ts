import { afterEach, describe, expect, it } from "vitest";

import { LOCAL_SES_CREDENTIALS } from "../../apps/server/src/infra/email/local";
import {
  createSesClient,
  SesSendError,
  type SesEmail,
} from "../../apps/server/src/infra/email/ses";
import { signRequest } from "../../apps/server/src/infra/email/sigv4";
import { startSesLocal, type SesLocal } from "./server";

let running: SesLocal | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function start(options: Partial<Parameters<typeof startSesLocal>[0]> = {}) {
  running = await startSesLocal({ host: "127.0.0.1", port: 0, ...options });
  return running;
}

function sesFor(
  local: SesLocal,
  credentials: { accessKeyId: string; secretAccessKey: string } = LOCAL_SES_CREDENTIALS,
) {
  return createSesClient({
    region: "us-east-1",
    endpoint: local.url,
    credentials,
  });
}

const email: SesEmail = {
  from: "no-reply@example.com",
  to: "someone@example.com",
  replyTo: "support@example.com",
  subject: "Confirm your email address",
  text: "Confirm: https://app.example.com/api/auth/verify-email?token=abc&callbackURL=%2F",
  html: "<p>Confirm</p>",
};

interface StoredEmail {
  readonly messageId: string;
  readonly from: string;
  readonly destination: { readonly to: readonly string[] };
  readonly replyTo: readonly string[];
  readonly subject: string;
  readonly body: { readonly text?: string; readonly html?: string };
  readonly at: string;
}

async function store(local: SesLocal): Promise<StoredEmail[]> {
  const response = await fetch(`${local.url}/store`);
  return ((await response.json()) as { emails: StoredEmail[] }).emails;
}

function rawSend(local: SesLocal, body: string, headers: Record<string, string> = {}) {
  return fetch(`${local.url}/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("ses-local", () => {
  it("accepts an email signed with the local keys and keeps it in /store", async () => {
    const local = await start();

    const { messageId } = await sesFor(local).sendEmail(email);

    const emails = await store(local);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      messageId,
      from: "no-reply@example.com",
      destination: { to: ["someone@example.com"] },
      replyTo: ["support@example.com"],
      subject: "Confirm your email address",
      body: { text: email.text, html: "<p>Confirm</p>" },
    });
    expect(Number.isNaN(Date.parse(emails[0]?.at ?? ""))).toBe(false);
  });

  it("refuses a request signed with other keys with 403, which the client reads as credentials", async () => {
    const local = await start();

    const error = await sesFor(local, { accessKeyId: "local", secretAccessKey: "wrong" })
      .sendEmail(email)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SesSendError);
    expect((error as SesSendError).kind).toBe("credentials");
    expect((error as SesSendError).status).toBe(403);
    expect(await store(local)).toEqual([]);
  });

  it("refuses an unsigned request", async () => {
    const local = await start();

    const response = await rawSend(local, "{}");

    expect(response.status).toBe(403);
  });

  it("refuses raw MIME and template content loudly, after checking the signature", async () => {
    const local = await start();
    // The client only sends simple content, so sign these requests by hand.
    for (const content of [{ Raw: { Data: "TUlNRQ==" } }, { Template: { TemplateName: "x" } }]) {
      const body = JSON.stringify({
        FromEmailAddress: "no-reply@example.com",
        Destination: { ToAddresses: ["someone@example.com"] },
        Content: content,
      });
      const url = new URL(`${local.url}/v2/email/outbound-emails`);
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
        {
          credentials: LOCAL_SES_CREDENTIALS,
          region: "us-east-1",
          service: "ses",
          date: new Date(),
        },
      );
      const response = await rawSend(local, body, signed.headers);
      expect(response.status).toBe(400);
      expect(response.headers.get("x-amzn-errortype")).toMatch(/^BadRequestException/);
      expect(((await response.json()) as { message: string }).message).toMatch(
        /only simple content/i,
      );
    }
    expect(await store(local)).toEqual([]);
  });

  it("refuses a body over its limit with 413", async () => {
    const local = await start({ bodyLimitBytes: 2048 });

    const error = await sesFor(local)
      .sendEmail({ ...email, text: "x".repeat(4096) })
      .catch((caught: unknown) => caught);

    expect((error as SesSendError).status).toBe(413);
  });

  it("keeps only the newest emails once the store is full", async () => {
    const local = await start({ maxEmails: 2 });
    const ses = sesFor(local);

    for (const subject of ["one", "two", "three"]) await ses.sendEmail({ ...email, subject });

    expect((await store(local)).map((stored) => stored.subject)).toEqual(["two", "three"]);
  });

  it("empties the store on POST /clear-store", async () => {
    const local = await start();
    await sesFor(local).sendEmail(email);

    const cleared = await fetch(`${local.url}/clear-store`, { method: "POST" });

    expect(cleared.status).toBe(200);
    expect(await store(local)).toEqual([]);
  });

  it("answers /health-check", async () => {
    const local = await start();

    const response = await fetch(`${local.url}/health-check`);

    expect(response.status).toBe(200);
  });

  it("shows an inbox page with each email's text escaped and its links clickable", async () => {
    const local = await start();
    await sesFor(local).sendEmail({
      ...email,
      subject: "<script>alert(1)</script>",
      text: 'Hello <b>you</b>\nOpen https://app.example.com/x?a=1&b="2" now',
    });

    const response = await fetch(`${local.url}/`);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("Hello &lt;b&gt;you&lt;/b&gt;");
    expect(page).toContain('<a href="https://app.example.com/x?a=1&amp;b=">');
    expect(page).toContain("someone@example.com");
  });

  it("answers 404 for anything else", async () => {
    const local = await start();

    expect((await fetch(`${local.url}/v2/email/account`)).status).toBe(404);
    expect((await fetch(`${local.url}/store`, { method: "DELETE" })).status).toBe(404);
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "example.com"])(
    "refuses to listen on %s, since the inbox has no authentication",
    async (host) => {
      await expect(startSesLocal({ host, port: 0 })).rejects.toThrow(/loopback/);
    },
  );
});
