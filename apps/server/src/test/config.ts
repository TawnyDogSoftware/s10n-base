import os from "node:os";
import path from "node:path";

import { Redacted } from "effect";

import { LOCAL_SES_CREDENTIALS, type ServerConfig } from "../config";

/** A complete, valid config for tests, with no web build and a database that is not there. */
export function testServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    appName: "S10N Base",
    version: "0.0.0",
    nodeEnv: "test",
    appOrigin: "http://localhost:5173",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: Redacted.make("postgres://u:p@127.0.0.1:9/db"),
    databasePoolMax: 1,
    trustedProxyHops: 0,
    requestBodyLimitBytes: 1024,
    shutdownTimeoutMs: 2000,
    logLevel: "debug",
    webDistDir: path.join(os.tmpdir(), "s10n-no-web-build"),
    appVariant: "development",
    auth: { secret: Redacted.make("a-test-secret-that-is-at-least-32-characters") },
    email: {
      from: "no-reply@example.com",
      supportEmail: "support@example.com",
      ses: {
        region: "us-east-1",
        endpoint: "http://127.0.0.1:9",
        credentials: {
          accessKeyId: LOCAL_SES_CREDENTIALS.accessKeyId,
          secretAccessKey: Redacted.make(LOCAL_SES_CREDENTIALS.secretAccessKey),
          sessionToken: undefined,
        },
      },
    },
    ...overrides,
  };
}
