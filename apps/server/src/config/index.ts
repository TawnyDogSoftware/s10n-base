/**
 * Server configuration, read from environment variables once at startup.
 *
 * Each variable is an Effect `Config`. Effect 4.1's `Config.all` and `Config.schema` stop at the
 * first invalid variable, so this module parses every variable on its own and collects the
 * failures, then reports them together in one {@link ServerConfigError}. Problems are described
 * by fixed rule text, never by Effect's messages, which can quote the value: a value of
 * `DATABASE_URL` holds a password and must never reach a log.
 */
import { Config, ConfigProvider, Data, Effect, Option, Redacted, Schema } from "effect";

import { APP_VARIANTS, type AppVariant } from "@s10n-base/shared/app-variants";
import { parseCaptureEndpoint } from "@s10n-base/shared/local-endpoint";
import { parseBareOrigin } from "@s10n-base/shared/origin";

import serverPackage from "../../package.json" with { type: "json" };
import { LOCAL_SES_CREDENTIALS } from "../infra/email/local";
import { WEB_DIST_DIR } from "../paths";

/**
 * The `BETTER_AUTH_SECRET` in `.env.example`. Fine for a laptop; refused in production, where
 * anyone who has read this repo would know it.
 */
export const EXAMPLE_AUTH_SECRET = "development-only-secret-replace-me-in-production";

export { LOCAL_SES_CREDENTIALS };

const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
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
  readonly databaseUrl: Redacted.Redacted;
  readonly databasePoolMax: number;
  readonly trustedProxyHops: number;
  readonly requestBodyLimitBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly logLevel: LogLevel;
  /** The built web app, served from the same origin when it exists. */
  readonly webDistDir: string;
  /** Which mobile app build this server serves; its URL scheme is a trusted origin. */
  readonly appVariant: AppVariant;
  readonly auth: AuthConfig;
  readonly email: EmailConfig;
}

interface AuthConfig {
  /** Signs and encrypts Better Auth's cookies and tokens. At least 32 characters. */
  readonly secret: Redacted.Redacted;
}

interface SesConfig {
  readonly region: string;
  /** A loopback URL that replaces the regional endpoint; never set in production. */
  readonly endpoint: string | undefined;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: Redacted.Redacted;
    readonly sessionToken: Redacted.Redacted | undefined;
  };
}

interface EmailConfig {
  /** The sender address of every email. */
  readonly from: string;
  /** Shown in email footers as the address to write to. */
  readonly supportEmail: string;
  readonly ses: SesConfig;
}

/** What the database command-line tools need: no HTTP settings. */
export interface DatabaseConfig {
  readonly nodeEnv: NodeEnv;
  readonly databaseUrl: Redacted.Redacted;
  readonly logLevel: LogLevel;
}

/** One environment variable: its name, the rule it must follow, and how to read it. */
interface Variable<A> {
  readonly name: string;
  /** Completes "must ...": what a valid value looks like. Never contains a value. */
  readonly rule: string;
  readonly config: Config.Config<A>;
  /** For the environment table in docs/deployment.md: the default, as text. */
  readonly defaultText?: string;
  /** May be left unset: read as an option, with any default applied by the config itself. */
  readonly optional?: true;
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
      `Invalid configuration (${String(count)} ${count === 1 ? "problem" : "problems"}):`,
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
function isBareOrigin(value: string): boolean {
  return parseBareOrigin(value) !== null;
}

function isPostgresUrl(value: string): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
    url.hostname !== ""
  );
}

