/**
 * Server configuration, read from environment variables once at startup.
 *
 * Each variable is an Effect `Config`. Effect 4.1's `Config.all` and `Config.schema` stop at the
 * first invalid variable, so this module parses every variable on its own and collects the
 * failures, then reports them together in one {@link ServerConfigError}. Problems are described
 * by fixed rule text, never by Effect's messages, which can quote the value: a value of
 * `DATABASE_URL` holds a password and must never reach a log.
 */
import path from "node:path";

import { Config, ConfigProvider, Data, Effect, Option, Redacted, Schema } from "effect";

import serverPackage from "../../package.json" with { type: "json" };

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Everything the server reads from its environment, validated. */
export interface ServerConfig {
  readonly appName: string;
  readonly version: string;
  readonly nodeEnv: NodeEnv;
  /** The single public origin users see (`APP_URL`), without a trailing slash. */
  readonly appOrigin: string;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: Redacted.Redacted<string>;
  readonly databasePoolMax: number;
  readonly trustedProxyHops: number;
  readonly requestBodyLimitBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly logLevel: LogLevel;
  /** The built web app, served from the same origin when it exists. */
  readonly webDistDir: string;
}

/** What the `migrate` entry point needs: no HTTP settings. */
export interface DatabaseConfig {
  readonly nodeEnv: NodeEnv;
  readonly databaseUrl: Redacted.Redacted<string>;
  readonly logLevel: LogLevel;
}

/** One environment variable: its name, the rule it must follow, and how to read it. */
export interface Variable<A> {
  readonly name: string;
  /** Completes "must ...": what a valid value looks like. Never contains a value. */
  readonly rule: string;
  readonly config: Config.Config<A>;
}

export interface ConfigProblem {
  readonly variable: string;
  /** Starts with "is required" or "must". */
  readonly problem: string;
}

/** Every invalid or missing variable, reported at once. Holds no variable's value. */
export class ServerConfigError extends Data.TaggedError("ServerConfigError")<{
  readonly problems: ReadonlyArray<ConfigProblem>;
}> {
  override get message(): string {
    const count = this.problems.length;
    return [
      `Invalid configuration (${count} ${count === 1 ? "problem" : "problems"}):`,
      ...this.problems.map((entry) => `- ${entry.variable} ${entry.problem}`),
    ].join("\n");
  }
}

function integerBetween(minimum: number, maximum: number) {
  return Schema.Int.check(Schema.isBetween({ minimum, maximum }));
}

function integerAtLeast(minimum: number) {
  return Schema.Int.check(Schema.isGreaterThanOrEqualTo(minimum));
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * A bare origin: `http` or `https`, a host and an optional port, and nothing else. `new URL`
 * normalises the path of `http://host` to `/`, so a trailing slash is accepted; any other path,
 * a query, a fragment or credentials are not.
 */
export function isBareOrigin(value: string): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !value.endsWith("?") &&
    !value.endsWith("#")
  );
}

function isPostgresUrl(value: string): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
    url.hostname !== ""
  );
}

const BareOrigin = Schema.String.check(Schema.makeFilter(isBareOrigin));
const PostgresUrl = Schema.String.check(Schema.makeFilter(isPostgresUrl));
const BindAddress = Schema.String.check(Schema.makeFilter((value) => /^\S+$/.test(value)));

function variable<A>(name: string, rule: string, config: Config.Config<A>): Variable<A> {
  return { name, rule, config };
}

const nodeEnv = variable(
  "NODE_ENV",
  "be development, test or production",
  Config.Literals(NODE_ENVS, "NODE_ENV").pipe(Config.withDefault("development" as const)),
);
const appUrl = variable(
  "APP_URL",
  "be a bare http or https origin such as https://app.example.com (no path, query or credentials)",
  Config.schema(BareOrigin, "APP_URL").pipe(Config.map((value) => new URL(value).origin)),
);
const host = variable(
  "HOST",
  "be a bind address such as 0.0.0.0 or 127.0.0.1",
  Config.schema(BindAddress, "HOST").pipe(Config.withDefault("0.0.0.0")),
);
const port = variable(
  "PORT",
  "be an integer from 0 to 65535",
  Config.schema(integerBetween(0, 65_535), "PORT").pipe(Config.withDefault(4210)),
);
const databaseUrl = variable(
  "DATABASE_URL",
  "be a postgres:// or postgresql:// URL",
  Config.schema(PostgresUrl, "DATABASE_URL").pipe(Config.map((value) => Redacted.make(value))),
);
const databasePoolMax = variable(
  "DATABASE_POOL_MAX",
  "be an integer from 1 to 100",
  Config.schema(integerBetween(1, 100), "DATABASE_POOL_MAX").pipe(Config.withDefault(10)),
);
const trustedProxyHops = variable(
  "TRUSTED_PROXY_HOPS",
  "be an integer from 0 to 10",
  Config.schema(integerBetween(0, 10), "TRUSTED_PROXY_HOPS").pipe(Config.withDefault(0)),
);
const requestBodyLimitBytes = variable(
  "REQUEST_BODY_LIMIT_BYTES",
  "be an integer of at least 1024",
  Config.schema(integerAtLeast(1024), "REQUEST_BODY_LIMIT_BYTES").pipe(
    Config.withDefault(1_048_576),
  ),
);
const shutdownTimeoutMs = variable(
  "SHUTDOWN_TIMEOUT_MS",
  "be an integer from 1000 to 60000",
  Config.schema(integerBetween(1000, 60_000), "SHUTDOWN_TIMEOUT_MS").pipe(
    Config.withDefault(10_000),
  ),
);
const logLevel = variable(
  "LOG_LEVEL",
  "be debug, info, warn or error",
  Config.Literals(LOG_LEVELS, "LOG_LEVEL").pipe(Config.withDefault("info" as const)),
);

