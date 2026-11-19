/**
 * The server's lifecycle, as Effect layers: config, then logger, then database, then auth, then
 * the HTTP server. `Layer` acquires them in that order and releases them in reverse when the
 * scope closes, so the HTTP server has drained before the database pool is closed.
 *
 * Releasing the HTTP server: mark not-ready, stop accepting connections, close idle keep-alive
 * connections, let requests in flight finish, and once `SHUTDOWN_TIMEOUT_MS` has passed close
 * whatever is left and report the stop as forced. Only then is the pool closed.
 *
 * Requests themselves are handled by plain `node:http` code (`http/routes.ts`); Effect runs only
 * the startup and shutdown.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  type Schedule,
  Scope,
} from "effect";
import type { Kysely, PostgresPool } from "kysely";

import { createSesAuthEmailSender, type AuthEmailSender } from "./auth/email/sender";
import { createAppAuth, type AppAuth } from "./auth/instance";
import { buildAuthOptions } from "./auth/options";
import { createSessionActorResolver } from "./auth/session-actor";
import { loadServerConfig, type ServerConfig } from "./config";
import { createSesClient } from "./infra/email/ses";
import type { AwsCredentials } from "./infra/email/sigv4";
import type { DB } from "./infra/postgres/generated/db";
import { pingDatabase, waitForDatabase } from "./infra/postgres/connect";
import { createDb, createPool, warnOnIdleError } from "./infra/postgres/pool";
import { createRequestHandler } from "./http/routes";
import { createLogger, type Logger, type LogWriter } from "./observability/logger";
import { type ActorResolver, createRpcDispatcher, type RpcHandler } from "./rpc/dispatcher";
import { createRpcHandlers } from "./rpc/handlers";

/** How long `/ready` waits for `select 1`. */
const READINESS_TIMEOUT = Duration.seconds(2);

class AppConfig extends Context.Service<AppConfig, ServerConfig>()("s10n-base/server/AppConfig") {
  /** Reads the config from the current `ConfigProvider` (the environment by default). */
  static readonly fromEnvironment = Layer.effect(AppConfig, loadServerConfig);
  static readonly layer = (config: ServerConfig) => Layer.succeed(AppConfig, config);
}

class AppLogger extends Context.Service<AppLogger, Logger>()("s10n-base/server/AppLogger") {}

interface DatabaseService {
  readonly db: Kysely<DB>;
  /** `select 1` within two seconds. Never throws. */
  readonly checkReadiness: () => Promise<boolean>;
  /** Whether the last release gave up waiting for the pool to close. */
  readonly closeTimedOut: () => boolean;
}

class Database extends Context.Service<Database, DatabaseService>()("s10n-base/server/Database") {}

/** Better Auth, over the database, sending email through SES. */
class Auth extends Context.Service<Auth, AppAuth>()("s10n-base/server/Auth") {}

interface HttpServerService {
  readonly port: number;
  /** Whether the last release had to force-close requests at the deadline. */
  readonly forced: () => boolean;
}

class HttpServer extends Context.Service<HttpServer, HttpServerService>()(
  "s10n-base/server/HttpServer",
) {}

export interface ServerLayerOptions {
  /** Where log lines go. Defaults to stdout. */
  readonly write?: LogWriter;
  /** Builds the connection pool. Defaults to a `pg` pool; tests pass a fake. */
  readonly createPool?: (config: ServerConfig, logger: Logger) => PostgresPool;
  /** Retry schedule for the first database connection. */
  readonly connectSchedule?: Schedule.Schedule<unknown>;
  readonly handlers?: ReadonlyArray<RpcHandler>;
  /** Defaults to the session lookup. */
  readonly resolveActor?: ActorResolver;
  /** Defaults to SES, at `SES_ENDPOINT` when it is set. */
  readonly emailSender?: AuthEmailSender;
}

function defaultPool(config: ServerConfig, logger: Logger): PostgresPool {
  return createPool({
    connectionString: Redacted.value(config.databaseUrl),
    max: config.databasePoolMax,
    onIdleError: warnOnIdleError(logger),
  });
}

const loggerLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    AppLogger,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return createLogger({ level: config.logLevel, write: options.write });
    }),
  );

const databaseLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const logger = yield* AppLogger;
      let closeTimedOut = false;
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => createDb((options.createPool ?? defaultPool)(config, logger))),
        (opened) =>
          Effect.promise(() => opened.destroy()).pipe(
            // A query still running holds its connection; do not wait on it forever.
            Effect.timeoutOption(Duration.millis(config.shutdownTimeoutMs)),
            Effect.tap((closed) =>
              Effect.sync(() => {
                if (Option.isSome(closed)) {
                  logger.info("database_pool_closed");
                } else {
                  closeTimedOut = true;
                  logger.warn("database_pool_close_timed_out", {
                    deadlineMs: config.shutdownTimeoutMs,
                  });
                }
              }),
            ),
          ),
      );
      yield* waitForDatabase(() => pingDatabase(db as Kysely<unknown>), {
        ...(options.connectSchedule ? { schedule: options.connectSchedule } : {}),
        onAttemptFailed: (error) => {
          logger.warn("database_unavailable", { error });
        },
      });
      const checkReadiness = () =>
        Effect.runPromise(
          Effect.tryPromise(() => pingDatabase(db as Kysely<unknown>)).pipe(
            Effect.timeout(READINESS_TIMEOUT),
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
      return { db, checkReadiness, closeTimedOut: () => closeTimedOut };
    }),
  );

/** The SES credentials from the config, revealed for signing; the session token if there is one. */
export function sesCredentials(ses: ServerConfig["email"]["ses"]): AwsCredentials {
  const token = ses.credentials.sessionToken;
  return {
    accessKeyId: ses.credentials.accessKeyId,
    secretAccessKey: Redacted.value(ses.credentials.secretAccessKey),
    ...(token === undefined ? {} : { sessionToken: Redacted.value(token) }),
  };
}

function sesEmailSender(config: ServerConfig, logger: Logger): AuthEmailSender {
  const { ses } = config.email;
  return createSesAuthEmailSender({
    ses: createSesClient({
      region: ses.region,
      endpoint: ses.endpoint,
      credentials: sesCredentials(ses),
    }),
    from: config.email.from,
    supportEmail: config.email.supportEmail,
    logger,
  });
}

const authLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const logger = yield* AppLogger;
      const database = yield* Database;
      return createAppAuth(
        buildAuthOptions(
          {
            appName: config.appName,
            appOrigin: config.appOrigin,
            nodeEnv: config.nodeEnv,
            appVariant: config.appVariant,
            secret: Redacted.value(config.auth.secret),
            logLevel: config.logLevel,
          },
          {
            db: database.db,
            emailSender: options.emailSender ?? sesEmailSender(config, logger),
            logger,
          },
        ),
      );
    }),
  );

