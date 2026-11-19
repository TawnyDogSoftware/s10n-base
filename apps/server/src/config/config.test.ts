import { Config, ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import {
  ServerConfigError,
  databaseConfigFromEnv,
  loadServerConfig,
  serverConfigFromEnv,
  serverVariables,
} from "./index";

const DATABASE_URL = "postgres://app:s3cret-password@db.internal:5432/app";

const valid = {
  APP_URL: "http://localhost:5173",
  DATABASE_URL,
};

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
      NODE_ENV: "production",
      APP_URL: "https://app.example.com",
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

  it("requires APP_URL and DATABASE_URL", () => {
    const error = problems({});

    expect(error.problems.map((problem) => problem.variable)).toEqual(["APP_URL", "DATABASE_URL"]);
    expect(problemFor({}, "APP_URL")).toMatch(/^is required/);
    expect(problemFor({}, "DATABASE_URL")).toMatch(/^is required/);
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
  ])("accepts %s=%j", (variable, value) => {
    expect(() => load({ ...valid, [variable]: value })).not.toThrow();
  });

  it("reports every problem at once, in variable order, in one message", () => {
    const error = problems({ NODE_ENV: "staging", PORT: "x", LOG_LEVEL: "loud" });

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
    expect(problemFor({ ...valid, NODE_ENV: "production" }, "APP_URL")).toBe(
      "must use https when NODE_ENV is production",
    );
    expect(() => load({ ...valid, NODE_ENV: "test" })).not.toThrow();
  });

  it("reports the production https rule together with other problems", () => {
    const error = problems({ ...valid, NODE_ENV: "production", PORT: "x" });

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
    expect(String(load({ ...valid, DATABASE_URL: secret }).databaseUrl)).not.toContain("s3cret");
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
    ]);
    for (const variable of serverVariables) {
      expect(Config.isConfig(variable.config)).toBe(true);
    }
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
