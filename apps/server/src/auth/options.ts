/**
 * Better Auth's options, built by one pure function so the configuration can be tested without a
 * database or a request. Everything product-specific is left out: a project adds its own plugins,
 * fields and hooks here.
 */
import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { admin } from "better-auth/plugins";
import type { Kysely } from "kysely";

import { appVariants, type AppVariant } from "@s10n-base/shared/app-variants";
import { AUTH_COOKIE_PREFIX } from "@s10n-base/shared/auth";

import type { LogLevel, NodeEnv } from "../config";
import type { DB } from "../infra/postgres/generated/db";
import type { Logger } from "../observability/logger";
import { AUTH_EMAIL_LINK_SECONDS } from "./email/render";
import type { AuthEmailSender } from "./email/sender";

/** Where Better Auth is mounted. */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The prefix of every auth cookie (`s10n-base.session_token`). It lives in `packages/shared`, so
 * the mobile app's auth client reads the same cookies the server sets.
 */
export { AUTH_COOKIE_PREFIX };

/**
 * The header Better Auth reads the client's IP address from. Only the bridge sets it, from the
 * server's own client-IP resolver; an incoming copy is always removed first.
 */
export const CLIENT_IP_HEADER = "x-s10n-base-client-ip";

/**
 * Better Auth endpoints that are turned off. Removing a user needs cleanup that only a product
 * knows about, so the admin plugin's stock endpoint stays off; docs/auth.md shows how to add a
 * guarded one.
 */
const DISABLED_AUTH_PATHS: readonly string[] = ["/admin/remove-user"];

/** The web app's pages that email links open. They read `token` and call Better Auth. */
const VERIFY_EMAIL_PAGE = "/verify-email";
const RESET_PASSWORD_PAGE = "/reset-password";

/**
 * A link to one of the web app's pages under `APP_URL`, carrying the token. The page calls Better
 * Auth itself, so the link never points at `/api/auth` and works the same for a project whose
 * API is on another origin.
 */
export function authEmailLink(appOrigin: string, page: string, token: string): string {
  return `${new URL(page, appOrigin).href}?token=${encodeURIComponent(token)}`;
}

/** What the options depend on from the server config. */
export interface AuthOptionsConfig {
  readonly appName: string;
  /** `APP_URL`. */
  readonly appOrigin: string;
  readonly nodeEnv: NodeEnv;
  readonly appVariant: AppVariant;
  /** `BETTER_AUTH_SECRET`, unwrapped. */
  readonly secret: string;
  readonly logLevel: LogLevel;
}

export interface AuthOptionsDependencies {
  readonly db: Kysely<DB>;
  readonly emailSender: AuthEmailSender;
  readonly logger: Logger;
}

const TIMESTAMPS = { createdAt: "created_at", updatedAt: "updated_at" };

/** Every camelCase field mapped to its snake_case column, table by table. */
const AUTH_TABLES = {
  user: {
    modelName: "ba_user",
    fields: { emailVerified: "email_verified", ...TIMESTAMPS },
  },
  session: {
    modelName: "ba_session",
    fields: {
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
      ...TIMESTAMPS,
    },
  },
  account: {
    modelName: "ba_account",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      ...TIMESTAMPS,
    },
  },
  verification: {
    modelName: "ba_verification",
    fields: { expiresAt: "expires_at", ...TIMESTAMPS },
  },
  rateLimit: {
    modelName: "ba_rate_limit",
    fields: { lastRequest: "last_request" },
  },
  passkey: {
    modelName: "ba_passkey",
    fields: {
      publicKey: "public_key",
      userId: "user_id",
      credentialID: "credential_id",
      deviceType: "device_type",
      backedUp: "backed_up",
      createdAt: "created_at",
    },
  },
  /** Columns the admin plugin adds to the user and session tables. */
  admin: {
    user: { fields: { banReason: "ban_reason", banExpires: "ban_expires" } },
    session: { fields: { impersonatedBy: "impersonated_by" } },
  },
} as const;

/**
 * The origins Better Auth trusts for redirects and cross-origin checks: `APP_URL`, the mobile
 * app's URL scheme for this server's `APP_VARIANT`, and Expo Go's `exp://` in development only.
 */
export function trustedOrigins(
  config: Pick<AuthOptionsConfig, "appOrigin" | "appVariant" | "nodeEnv">,
) {
  return [
    config.appOrigin,
    `${appVariants[config.appVariant].urlScheme}://`,
    ...(config.nodeEnv === "development" ? ["exp://"] : []),
  ];
}

function routeLogs(logger: Logger, level: LogLevel): NonNullable<BetterAuthOptions["logger"]> {
  return {
    level,
    disableColors: true,
    log: (logLevel, message, ...args) => {
      const error = args.find((arg) => arg instanceof Error);
      logger[logLevel]("better_auth", {
        authMessage: message,
        ...(error === undefined ? {} : { error }),
      });
    },
  };
}