/** The server's variables, in the order problems are reported. */
export const serverVariables = [
  nodeEnv,
  appUrl,
  host,
  port,
  databaseUrl,
  databasePoolMax,
  trustedProxyHops,
  requestBodyLimitBytes,
  shutdownTimeoutMs,
  logLevel,
] as const;

type Values<T extends ReadonlyArray<Variable<unknown>>> = {
  -readonly [K in keyof T]: T[K] extends Variable<infer A> ? A : never;
};

/**
 * Parses each variable against `provider`, so one failure does not hide the next. Returns the
 * values in order, or every problem.
 */
function parseAll<const T extends ReadonlyArray<Variable<unknown>>>(
  variables: T,
  provider: ConfigProvider.ConfigProvider,
): Effect.Effect<{ readonly values: Values<T> } | { readonly problems: Array<ConfigProblem> }> {
  return Effect.gen(function* () {
    const values: Array<unknown> = [];
    const problems: Array<ConfigProblem> = [];
    for (const entry of variables) {
      const result = yield* Effect.result(entry.config.parse(provider));
      if (result._tag === "Success") {
        values.push(result.success);
        continue;
      }
      const raw = yield* Effect.orElseSucceed(
        Config.option(Config.String(entry.name)).parse(provider),
        () => Option.none<string>(),
      );
      problems.push({
        variable: entry.name,
        problem: Option.isNone(raw) ? `is required: it must ${entry.rule}` : `must ${entry.rule}`,
      });
    }
    return problems.length > 0 ? { problems } : { values: values as Values<T> };
  });
}

function webDistDir(): string {
  return path.resolve(import.meta.dirname, "../../../web/dist");
}

/** Reads the server config from the current `ConfigProvider` (the environment by default). */
export const loadServerConfig: Effect.Effect<ServerConfig, ServerConfigError> = Effect.gen(
  function* () {
    const provider = yield* ConfigProvider.ConfigProvider;
    const parsed = yield* parseAll(serverVariables, provider);
    if ("problems" in parsed) {
      return yield* new ServerConfigError({ problems: parsed.problems });
    }
    const [
      nodeEnvValue,
      appOrigin,
      hostValue,
      portValue,
      databaseUrlValue,
      poolMax,
      hops,
      bodyLimit,
      shutdownMs,
      level,
    ] = parsed.values;
    if (nodeEnvValue === "production" && !appOrigin.startsWith("https://")) {
      return yield* new ServerConfigError({
        problems: [{ variable: "APP_URL", problem: "must use https when NODE_ENV is production" }],
      });
    }
    return {
      appName: "S10N Base",
      version: serverPackage.version,
      nodeEnv: nodeEnvValue,
      appOrigin,
      host: hostValue,
      port: portValue,
      databaseUrl: databaseUrlValue,
      databasePoolMax: poolMax,
      trustedProxyHops: hops,
      requestBodyLimitBytes: bodyLimit,
      shutdownTimeoutMs: shutdownMs,
      logLevel: level,
      webDistDir: webDistDir(),
    };
  },
);

/** Reads the `migrate` entry point's config from the current `ConfigProvider`. */
export const loadDatabaseConfig: Effect.Effect<DatabaseConfig, ServerConfigError> = Effect.gen(
  function* () {
    const provider = yield* ConfigProvider.ConfigProvider;
    const parsed = yield* parseAll([nodeEnv, databaseUrl, logLevel] as const, provider);
    if ("problems" in parsed) {
      return yield* new ServerConfigError({ problems: parsed.problems });
    }
    const [nodeEnvValue, databaseUrlValue, level] = parsed.values;
    return { nodeEnv: nodeEnvValue, databaseUrl: databaseUrlValue, logLevel: level };
  },
);

/** A provider over an environment record. Empty values count as unset. */
export function envProvider(
  env: Record<string, string | undefined>,
): ConfigProvider.ConfigProvider {
  return ConfigProvider.fromEnvRecord(env);
}

/** {@link loadServerConfig} over an explicit environment record, such as `process.env`. */
export function serverConfigFromEnv(env: Record<string, string | undefined>) {
  return loadServerConfig.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, envProvider(env)),
  );
}

/** {@link loadDatabaseConfig} over an explicit environment record. */
export function databaseConfigFromEnv(env: Record<string, string | undefined>) {
  return loadDatabaseConfig.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, envProvider(env)),
  );
}