/** A plain address such as `no-reply@example.com`: no display name, no spaces. */
function isEmailAddress(value: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:.]+(\.[^\s@<>()",;:.]+)+$/.test(value);
}

const BareOrigin = Schema.String.check(Schema.makeFilter(isBareOrigin));
const PostgresUrl = Schema.String.check(Schema.makeFilter(isPostgresUrl));
const BindAddress = Schema.String.check(Schema.makeFilter((value) => /^\S+$/.test(value)));
const NoSpaces = Schema.String.check(Schema.makeFilter((value) => /^\S+$/.test(value)));
const NonEmpty = Schema.String.check(Schema.makeFilter((value) => value.length > 0));
const AuthSecret = Schema.String.check(Schema.makeFilter((value) => value.length >= 32));
const EmailAddress = Schema.String.check(Schema.makeFilter(isEmailAddress));
const AwsRegion = Schema.String.check(
  Schema.makeFilter((value) => /^[a-z]{2}(-[a-z]+)+-\d+$/.test(value)),
);
/** An address the local capture server can listen on, as `bun run ses:local` reads it too. */
const LoopbackOrigin = Schema.String.check(
  Schema.makeFilter((value) => parseCaptureEndpoint(value) !== null),
);
/** The characters a build version may use, so it is safe in a header, a log and an image label. */
export const APP_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;
const AppVersion = Schema.String.check(
  Schema.makeFilter((value) => APP_VERSION_PATTERN.test(value)),
);
/** A role name that needs no quoting rules beyond double quotes: lowercase, at most 63 bytes. */
const RoleName = Schema.String.check(
  Schema.makeFilter((value) => /^[a-z_][a-z0-9_]{0,62}$/.test(value)),
);

interface VariableExtras {
  readonly defaultText?: string;
  readonly optional?: true;
}

function variable<A>(
  name: string,
  rule: string,
  config: Config.Config<A>,
  extras: VariableExtras = {},
): Variable<A> {
  return { name, rule, config, ...extras };
}

const nodeEnv = variable(
  "NODE_ENV",
  "be development, test or production",
  Config.Literals(NODE_ENVS, "NODE_ENV").pipe(Config.withDefault("development" as const)),
  { defaultText: "development" },
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
  { defaultText: "0.0.0.0" },
);
const port = variable(
  "PORT",
  "be an integer from 0 to 65535",
  Config.schema(integerBetween(0, 65_535), "PORT").pipe(Config.withDefault(4210)),
  { defaultText: "4210" },
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
  { defaultText: "10" },
);
const trustedProxyHops = variable(
  "TRUSTED_PROXY_HOPS",
  "be an integer from 0 to 10",
  Config.schema(integerBetween(0, 10), "TRUSTED_PROXY_HOPS").pipe(Config.withDefault(0)),
  { defaultText: "0" },
);
const requestBodyLimitBytes = variable(
  "REQUEST_BODY_LIMIT_BYTES",
  "be an integer of at least 1024",
  Config.schema(integerAtLeast(1024), "REQUEST_BODY_LIMIT_BYTES").pipe(
    Config.withDefault(1_048_576),
  ),
  { defaultText: "1048576" },
);
const shutdownTimeoutMs = variable(
  "SHUTDOWN_TIMEOUT_MS",
  "be an integer from 1000 to 60000",
  Config.schema(integerBetween(1000, 60_000), "SHUTDOWN_TIMEOUT_MS").pipe(
    Config.withDefault(10_000),
  ),
  { defaultText: "10000" },
);
const logLevel = variable(
  "LOG_LEVEL",
  "be debug, info, warn or error",
  Config.Literals(LOG_LEVELS, "LOG_LEVEL").pipe(Config.withDefault("info" as const)),
  { defaultText: "info" },
);

const authSecret = variable(
  "BETTER_AUTH_SECRET",
  "be at least 32 characters; generate one with `openssl rand -base64 32`",
  Config.schema(AuthSecret, "BETTER_AUTH_SECRET").pipe(Config.map((value) => Redacted.make(value))),
);
const appVariant = variable(
  "APP_VARIANT",
  "be development, preview or production",
  Config.option(Config.Literals(APP_VARIANTS, "APP_VARIANT")),
  { optional: true, defaultText: "development" },
);
const emailFrom = variable(
  "EMAIL_FROM",
  "be a plain email address such as no-reply@example.com",
  Config.schema(EmailAddress, "EMAIL_FROM"),
);
const supportEmail = variable(
  "SUPPORT_EMAIL",
  "be a plain email address such as support@example.com",
  Config.schema(EmailAddress, "SUPPORT_EMAIL"),
);
const sesRegion = variable(
  "SES_REGION",
  "be an AWS region name such as us-east-1",
  Config.schema(AwsRegion, "SES_REGION"),
);
const sesEndpoint = variable(
  "SES_ENDPOINT",
  "be a loopback origin such as http://127.0.0.1:8005 (the local capture server), or unset",
  Config.option(Config.schema(LoopbackOrigin, "SES_ENDPOINT")).pipe(
    Config.map((value) => Option.map(value, (origin) => new URL(origin).origin)),
  ),
  { optional: true },
);
const awsAccessKeyId = variable(
  "AWS_ACCESS_KEY_ID",
  "be an AWS access key id with no spaces",
  Config.schema(NoSpaces, "AWS_ACCESS_KEY_ID"),
);
const awsSecretAccessKey = variable(
  "AWS_SECRET_ACCESS_KEY",
  "be an AWS secret access key",
  Config.schema(NonEmpty, "AWS_SECRET_ACCESS_KEY").pipe(
    Config.map((value) => Redacted.make(value)),
  ),
);
const awsSessionToken = variable(
  "AWS_SESSION_TOKEN",
  "be an AWS session token, or unset",
  Config.option(Config.schema(NonEmpty, "AWS_SESSION_TOKEN")).pipe(
    Config.map((value) => Option.map(value, (token) => Redacted.make(token))),
  ),
  { optional: true },
);

const appVersion = variable(
  "APP_VERSION",
  "be 1 to 128 letters, digits, dots, underscores, plus or minus signs, starting with a letter or digit, or unset",
  Config.option(Config.schema(AppVersion, "APP_VERSION")),
  { optional: true },
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
  authSecret,
  appVariant,
  emailFrom,
  supportEmail,
  sesRegion,
  sesEndpoint,
  awsAccessKeyId,
  awsSecretAccessKey,
  awsSessionToken,
  appVersion,
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
      const raw = yield* rawOf(entry.name, provider);
      problems.push({
        variable: entry.name,
        problem: Option.isNone(raw) ? `is required: it must ${entry.rule}` : `must ${entry.rule}`,
      });
    }
    return problems.length > 0 ? { problems } : { values: values as Values<T> };
  });
}

