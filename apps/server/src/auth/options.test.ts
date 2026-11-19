import { Kysely, PostgresDialect } from "kysely";
import { describe, expect, it, vi } from "vitest";

import type { DB } from "../infra/postgres/generated/db";
import { createLogger } from "../observability/logger";
import { AUTH_EMAIL_LINK_SECONDS } from "./email/render";
import {
  authEmailLink,
  AUTH_COOKIE_PREFIX,
  CLIENT_IP_HEADER,
  buildAuthOptions,
  trustedOrigins,
  type AuthOptionsConfig,
} from "./options";

const config: AuthOptionsConfig = {
  appName: "S10N Base",
  appOrigin: "https://app.example.com",
  nodeEnv: "production",
  appVariant: "production",
  secret: "a-test-secret-that-is-at-least-32-characters",
  logLevel: "info",
};

function setup(overrides: Partial<AuthOptionsConfig> = {}) {
  const lines: Array<Record<string, unknown>> = [];
  const emailSender = {
    sendVerificationEmail: vi.fn(() => Promise.resolve()),
    sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
  };
  // Never connected: the options only hold the instance.
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: { connect: () => Promise.reject(new Error("no")) } as never,
    }),
  });
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const options = buildAuthOptions({ ...config, ...overrides }, { db, emailSender, logger });
  return { options, emailSender, lines, db };
}

const user = {
  id: "6f1c2b9e-0000-4000-8000-000000000001",
  email: "user@example.com",
  name: "User",
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("buildAuthOptions", () => {
  it("mounts Better Auth at /api/auth under APP_URL with telemetry off", () => {
    const { options } = setup();

    expect(options.baseURL).toBe("https://app.example.com");
    expect(options.basePath).toBe("/api/auth");
    expect(options.secret).toBe(config.secret);
    expect(options.telemetry).toEqual({ enabled: false });
    expect(options.appName).toBe("S10N Base");
  });

  it("uses the server's Kysely instance for Postgres, with transactions", () => {
    const { options, db } = setup();

    expect(options.database).toEqual({ db, type: "postgres", transaction: true });
  });

  it("names every table ba_* and maps every camelCase field to snake_case", () => {
    const { options } = setup();

    expect(options.user.modelName).toBe("ba_user");
    expect(options.session.modelName).toBe("ba_session");
    expect(options.account.modelName).toBe("ba_account");
    expect(options.verification.modelName).toBe("ba_verification");
    expect(options.rateLimit.modelName).toBe("ba_rate_limit");
    for (const fields of [
      options.user.fields,
      options.session.fields,
      options.account.fields,
      options.verification.fields,
      options.rateLimit.fields,
    ]) {
      for (const [field, column] of Object.entries(fields)) {
        expect(column).toBe(field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
      }
    }
    expect(options.advanced.database.generateId).toBe("uuid");
  });

  it("requires email verification, revokes sessions on reset and sets both link expiries", () => {
    const { options } = setup();

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: AUTH_EMAIL_LINK_SECONDS,
    });
    expect(options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: AUTH_EMAIL_LINK_SECONDS,
    });
  });

  it("sends the verification and reset emails with links to the web app's own pages", async () => {
    const { options, emailSender } = setup();

    await options.emailVerification.sendVerificationEmail({
      user,
      url: "https://ignored.example/api/auth/verify-email?token=t",
      token: "a.b-c_d",
    });
    await options.emailAndPassword.sendResetPassword({
      user,
      url: "https://ignored.example/api/auth/reset-password/r",
      token: "r+s=/t",
    });

    expect(emailSender.sendVerificationEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      url: "https://app.example.com/verify-email?token=a.b-c_d",
    });
    expect(emailSender.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      url: "https://app.example.com/reset-password?token=r%2Bs%3D%2Ft",
    });
  });

  it("builds the email links from APP_URL", () => {
    expect(authEmailLink("https://app.example.com", "/verify-email", "x y")).toBe(
      "https://app.example.com/verify-email?token=x%20y",
    );
  });

  it("keeps rate limits in the database", () => {
    expect(setup().options.rateLimit).toMatchObject({ enabled: true, storage: "database" });
  });

  it("uses the neutral cookie prefix, http-only lax cookies, and secure ones under https", () => {
    const secure = setup().options.advanced;
    const plain = setup({ appOrigin: "http://localhost:5173", nodeEnv: "development" }).options
      .advanced;

    expect(secure.cookiePrefix).toBe(AUTH_COOKIE_PREFIX);
    expect(secure.useSecureCookies).toBe(true);
    expect(secure.defaultCookieAttributes).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(plain.useSecureCookies).toBe(false);
    expect(plain.defaultCookieAttributes.secure).toBe(false);
  });

  it("keeps Better Auth's origin and CSRF checks on, which it would turn off when NODE_ENV is test", () => {
    const { advanced } = setup({ nodeEnv: "test" }).options;

    expect(advanced.disableOriginCheck).toBe(false);
    expect(advanced.disableCSRFCheck).toBe(false);
  });

  it("reads the client IP from the bridge's header only", () => {
    expect(setup().options.advanced.ipAddress).toEqual({ ipAddressHeaders: [CLIENT_IP_HEADER] });
  });

  it("turns on the expo, admin and passkey plugins, and turns off the stock remove-user endpoint", () => {
    const { options } = setup();

    expect(options.plugins.map((plugin) => plugin.id)).toEqual(["expo", "admin", "passkey"]);
    expect(options.disabledPaths).toEqual(["/admin/remove-user"]);
  });

  it("routes Better Auth's log lines into ours", () => {
    const { options, lines } = setup();

    options.logger.log?.("error", "something failed", new Error("boom"), { other: 1 });

    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        message: "better_auth",
        authMessage: "something failed",
        error: expect.objectContaining({ message: "boom" }),
      }),
    ]);
  });
});

describe("trustedOrigins", () => {
  it("trusts APP_URL and the app variant's URL scheme", () => {
    expect(trustedOrigins(config)).toEqual(["https://app.example.com", "s10nbase://"]);
    expect(trustedOrigins({ ...config, appVariant: "preview" })).toEqual([
      "https://app.example.com",
      "s10nbase-preview://",
    ]);
  });

  it("trusts Expo Go's exp:// in development only", () => {
    expect(trustedOrigins({ ...config, nodeEnv: "development" })).toContain("exp://");
    expect(trustedOrigins({ ...config, nodeEnv: "test" })).not.toContain("exp://");
  });
});
