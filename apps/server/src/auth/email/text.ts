/**
 * The English text of the auth emails, kept together so phase 5 can move it into
 * `packages/i18n` in one piece. Placeholders are filled by `render.ts`, which escapes them.
 */
export const authEmailText = {
  verifyEmail: {
    subject: "Confirm your email address",
    heading: "Confirm your email address",
    body: "Confirm this address to finish creating your account. The link works for one hour.",
    action: "Confirm email address",
  },
  resetPassword: {
    subject: "Reset your password",
    heading: "Reset your password",
    body: "We received a request to reset the password for this account. Use the link to choose a new one. The link works for one hour.",
    action: "Choose a new password",
  },
  linkFallback: "If the button does not work, open this address in your browser:",
  ignoreNotice: "If you did not ask for this, you can ignore this email. Nothing will change.",
  footer: (supportEmail: string) => `Questions? Write to ${supportEmail}.`,
} as const;
