import type { SesClient } from "../../infra/email/ses";
import type { Logger } from "../../observability/logger";
import { renderAuthEmail, type AuthEmailKind } from "./render";

/** One auth email: who it goes to and the link it carries. */
export interface AuthEmailLink {
  readonly to: string;
  readonly url: string;
}

/**
 * Sends the emails Better Auth asks for. Better Auth's hooks call it; nothing else knows how
 * email is delivered, so a project can swap SES for another provider behind this interface.
 */
export interface AuthEmailSender {
  readonly sendVerificationEmail: (link: AuthEmailLink) => Promise<void>;
  readonly sendPasswordResetEmail: (link: AuthEmailLink) => Promise<void>;
}

export interface SesAuthEmailSenderOptions {
  readonly ses: Pick<SesClient, "sendEmail">;
  readonly from: string;
  readonly supportEmail: string;
  readonly logger: Logger;
}

/**
 * Sends auth emails through SES. Logs the outcome with the message id or the error kind, never
 * the address or the link (the link is the only copy of its token).
 */
export function createSesAuthEmailSender(options: SesAuthEmailSenderOptions): AuthEmailSender {
  const deliver = async (kind: AuthEmailKind, { to, url }: AuthEmailLink) => {
    const content = renderAuthEmail(kind, url, { supportEmail: options.supportEmail });
    try {
      const { messageId } = await options.ses.sendEmail({
        from: options.from,
        to,
        replyTo: options.supportEmail,
        ...content,
      });
      options.logger.info("auth_email_sent", { kind, messageId });
    } catch (error) {
      options.logger.error("auth_email_failed", { kind, error });
      throw error;
    }
  };
  return {
    sendVerificationEmail: (link) => deliver("verifyEmail", link),
    sendPasswordResetEmail: (link) => deliver("resetPassword", link),
  };
}
