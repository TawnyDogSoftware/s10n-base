import { readFileSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

import { Config, ConfigProvider, Effect, Exit, Option, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import {
  EXAMPLE_AUTH_SECRET,
  LOCAL_SES_CREDENTIALS,
  ServerConfigError,
  APP_VERSION_PATTERN,
  databaseConfigFromEnv,
  databaseVariables,
  loadServerConfig,
  migrationConfigFromEnv,
  migrationVariables,
  serverConfigFromEnv,
  serverVariables,
} from "./index";
import serverPackage from "../../package.json" with { type: "json" };

const DATABASE_URL = "postgres://app:s3cret-password@db.internal:5432/app";

const AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
const AWS_SECRET = "aws-secret-access-key-for-tests";

const valid = {
  APP_URL: "http://localhost:5173",
  DATABASE_URL,
  BETTER_AUTH_SECRET: AUTH_SECRET,
  EMAIL_FROM: "no-reply@example.com",
  SUPPORT_EMAIL: "support@example.com",
  SES_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_SECRET_ACCESS_KEY: AWS_SECRET,
};

/** Production with every production rule satisfied. */
const production = {
  ...valid,
  NODE_ENV: "production",
  APP_URL: "https://app.example.com",
  APP_VARIANT: "production",
};

const REQUIRED = [
  "APP_URL",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "EMAIL_FROM",
  "SUPPORT_EMAIL",
  "SES_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

function load(env: Record<string, string | undefined>) {
  return Effect.runSync(serverConfigFromEnv(env));
}

function problems(env: Record<string, string | undefined>) {
  const exit = Effect.runSyncExit(serverConfigFromEnv(env));
  if (Exit.isSuccess(exit)) throw new Error("expected the config to be rejected");
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
  if (!(error instanceof ServerConfigError)) throw new Error("expected a ServerConfigError");
  return error;
}

function problemFor(env: Record<string, string | undefined>, variable: string) {
  return problems(env).problems.find((problem) => problem.variable === variable)?.problem;
}

describe("server config", () => {
  it("applies the defaults", () => {
    const config = load(valid);

    expect(config).toMatchObject({
      nodeEnv: "development",
      appOrigin: "http://localhost:5173",
      host: "0.0.0.0",
      port: 4210,
      databasePoolMax: 10,
      trustedProxyHops: 0,
      requestBodyLimitBytes: 1_048_576,
      shutdownTimeoutMs: 10_000,
      logLevel: "info",
    });
    expect(Redacted.value(config.databaseUrl)).toBe(DATABASE_URL);
    expect(config.webDistDir).toMatch(/apps[/\\]web[/\\]dist$/);
  });

  it("reads every variable", () => {
    const config = load({
      ...production,
      HOST: "127.0.0.1",
      PORT: "8080",
      DATABASE_URL: "postgresql://app@db/app",
      DATABASE_POOL_MAX: "25",
      TRUSTED_PROXY_HOPS: "2",
      REQUEST_BODY_LIMIT_BYTES: "2048",
      SHUTDOWN_TIMEOUT_MS: "1000",
      LOG_LEVEL: "debug",
    });

    expect(config).toMatchObject({
      nodeEnv: "production",
      appOrigin: "https://app.example.com",
      host: "127.0.0.1",
      port: 8080,
      databasePoolMax: 25,
      trustedProxyHops: 2,
      requestBodyLimitBytes: 2048,
      shutdownTimeoutMs: 1000,
      logLevel: "debug",
    });
  });

  it("treats an empty variable as unset", () => {
    expect(load({ ...valid, PORT: "", LOG_LEVEL: "" })).toMatchObject({
      port: 4210,
      logLevel: "info",
    });
  });

  it("requires the variables with no default", () => {
    const error = problems({});

    expect(error.problems.map((problem) => problem.variable)).toEqual(REQUIRED);
    for (const variable of REQUIRED) expect(problemFor({}, variable)).toMatch(/^is required/);
  });

  it.each([
    ["NODE_ENV", "staging"],
    ["APP_URL", "localhost:5173"],
    ["APP_URL", "ftp://localhost"],
    ["APP_URL", "http://localhost:5173/app"],
    ["APP_URL", "http://localhost:5173?x=1"],
    ["APP_URL", "http://localhost:5173/#x"],
    ["APP_URL", "http://user:pass@localhost:5173"],
    ["HOST", " "],
    ["PORT", "65536"],
    ["PORT", "-1"],
    ["PORT", "80.5"],
    ["PORT", "http"],
    ["DATABASE_URL", "mysql://localhost/app"],
    ["DATABASE_URL", "not a url"],
    ["DATABASE_POOL_MAX", "0"],
    ["DATABASE_POOL_MAX", "101"],
    ["TRUSTED_PROXY_HOPS", "-1"],
    ["TRUSTED_PROXY_HOPS", "11"],
    ["REQUEST_BODY_LIMIT_BYTES", "1023"],
    ["SHUTDOWN_TIMEOUT_MS", "999"],
    ["SHUTDOWN_TIMEOUT_MS", "60001"],
    ["LOG_LEVEL", "trace"],
    ["BETTER_AUTH_SECRET", "too-short-31-characters-xxxxxxx"],
    ["APP_VARIANT", "staging"],
    ["EMAIL_FROM", "no-reply"],
    ["EMAIL_FROM", "No Reply <no-reply@example.com>"],
    ["SUPPORT_EMAIL", "support@"],
    ["SES_REGION", "us east 1"],
    ["SES_REGION", "US-EAST-1"],
    ["SES_ENDPOINT", "http://ses.example.com:8005"],
    ["SES_ENDPOINT", "https://192.0.2.5:8005"],
    ["SES_ENDPOINT", "http://127.0.0.1:8005/v2"],
    ["SES_ENDPOINT", "ftp://127.0.0.1:8005"],
    ["AWS_ACCESS_KEY_ID", "has space"],
  ])("rejects %s=%j", (variable, value) => {
    const problem = problemFor({ ...valid, [variable]: value }, variable);

    expect(problem).toMatch(/^must /);
  });

  it.each([
    ["PORT", "0"],
    ["PORT", "65535"],
    ["DATABASE_POOL_MAX", "1"],
    ["DATABASE_POOL_MAX", "100"],
    ["TRUSTED_PROXY_HOPS", "10"],
    ["REQUEST_BODY_LIMIT_BYTES", "1024"],
    ["SHUTDOWN_TIMEOUT_MS", "60000"],
    ["APP_URL", "http://localhost:5173/"],
    ["APP_URL", "http://[::1]:5173"],
    ["BETTER_AUTH_SECRET", "x".repeat(32)],
    ["APP_VARIANT", "preview"],
    ["SES_REGION", "ap-southeast-2"],
    ["SES_REGION", "us-gov-west-1"],
    ["SES_ENDPOINT", "http://127.0.0.1:8005"],
    ["SES_ENDPOINT", "http://localhost:8005"],
    ["SES_ENDPOINT", "http://[::1]:8005"],
    ["AWS_SESSION_TOKEN", "token"],
  ])("accepts %s=%j", (variable, value) => {
    expect(() => load({ ...valid, [variable]: value })).not.toThrow();
  });

  it("reports every problem at once, in variable order, in one message", () => {
    const error = problems({
      ...valid,
      APP_URL: undefined,
      DATABASE_URL: undefined,
      NODE_ENV: "staging",
      PORT: "x",
      LOG_LEVEL: "loud",
    });

    expect(error.problems.map((problem) => problem.variable)).toEqual([
      "NODE_ENV",
      "APP_URL",
      "PORT",
      "DATABASE_URL",
      "LOG_LEVEL",
    ]);
    const lines = error.message.split("\n");
    expect(lines[0]).toBe("Invalid configuration (5 problems):");
    expect(lines.slice(1)).toEqual(
      error.problems.map((problem) => `- ${problem.variable} ${problem.problem}`),
    );
  });

  it("requires https for APP_URL in production only", () => {
    expect(problemFor({ ...production, APP_URL: "http://app.example.com" }, "APP_URL")).toBe(
      "must use https when NODE_ENV is production",
    );
    expect(() => load({ ...valid, NODE_ENV: "test" })).not.toThrow();
  });

  it("reports the production https rule together with other problems", () => {
    const error = problems({
      ...production,
      APP_URL: "http://app.example.com",
      PORT: "x",
    });

    expect(error.problems).toEqual([
      { variable: "APP_URL", problem: "must use https when NODE_ENV is production" },
      { variable: "PORT", problem: "must be an integer from 0 to 65535" },
    ]);
  });

  it("never prints a value of DATABASE_URL", () => {
    const secret = "postgres://app:s3cret-password@db:5432/app?sslmode=verify";
    const invalid = "mysql://app:s3cret-password@db/app";

    const fromInvalid = problems({ ...valid, DATABASE_URL: invalid, PORT: "x" });
    const fromValid = problems({ ...valid, DATABASE_URL: secret, PORT: "x" });

    for (const error of [fromInvalid, fromValid]) {
      expect(error.message).not.toContain("s3cret-password");
      expect(JSON.stringify(error)).not.toContain("s3cret-password");
      expect(String(error)).not.toContain("s3cret-password");
    }
    const databaseUrl = load({ ...valid, DATABASE_URL: secret }).databaseUrl;
    expect(JSON.stringify(databaseUrl)).not.toContain("s3cret");
    expect(inspect(databaseUrl)).not.toContain("s3cret");
    expect(Redacted.value(databaseUrl)).toContain("s3cret");
  });

  it("reads the current ConfigProvider through Effect Config", () => {
    const provider = ConfigProvider.fromUnknown({ ...valid, PORT: "5000" });

    const config = Effect.runSync(
      loadServerConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
    );

    expect(config.port).toBe(5000);
  });

  it("describes each variable with an Effect Config", () => {
    expect(serverVariables.map((variable) => variable.name)).toEqual([
      "NODE_ENV",
      "APP_URL",
      "HOST",
      "PORT",
      "DATABASE_URL",
      "DATABASE_POOL_MAX",
      "TRUSTED_PROXY_HOPS",
      "REQUEST_BODY_LIMIT_BYTES",
      "SHUTDOWN_TIMEOUT_MS",
      "LOG_LEVEL",
      "BETTER_AUTH_SECRET",
      "APP_VARIANT",
      "EMAIL_FROM",
      "SUPPORT_EMAIL",
      "SES_REGION",
      "SES_ENDPOINT",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "APP_VERSION",
    ]);
    for (const variable of serverVariables) {
      expect(Config.isConfig(variable.config)).toBe(true);
    }
  });
});

describe("auth and email config", () => {
  it("reads the auth and email variables", () => {
    const config = load({
      ...valid,
      APP_VARIANT: "preview",
      SES_ENDPOINT: "http://127.0.0.1:8005",
      AWS_SESSION_TOKEN: "session-token",
    });

    expect(config.appVariant).toBe("preview");
    expect(Redacted.value(config.auth.secret)).toBe(AUTH_SECRET);
    expect(config.email.from).toBe("no-reply@example.com");
    expect(config.email.supportEmail).toBe("support@example.com");
    expect(config.email.ses.region).toBe("us-east-1");
    expect(config.email.ses.endpoint).toBe("http://127.0.0.1:8005");
    expect(config.email.ses.credentials.accessKeyId).toBe("AKIDEXAMPLE");
    expect(Redacted.value(config.email.ses.credentials.secretAccessKey)).toBe(AWS_SECRET);
    expect(
      config.email.ses.credentials.sessionToken &&
        Redacted.value(config.email.ses.credentials.sessionToken),
    ).toBe("session-token");
  });

  it("defaults APP_VARIANT to development and leaves SES_ENDPOINT and the token unset", () => {
    const config = load(valid);

    expect(config.appVariant).toBe("development");
    expect(config.email.ses.endpoint).toBeUndefined();
    expect(config.email.ses.credentials.sessionToken).toBeUndefined();
  });

  it("accepts a production config that meets every production rule", () => {
    expect(load(production).appVariant).toBe("production");
  });

  it("requires APP_VARIANT to be set explicitly in production", () => {
    expect(problemFor({ ...production, APP_VARIANT: undefined }, "APP_VARIANT")).toBe(
      "is required when NODE_ENV is production: it must be development, preview or production",
    );
  });

  it("refuses the example secret, a local SES endpoint and the placeholder keys in production, naming each", () => {
    const error = problems({
      ...production,
      BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
      SES_ENDPOINT: "http://127.0.0.1:8005",
      AWS_ACCESS_KEY_ID: LOCAL_SES_CREDENTIALS.accessKeyId,
      AWS_SECRET_ACCESS_KEY: LOCAL_SES_CREDENTIALS.secretAccessKey,
    });

    expect(error.problems).toEqual([
      {
        variable: "BETTER_AUTH_SECRET",
        problem: "must not be the example value from .env.example when NODE_ENV is production",
      },
      { variable: "SES_ENDPOINT", problem: "must not be set when NODE_ENV is production" },
      {
        variable: "AWS_ACCESS_KEY_ID",
        problem: "must not be the local placeholder when NODE_ENV is production",
      },
      {
        variable: "AWS_SECRET_ACCESS_KEY",
        problem: "must not be the local placeholder when NODE_ENV is production",
      },
    ]);
  });

  it("refuses a non-loopback SES_ENDPOINT in production too, with the production rule", () => {
    expect(
      problemFor({ ...production, SES_ENDPOINT: "https://ses.example.com" }, "SES_ENDPOINT"),
    ).toBe("must not be set when NODE_ENV is production");
  });

  it("allows the example secret and the placeholders outside production", () => {
    expect(() =>
      load({
        ...valid,
        BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
        AWS_ACCESS_KEY_ID: "local",
        AWS_SECRET_ACCESS_KEY: "local",
        SES_ENDPOINT: "http://127.0.0.1:8005",
      }),
    ).not.toThrow();
  });

  it("never prints the auth secret, the AWS secret key or the session token", () => {
    const secrets = {
      BETTER_AUTH_SECRET: "short-secret-value",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value-9",
      AWS_SESSION_TOKEN: "session-token-value",
    };
    const error = problems({ ...valid, ...secrets, PORT: "x" });
    const loaded = load({ ...valid, AWS_SESSION_TOKEN: "session-token-value" });

    for (const text of [
      error.message,
      JSON.stringify(error),
      String(error),
      JSON.stringify(loaded),
    ]) {
      for (const value of [...Object.values(secrets), AUTH_SECRET, AWS_SECRET]) {
        expect(text).not.toContain(value);
      }
    }
  });

  it("matches the example secret in .env.example, which is long enough to pass outside production", () => {
    const example = readFileSync(
      path.join(import.meta.dirname, "../../../../.env.example"),
      "utf8",
    );

    expect(example).toContain(`\nBETTER_AUTH_SECRET=${EXAMPLE_AUTH_SECRET}\n`);
    expect(example).toContain(`\nAWS_ACCESS_KEY_ID=${LOCAL_SES_CREDENTIALS.accessKeyId}\n`);
    expect(example).toContain(`\nAWS_SECRET_ACCESS_KEY=${LOCAL_SES_CREDENTIALS.secretAccessKey}\n`);
    expect(EXAMPLE_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe("database config", () => {
  it("needs only NODE_ENV, DATABASE_URL and LOG_LEVEL", () => {
    const config = Effect.runSync(databaseConfigFromEnv({ DATABASE_URL }));

    expect(config.nodeEnv).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(Redacted.value(config.databaseUrl)).toBe(DATABASE_URL);
  });

  it("reports its problems together", () => {
    const exit = Effect.runSyncExit(databaseConfigFromEnv({ NODE_ENV: "x" }));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("NODE_ENV");
    expect(String(exit)).toContain("DATABASE_URL");
  });
});

describe("APP_VERSION", () => {
  it("is the version /config reports when set, and the package version otherwise", () => {
    expect(load({ ...valid, APP_VERSION: "2026.11.19-abc1234" }).version).toBe(
      "2026.11.19-abc1234",
    );
    expect(load(valid).version).toBe(serverPackage.version);
  });

  it.each(["1.0 beta", "-leading-dash", "../etc", "$(id)", "v1;rm", "a".repeat(129), "naïve"])(
    "refuses %j",
    (value) => {
      expect(problemFor({ ...valid, APP_VERSION: value }, "APP_VERSION")).toMatch(
        /^must be 1 to 128/,
      );
    },
  );

  it("accepts 128 characters of the allowed set", () => {
    const value = `A${"a1._+-".repeat(21)}b`;

    expect(value).toHaveLength(128);
    expect(load({ ...valid, APP_VERSION: value }).version).toBe(value);
    expect(APP_VERSION_PATTERN.test(value)).toBe(true);
  });
});

function migrationProblems(env: Record<string, string | undefined>) {
  const exit = Effect.runSyncExit(migrationConfigFromEnv(env));
  if (Exit.isSuccess(exit)) throw new Error("expected the config to be rejected");
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
  if (!(error instanceof ServerConfigError)) throw new Error("expected a ServerConfigError");
  return error.problems;
}

describe("migration config", () => {
  const OWNER_URL = "postgres://owner:owner-password@db.internal:5432/app";

  it("connects with DATABASE_URL when MIGRATION_DATABASE_URL is unset, with no app role", () => {
    const config = Effect.runSync(migrationConfigFromEnv({ DATABASE_URL }));

    expect(Redacted.value(config.databaseUrl)).toBe(DATABASE_URL);
    expect(config).toMatchObject({ nodeEnv: "development", logLevel: "info", appRole: undefined });
  });

  it("connects with MIGRATION_DATABASE_URL when it is set", () => {
    const config = Effect.runSync(
      migrationConfigFromEnv({ DATABASE_URL, MIGRATION_DATABASE_URL: OWNER_URL }),
    );

    expect(Redacted.value(config.databaseUrl)).toBe(OWNER_URL);
  });

  it("needs no DATABASE_URL when MIGRATION_DATABASE_URL is set", () => {
    const config = Effect.runSync(migrationConfigFromEnv({ MIGRATION_DATABASE_URL: OWNER_URL }));

    expect(Redacted.value(config.databaseUrl)).toBe(OWNER_URL);
  });

  it("requires one of the two URLs", () => {
    expect(migrationProblems({})).toEqual([
      {
        variable: "DATABASE_URL",
        problem:
          "is required: it must be a postgres:// or postgresql:// URL; required when MIGRATION_DATABASE_URL is unset",
      },
    ]);
  });

  it("reads DATABASE_APP_ROLE", () => {
    const config = Effect.runSync(
      migrationConfigFromEnv({ DATABASE_URL, DATABASE_APP_ROLE: "app_runtime_2" }),
    );

    expect(config.appRole).toBe("app_runtime_2");
  });

  it.each(["App", "app-role", "1app", 'app"; drop table x; --', "a".repeat(64), "app role"])(
    "refuses the role name %j",
    (role) => {
      const found = migrationProblems({ DATABASE_URL, DATABASE_APP_ROLE: role });

      expect(found.map((problem) => problem.variable)).toEqual(["DATABASE_APP_ROLE"]);
      expect(found[0]?.problem).toMatch(/^must be a role name/);
    },
  );

  it("reports a missing URL together with an invalid role", () => {
    expect(
      migrationProblems({ DATABASE_APP_ROLE: "Bad" }).map((problem) => problem.variable),
    ).toEqual(["DATABASE_URL", "DATABASE_APP_ROLE"]);
  });

  it("reports every problem together, in variable order, and never a URL", () => {
    const found = migrationProblems({
      NODE_ENV: "staging",
      MIGRATION_DATABASE_URL: "mysql://owner:owner-password@db/app",
      DATABASE_APP_ROLE: "Bad",
    });

    expect(found.map((problem) => problem.variable)).toEqual([
      "NODE_ENV",
      "MIGRATION_DATABASE_URL",
      "DATABASE_APP_ROLE",
    ]);
    expect(JSON.stringify(found)).not.toContain("owner-password");
  });
});

interface Documented {
  readonly name: string;
  readonly config: Config.Config<unknown>;
  readonly defaultText?: string;
  readonly optional?: true;
}

/** What the docs say about a variable left unset. */
function documented(entry: Documented): string {
  // Any default of an optional variable (APP_VARIANT's) is applied by the config, and tested
  // with it ("defaults APP_VARIANT to development").
  if (entry.optional === true) return "unset";
  if (entry.defaultText !== undefined) return `default ${entry.defaultText}`;
  return "required";
}

/** What the variable's Config does when it is unset. */
function parsedWhenUnset(entry: Documented): string {
  const result = Effect.runSync(
    Effect.result(entry.config.parse(ConfigProvider.fromEnvRecord({}))),
  );
  if (result._tag === "Failure") return "required";
  const value = result.success;
  return Option.isOption(value) && Option.isNone(value) ? "unset" : `default ${String(value)}`;
}

describe("the documented requirement and default of every variable", () => {
  const all: ReadonlyArray<Documented> = [
    ...serverVariables,
    ...migrationVariables,
    ...databaseVariables,
  ];

  it.each(all.map((entry) => [entry.name, entry] as const))("%s", (_name, entry) => {
    expect(parsedWhenUnset(entry)).toBe(documented(entry));
  });
});
