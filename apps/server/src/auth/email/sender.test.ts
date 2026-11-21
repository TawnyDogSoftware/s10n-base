import { describe, expect, it, vi } from "vitest";

import { SesSendError, type SesEmail } from "../../infra/email/ses";
import { createLogger } from "../../observability/logger";
import { createSesAuthEmailSender } from "./sender";

function setup(sendEmail: (email: SesEmail) => Promise<{ messageId: string }>) {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const send = vi.fn<typeof sendEmail>(sendEmail);
  const sender = createSesAuthEmailSender({
    ses: { sendEmail: send },
    from: "no-reply@example.com",
    supportEmail: "support@example.com",
    logger,
  });
  return { sender, send, lines };
}

describe("createSesAuthEmailSender", () => {
  it("sends a verification email from EMAIL_FROM with replies going to SUPPORT_EMAIL", async () => {
    const { sender, send, lines } = setup(() => Promise.resolve({ messageId: "m-1" }));

    await sender.sendVerificationEmail({ to: "user@example.com", url: "https://x.example/v" });

    expect(send).toHaveBeenCalledOnce();
    const email = send.mock.calls[0]?.[0];
    expect(email).toMatchObject({
      from: "no-reply@example.com",
      to: "user@example.com",
      replyTo: "support@example.com",
    });
    expect(email?.text).toContain("https://x.example/v");
    expect(lines).toContainEqual(
      expect.objectContaining({
        message: "auth_email_sent",
        kind: "verifyEmail",
        messageId: "m-1",
      }),
    );
  });

  it("sends a password reset email", async () => {
    const { sender, send } = setup(() => Promise.resolve({ messageId: "m-2" }));

    await sender.sendPasswordResetEmail({ to: "user@example.com", url: "https://x.example/r" });

    expect(send.mock.calls[0]?.[0].subject).toMatch(/password/i);
  });

  it("logs a failure without the address or the link, and rethrows it", async () => {
    const failure = new SesSendError({
      kind: "throttled",
      status: 429,
      awsErrorType: "TooManyRequestsException",
      reason: undefined,
      attempts: 3,
    });
    const { sender, lines } = setup(() => Promise.reject(failure));

    await expect(
      sender.sendVerificationEmail({ to: "user@example.com", url: "https://x.example/v?token=t" }),
    ).rejects.toBe(failure);

    const logged = JSON.stringify(lines);
    expect(logged).toContain("auth_email_failed");
    expect(logged).toContain("throttled");
    expect(logged).not.toContain("user@example.com");
    expect(logged).not.toContain("token=t");
  });
});