function listen(server: http.Server, config: ServerConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Stops accepting connections and resolves once every open one has closed. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/**
 * Lets requests in flight finish, up to the shutdown deadline, then cuts off whatever is left.
 * Succeeds with whether it had to cut anything off.
 */
function drainAndClose(server: http.Server, config: ServerConfig, logger: Logger) {
  return Effect.gen(function* () {
    logger.info("http_server_draining", { deadlineMs: config.shutdownTimeoutMs });
    const closed = closeServer(server);
    server.closeIdleConnections();
    const drained = yield* Effect.promise(() => closed).pipe(
      Effect.timeoutOption(Duration.millis(config.shutdownTimeoutMs)),
    );
    const cutOff = Option.isNone(drained);
    if (cutOff) {
      logger.warn("http_server_forced_close", { deadlineMs: config.shutdownTimeoutMs });
      server.closeAllConnections();
      yield* Effect.promise(() => closed);
    }
    logger.info("http_server_closed");
    return cutOff;
  });
}

const httpServerLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    HttpServer,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const logger = yield* AppLogger;
      const database = yield* Database;
      const auth = yield* Auth;
      let shuttingDown = false;
      let forced = false;

      const dispatcher = createRpcDispatcher({
        handlers: options.handlers ?? createRpcHandlers({ db: database.db, auth }),
        resolveActor: options.resolveActor ?? createSessionActorResolver(auth),
      });
      const server = http.createServer(
        createRequestHandler({
          config,
          logger,
          dispatcher,
          auth,
          checkReadiness: database.checkReadiness,
          isShuttingDown: () => shuttingDown,
        }),
      );
      // A keep-alive connection whose request finishes during shutdown is idle from then on;
      // close it rather than wait for the client to.
      server.on("request", (_request, response: http.ServerResponse) => {
        response.once("finish", () => {
          if (shuttingDown)
            setImmediate(() => {
              server.closeIdleConnections();
            });
        });
      });

      const port = yield* Effect.acquireRelease(
        Effect.tryPromise(() => listen(server, config)),
        () => {
          shuttingDown = true;
          return drainAndClose(server, config, logger).pipe(
            Effect.map((wasForced) => {
              forced = wasForced;
            }),
          );
        },
      );
      logger.info("server_started", { host: config.host, port, appOrigin: config.appOrigin });
      return { port, forced: () => forced };
    }),
  );

/**
 * Every layer the server needs, given a config layer. Acquired config → logger → database → auth
 * → HTTP server; released in reverse.
 */
function serverLayer(config: Layer.Layer<AppConfig, unknown>, options: ServerLayerOptions = {}) {
  return httpServerLayer(options).pipe(
    Layer.provideMerge(authLayer(options)),
    Layer.provideMerge(databaseLayer(options)),
    Layer.provideMerge(loggerLayer(options)),
    Layer.provideMerge(config),
  );
}

interface StopResult {
  /**
   * True when requests were still running at the deadline and were cut off, or the pool did not
   * close within the deadline.
   */
  readonly forced: boolean;
}

export interface StartedServer {
  readonly port: number;
  readonly config: ServerConfig;
  /** Releases every layer in reverse order. Safe to call more than once. */
  readonly stop: () => Promise<StopResult>;
}

/**
 * Builds the layers in a new scope and returns once the server is listening.
 *
 * @throws the config, database or listen error when startup fails, after releasing whatever
 * was acquired.
 */
async function startWithConfigLayer(
  config: Layer.Layer<AppConfig, unknown>,
  options: ServerLayerOptions = {},
): Promise<StartedServer> {
  const scope = Effect.runSync(Scope.make());
  const built = await Effect.runPromiseExit(
    Layer.buildWithScope(serverLayer(config, options), scope),
  );
  if (Exit.isFailure(built)) {
    await Effect.runPromise(Scope.close(scope, built));
    throw Cause.squash(built.cause);
  }
  const context = built.value;
  const httpServer = Context.get(context, HttpServer);
  const database = Context.get(context, Database);
  let stopping: Promise<StopResult> | undefined;
  return {
    port: httpServer.port,
    config: Context.get(context, AppConfig),
    stop: () =>
      (stopping ??= Effect.runPromise(Scope.close(scope, Exit.void)).then(() => ({
        forced: httpServer.forced() || database.closeTimedOut(),
      }))),
  };
}

/** Starts the server with an explicit config (tests, scripts). */
export function startServer(config: ServerConfig, options: ServerLayerOptions = {}) {
  return startWithConfigLayer(AppConfig.layer(config), options);
}

/**
 * Starts the server from the environment's config, as `bin.ts` does, and returns what the process
 * runner needs. `options` are for tests.
 */
export async function startFromEnvironment(
  options: ServerLayerOptions = {},
): Promise<{ readonly shutdownTimeoutMs: number; readonly stop: StartedServer["stop"] }> {
  const started = await startWithConfigLayer(AppConfig.fromEnvironment, options);
  return { shutdownTimeoutMs: started.config.shutdownTimeoutMs, stop: started.stop };
}