/** The value of `entry` when it is valid, or none. */
function valueOf<A>(
  entry: Variable<A>,
  provider: ConfigProvider.ConfigProvider,
): Effect.Effect<Option.Option<A>> {
  return Effect.result(entry.config.parse(provider)).pipe(
    Effect.map((result) =>
      result._tag === "Success" ? Option.some(result.success) : Option.none(),
    ),
  );
}

/** The raw string of a variable, or none when it is unset or empty. */
function rawOf(
  name: string,
  provider: ConfigProvider.ConfigProvider,
): Effect.Effect<Option.Option<string>> {
  // Reading a variable as plain text fails only if the provider itself breaks, which the
  // environment's never does; that would be a defect, not a missing variable.
  return Effect.orDie(Config.option(Config.String(name)).parse(provider));
}

interface ProductionRule {
  readonly variable: string;
  readonly problem: string;
  /** Whether the rule is broken. A variable that is itself invalid breaks no rule here. */
  readonly broken: (provider: ConfigProvider.ConfigProvider) => Effect.Effect<boolean>;
}

/** Breaks the rule when the variable has a valid value for which `test` holds. */
function whenValid<A>(entry: Variable<A>, test: (value: A) => boolean): ProductionRule["broken"] {
  return (provider) => valueOf(entry, provider).pipe(Effect.map(Option.exists(test)));
}

