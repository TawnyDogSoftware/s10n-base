import { Kysely, PostgresDialect } from "kysely";

import type { DB } from "../infra/postgres/generated/db";
import { createLogger } from "../observability/logger";
import type { AuthEmailSender } from "../auth/email/sender";
import { buildAuthOptions, type AuthOptions, type AuthOptionsConfig } from "../auth/options";

/** A Kysely instance that fails if anything tries to use it. */
export function unusedDb(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: { connect: () => Promise.reject(new Error("no database in unit tests")) } as never,
    }),
  });
}

const TEST_AUTH_CONFIG: AuthOptionsConfig = {
  appName: "S10N Base",
  appOrigin: "http://localhost:5173",
  nodeEnv: "test",
  appVariant: "development",
  secret: "a-test-secret-that-is-at-least-32-characters",
  logLevel: "error",
};

const noEmail: AuthEmailSender = {
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
};

/** Auth options for unit tests: no database, no email, no log output. */
export function testAuthOptions(overrides: Partial<AuthOptionsConfig> = {}): AuthOptions {
  return buildAuthOptions(
    { ...TEST_AUTH_CONFIG, ...overrides },
    {
      db: unusedDb(),
      emailSender: noEmail,
      logger: createLogger({ level: "error", write: () => {} }),
    },
  );
}
