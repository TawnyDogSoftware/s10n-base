/**
 * The environment the journeys run the server and the capture server with: the local compose
 * database's test database, ports of their own, and one trusted proxy hop, so each journey can
 * give its requests their own client address and stay inside the sign-in rate limit (3 per 10
 * seconds per address), which is on in every environment.
 */
export const E2E_ORIGIN = "http://localhost:4310";
export const E2E_SES = "http://127.0.0.1:8025";

export const E2E_ENV: Record<string, string> = {
  NODE_ENV: "development",
  APP_URL: E2E_ORIGIN,
  HOST: "127.0.0.1",
  PORT: "4310",
  DATABASE_URL: "postgres://s10n_base:s10n_base@127.0.0.1:54320/s10n_base_test",
  TRUSTED_PROXY_HOPS: "1",
  LOG_LEVEL: "warn",
  BETTER_AUTH_SECRET: "development-only-secret-replace-me-in-production",
  APP_VARIANT: "development",
  EMAIL_FROM: "no-reply@example.com",
  SUPPORT_EMAIL: "support@example.com",
  SES_REGION: "us-east-1",
  SES_ENDPOINT: E2E_SES,
  AWS_ACCESS_KEY_ID: "local",
  AWS_SECRET_ACCESS_KEY: "local",
};