type Options = BetterAuthOptions;
type EmailAndPassword = NonNullable<Options["emailAndPassword"]>;
type EmailVerification = NonNullable<Options["emailVerification"]>;
interface Table {
  readonly modelName: string;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * The options as {@link buildAuthOptions} returns them: Better Auth's own type, with the parts
 * this module always sets marked as present, so tests and callers need no casts.
 */
export type AuthOptions = Options & {
  readonly appName: string;
  readonly baseURL: string;
  readonly basePath: string;
  readonly secret: string;
  readonly trustedOrigins: string[];
  readonly disabledPaths: string[];
  readonly telemetry: { readonly enabled: false };
  readonly logger: NonNullable<Options["logger"]>;
  readonly database: {
    readonly db: Kysely<DB>;
    readonly type: "postgres";
    readonly transaction: true;
  };
  readonly user: NonNullable<Options["user"]> & Table;
  readonly session: NonNullable<Options["session"]> & Table;
  readonly account: NonNullable<Options["account"]> & Table;
  readonly verification: NonNullable<Options["verification"]> & Table;
  readonly emailAndPassword: EmailAndPassword &
    Required<Pick<EmailAndPassword, "sendResetPassword">>;
  readonly emailVerification: EmailVerification &
    Required<Pick<EmailVerification, "sendVerificationEmail">>;
  readonly rateLimit: NonNullable<Options["rateLimit"]> & Table;
  readonly advanced: NonNullable<Options["advanced"]> & {
    readonly cookiePrefix: string;
    readonly useSecureCookies: boolean;
    readonly defaultCookieAttributes: {
      readonly httpOnly: true;
      readonly sameSite: "lax";
      readonly secure: boolean;
      readonly path: "/";
    };
    readonly database: { readonly generateId: "uuid" };
    readonly ipAddress: { readonly ipAddressHeaders: string[] };
    readonly disableOriginCheck: false;
    readonly disableCSRFCheck: false;
  };
  readonly plugins: BetterAuthPlugin[];
};

/**
 * Builds the Better Auth options: `ba_*` tables with snake_case columns and UUID ids, email and
 * password with required verification, database-backed rate limits, cookies derived from
 * `APP_URL`, and the `expo`, `admin` and `passkey` plugins.
 */
export function buildAuthOptions(
  config: AuthOptionsConfig,
  dependencies: AuthOptionsDependencies,
): AuthOptions {
  const { emailSender } = dependencies;
  const origin = new URL(config.appOrigin);
  const secure = origin.protocol === "https:";
  return {
    appName: config.appName,
    baseURL: config.appOrigin,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    trustedOrigins: trustedOrigins(config),
    disabledPaths: [...DISABLED_AUTH_PATHS],
    telemetry: { enabled: false },
    logger: routeLogs(dependencies.logger, config.logLevel),
    // The Kysely adapter over the server's own pool. Better Auth 1.7.25 ignores a `casing`
    // option, so every column is mapped explicitly in AUTH_TABLES instead.
    database: { db: dependencies.db, type: "postgres", transaction: true },
    user: AUTH_TABLES.user,
    session: AUTH_TABLES.session,
    account: AUTH_TABLES.account,
    verification: AUTH_TABLES.verification,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: AUTH_EMAIL_LINK_SECONDS,
      // Better Auth's own `url` is replaced by a link to the web app's page.
      sendResetPassword: async ({ user, token }) => {
        await emailSender.sendPasswordResetEmail({
          to: user.email,
          url: authEmailLink(config.appOrigin, RESET_PASSWORD_PAGE, token),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in before verifying sends a fresh link, since the first may have expired.
      sendOnSignIn: true,
      expiresIn: AUTH_EMAIL_LINK_SECONDS,
      sendVerificationEmail: async ({ user, token }) => {
        await emailSender.sendVerificationEmail({
          to: user.email,
          url: authEmailLink(config.appOrigin, VERIFY_EMAIL_PAGE, token),
        });
      },
    },
    // Stored in the database: with more than one server instance, a memory store would give
    // each instance its own count.
    rateLimit: {
      enabled: true,
      storage: "database",
      ...AUTH_TABLES.rateLimit,
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure, path: "/" },
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      // Better Auth turns both checks off when NODE_ENV is test. They stay on everywhere, so a
      // server's protection never depends on NODE_ENV, and the live tests exercise them.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    plugins: [
      expo(),
      admin({ defaultRole: "user", adminRoles: ["admin"], schema: AUTH_TABLES.admin }),
      passkey({
        rpID: origin.hostname,
        rpName: config.appName,
        origin: config.appOrigin,
        schema: { passkey: AUTH_TABLES.passkey },
      }),
    ],
  };
}