const PRODUCTION_RULES: ReadonlyArray<ProductionRule> = [
  {
    variable: "APP_URL",
    problem: "must use https when NODE_ENV is production",
    broken: whenValid(appUrl, (origin) => !origin.startsWith("https://")),
  },
  {
    variable: "APP_VARIANT",
    problem: `is required when NODE_ENV is production: it must ${appVariant.rule}`,
    broken: whenValid(appVariant, Option.isNone),
  },
  {
    variable: "BETTER_AUTH_SECRET",
    problem: "must not be the example value from .env.example when NODE_ENV is production",
    broken: whenValid(authSecret, (secret) => Redacted.value(secret) === EXAMPLE_AUTH_SECRET),
  },
  {
    // Any value at all: production always uses the regional AWS endpoint.
    variable: "SES_ENDPOINT",
    problem: "must not be set when NODE_ENV is production",
    broken: (provider) => rawOf("SES_ENDPOINT", provider).pipe(Effect.map(Option.isSome)),
  },
  {
    variable: "AWS_ACCESS_KEY_ID",
    problem: "must not be the local placeholder when NODE_ENV is production",
    broken: whenValid(awsAccessKeyId, (id) => id === LOCAL_SES_CREDENTIALS.accessKeyId),
  },
  {
    variable: "AWS_SECRET_ACCESS_KEY",
    problem: "must not be the local placeholder when NODE_ENV is production",
    broken: whenValid(
      awsSecretAccessKey,
      (key) => Redacted.value(key) === LOCAL_SES_CREDENTIALS.secretAccessKey,
    ),
  },
];

/**
 * Rules that involve more than one variable, which all depend on `NODE_ENV` being production.
 * Each is checked whenever the variables it reads are valid, even if others are not, so every
 * problem is still reported at once. None of them ever quotes a value.
 */
function crossVariableProblems(
  provider: ConfigProvider.ConfigProvider,
): Effect.Effect<Array<ConfigProblem>> {
  return Effect.gen(function* () {
    const env = yield* valueOf(nodeEnv, provider);
    if (Option.getOrUndefined(env) !== "production") return [];
    const broken = yield* Effect.filter(PRODUCTION_RULES, (rule) => rule.broken(provider));
    return broken.map((rule) => ({ variable: rule.variable, problem: rule.problem }));
  });
}

/** Each production rule's variable and problem, for the environment table in the docs. */
export const productionRules: ReadonlyArray<ConfigProblem> = PRODUCTION_RULES.map((rule) => ({
  variable: rule.variable,
  problem: rule.problem,
}));

function inVariableOrder(
  problems: Array<ConfigProblem>,
  variables: ReadonlyArray<Variable<unknown>> = serverVariables,
): Array<ConfigProblem> {
  const order = variables.map((entry) => entry.name);
  // A stable sort: problems with one variable keep the order they were found in.
  return problems.toSorted((a, b) => order.indexOf(a.variable) - order.indexOf(b.variable));
}

/** Reads the server config from the current `ConfigProvider` (the environment by default). */
export const loadServerConfig: Effect.Effect<ServerConfig, ServerConfigError> = Effect.gen(
  function* () {
    const provider = yield* ConfigProvider.ConfigProvider;
    const parsed = yield* parseAll(serverVariables, provider);
    const crossProblems = yield* crossVariableProblems(provider);
    // A production rule about a variable replaces that variable's own problem: in production
    // any SES_ENDPOINT is wrong, whether or not it is a loopback URL.
    const ruled = new Set(crossProblems.map((problem) => problem.variable));
    const problems = [
      ...("problems" in parsed ? parsed.problems : []).filter(
        (problem) => !ruled.has(problem.variable),
      ),
      ...crossProblems,
    ];
    if (problems.length > 0 || "problems" in parsed) {
      return yield* new ServerConfigError({ problems: inVariableOrder(problems) });
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
      secret,
      variant,
      from,
      support,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      buildVersion,
    ] = parsed.values;
    return {
      appName: "S10N Base",
      version: Option.getOrElse(buildVersion, () => serverPackage.version),
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
      webDistDir: WEB_DIST_DIR,
      appVariant: Option.getOrElse(variant, () => "development" as const),
      auth: { secret },
      email: {
        from,
        supportEmail: support,
        ses: {
          region,
          endpoint: Option.getOrUndefined(endpoint),
          credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken: Option.getOrUndefined(sessionToken),
          },
        },
      },
    };
  },
);

/** The variables `set-role` reads. */
export const databaseVariables = [nodeEnv, databaseUrl, logLevel] as const;

/** Reads the database config, for `set-role`, from the current `ConfigProvider`. */
const loadDatabaseConfig: Effect.Effect<DatabaseConfig, ServerConfigError> = Effect.gen(
  function* () {
    const provider = yield* ConfigProvider.ConfigProvider;
    const parsed = yield* parseAll(databaseVariables, provider);
    if ("problems" in parsed) {
      return yield* new ServerConfigError({ problems: parsed.problems });
    }
    const [nodeEnvValue, databaseUrlValue, level] = parsed.values;
    return { nodeEnv: nodeEnvValue, databaseUrl: databaseUrlValue, logLevel: level };
  },
);

const POSTGRES_URL_RULE = "be a postgres:// or postgresql:// URL";

const migrationDatabaseUrl = variable(
  "MIGRATION_DATABASE_URL",
  `${POSTGRES_URL_RULE} for the role that owns the schema, or unset to use DATABASE_URL`,
  Config.option(Config.schema(PostgresUrl, "MIGRATION_DATABASE_URL")).pipe(
    Config.map((value) => Option.map(value, (url) => Redacted.make(url))),
  ),
  { optional: true },
);
const fallbackDatabaseUrl = variable(
  "DATABASE_URL",
  `${POSTGRES_URL_RULE}; required when MIGRATION_DATABASE_URL is unset`,
  Config.option(Config.schema(PostgresUrl, "DATABASE_URL")).pipe(
    Config.map((value) => Option.map(value, (url) => Redacted.make(url))),
  ),
  { optional: true },
);
const databaseAppRole = variable(
  "DATABASE_APP_ROLE",
  "be a role name of lowercase letters, digits and underscores, not starting with a digit, at most 63 characters, or unset",
  Config.option(Config.schema(RoleName, "DATABASE_APP_ROLE")),
  { optional: true },
);

/** The variables `migrate` reads. The server never reads MIGRATION_DATABASE_URL. */
export const migrationVariables = [
  nodeEnv,
  fallbackDatabaseUrl,
  migrationDatabaseUrl,
  logLevel,
  databaseAppRole,
] as const;

/** What the `migrate` entry point needs: the database config, and the app's role if separate. */
export interface MigrationConfig extends DatabaseConfig {
  /** Granted what the server needs after `up`. Unset when the server uses the same role. */
  readonly appRole: string | undefined;
}

/** Reads the `migrate` entry point's config from the current `ConfigProvider`. */
const loadMigrationConfig: Effect.Effect<MigrationConfig, ServerConfigError> = Effect.gen(
  function* () {
    const provider = yield* ConfigProvider.ConfigProvider;
    const parsed = yield* parseAll(migrationVariables, provider);
    const unset =
      Option.isNone(yield* rawOf("DATABASE_URL", provider)) &&
      Option.isNone(yield* rawOf("MIGRATION_DATABASE_URL", provider));
    const problems = [
      ...("problems" in parsed ? parsed.problems : []),
      ...(unset
        ? [
            {
              variable: "DATABASE_URL",
              problem: `is required: it must ${fallbackDatabaseUrl.rule}`,
            },
          ]
        : []),
    ];
    if (problems.length > 0 || "problems" in parsed) {
      return yield* new ServerConfigError({
        problems: inVariableOrder(problems, migrationVariables),
      });
    }
    const [nodeEnvValue, fallbackUrl, migrationUrl, level, appRole] = parsed.values;
    // Not unset, so one of the two holds a valid URL.
    const url = Option.getOrThrow(Option.orElse(migrationUrl, () => fallbackUrl));
    return {
      nodeEnv: nodeEnvValue,
      databaseUrl: url,
      logLevel: level,
      appRole: Option.getOrUndefined(appRole),
    };
  },
);

/** A provider over an environment record. Empty values count as unset. */
function envProvider(env: Record<string, string | undefined>): ConfigProvider.ConfigProvider {
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

/** {@link loadMigrationConfig} over an explicit environment record. */
export function migrationConfigFromEnv(env: Record<string, string | undefined>) {
  return loadMigrationConfig.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, envProvider(env)),
  );
}
