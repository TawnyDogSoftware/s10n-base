/**
 * The server's lifecycle, as Effect layers: config, then logger, then database, then HTTP server.
 * `Layer` acquires them in that order and releases them in reverse when the scope closes, so the
 * HTTP server has drained before the database pool is closed.
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

import { loadServerConfig, type ServerConfig } from "./config";
import type { DB } from "./infra/postgres/generated/db";
import { pingDatabase, waitForDatabase } from "./infra/postgres/connect";
import { createDb, createPool } from "./infra/postgres/pool";
import { createRequestHandler } from "./http/routes";
import { createLogger, type Logger, type LogWriter } from "./observability/logger";
import {
  anonymousActorResolver,
  type ActorResolver,
  createRpcDispatcher,
  type RpcHandler,
} from "./rpc/dispatcher";
import { rpcHandlers } from "./rpc/handlers";

/** How long `/ready` waits for `select 1`. */
const READINESS_TIMEOUT = Duration.seconds(2);

export class AppConfig extends Context.Service<AppConfig, ServerConfig>()(
  "s10n-base/server/AppConfig",
) {
  /** Reads the config from the current `ConfigProvider` (the environment by default). */
  static readonly fromEnvironment = Layer.effect(AppConfig, loadServerConfig);
  static readonly layer = (config: ServerConfig) => Layer.succeed(AppConfig, config);
}

export class AppLogger extends Context.Service<AppLogger, Logger>()("s10n-base/server/AppLogger") {}

export interface DatabaseService {
  readonly db: Kysely<DB>;
  /** `select 1` within two seconds. Never throws. */
  readonly checkReadiness: () => Promise<boolean>;
}

export class Database extends Context.Service<Database, DatabaseService>()(
  "s10n-base/server/Database",
) {}

export interface HttpServerService {
  readonly port: number;
  /** Whether the last release had to force-close requests at the deadline. */
  readonly forced: () => boolean;
}

export class HttpServer extends Context.Service<HttpServer, HttpServerService>()(
  "s10n-base/server/HttpServer",
) {}

export interface ServerLayerOptions {
  /** Where log lines go. Defaults to stdout. */
  readonly write?: LogWriter;
  /** Builds the connection pool. Defaults to a `pg` pool; tests pass a fake. */
  readonly createPool?: (config: ServerConfig, logger: Logger) => PostgresPool;
  /** Retry schedule for the first database connection. */
  readonly connectSchedule?: Schedule.Schedule<unknown, unknown>;
  readonly handlers?: ReadonlyArray<RpcHandler>;
  readonly resolveActor?: ActorResolver;
}

function defaultPool(config: ServerConfig, logger: Logger): PostgresPool {
  return createPool({
    connectionString: Redacted.value(config.databaseUrl),
    max: config.databasePoolMax,
    onIdleError: (error) => logger.warn("database_idle_connection_failed", { error }),
  });
}

const loggerLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    AppLogger,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return createLogger({
        level: config.logLevel,
        ...(options.write ? { write: options.write } : {}),
      });
    }),
  );

const databaseLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const logger = yield* AppLogger;
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => createDb((options.createPool ?? defaultPool)(config, logger))),
        (db) =>
          Effect.promise(() => db.destroy()).pipe(
            // A query still running holds its connection; do not wait on it forever.
            Effect.timeoutOption(Duration.millis(config.shutdownTimeoutMs)),
            Effect.tap((closed) =>
              Effect.sync(() =>
                Option.isSome(closed)
                  ? logger.info("database_pool_closed")
                  : logger.warn("database_pool_close_timed_out"),
              ),
            ),
          ),
      );
      yield* waitForDatabase(() => pingDatabase(db as Kysely<unknown>), {
        ...(options.connectSchedule ? { schedule: options.connectSchedule } : {}),
        onAttemptFailed: (error) => logger.warn("database_unavailable", { error }),
      });
      const checkReadiness = () =>
        Effect.runPromise(
          Effect.tryPromise(() => pingDatabase(db as Kysely<unknown>)).pipe(
            Effect.timeout(READINESS_TIMEOUT),
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
      return { db, checkReadiness };
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

const httpServerLayer = (options: ServerLayerOptions) =>
  Layer.effect(
    HttpServer,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const logger = yield* AppLogger;
      const database = yield* Database;
      let shuttingDown = false;
      let forced = false;

      const dispatcher = createRpcDispatcher({
        handlers: options.handlers ?? rpcHandlers,
        resolveActor: options.resolveActor ?? anonymousActorResolver,
      });
      const server = http.createServer(
        createRequestHandler({
          config,
          logger,
          dispatcher,
          checkReadiness: database.checkReadiness,
          isShuttingDown: () => shuttingDown,
        }),
      );
      // A keep-alive connection whose request finishes during shutdown is idle from then on;
      // close it rather than wait for the client to.
      server.on("request", (_request, response: http.ServerResponse) => {
        response.once("finish", () => {
          if (shuttingDown) setImmediate(() => server.closeIdleConnections());
        });
      });

      const port = yield* Effect.acquireRelease(
        Effect.tryPromise(() => listen(server, config)),
        () =>
          Effect.gen(function* () {
            shuttingDown = true;
            logger.info("http_server_draining", { deadlineMs: config.shutdownTimeoutMs });
            const closed = new Promise<void>((resolve) => server.close(() => resolve()));
            server.closeIdleConnections();
            const drained = yield* Effect.promise(() => closed).pipe(
              Effect.timeoutOption(Duration.millis(config.shutdownTimeoutMs)),
            );
            if (Option.isNone(drained)) {
              forced = true;
              logger.warn("http_server_forced_close", { deadlineMs: config.shutdownTimeoutMs });
              server.closeAllConnections();
              yield* Effect.promise(() => closed);
            }
            logger.info("http_server_closed");
          }),
      );
      logger.info("server_started", { host: config.host, port, appOrigin: config.appOrigin });
      return { port, forced: () => forced };
    }),
  );

/**
 * Every layer the server needs, given a config layer. Acquired config → logger → database → HTTP
 * server; released in reverse.
 */
export function serverLayer(
  config: Layer.Layer<AppConfig, unknown>,
  options: ServerLayerOptions = {},
) {
  return httpServerLayer(options).pipe(
    Layer.provideMerge(databaseLayer(options)),
    Layer.provideMerge(loggerLayer(options)),
    Layer.provideMerge(config),
  );
}

export interface StopResult {
  /** True when requests were still running at the deadline and were cut off. */
  readonly forced: boolean;
}

export interface StartedServer {
  readonly port: number;
  readonly config: ServerConfig;
  /** Releases every layer in reverse order. Safe to call more than once. */
  readonly stop: () => Promise<StopResult>;
}

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) return undefined;
  const reason = exit.cause.reasons[0];
  if (reason === undefined) return new Error("Server startup was interrupted.");
  return reason._tag === "Fail"
    ? reason.error
    : reason._tag === "Die"
      ? reason.defect
      : new Error("Server startup was interrupted.");
}

/**
 * Builds the layers in a new scope and returns once the server is listening.
 *
 * @throws the config, database or listen error when startup fails, after releasing whatever
 * was acquired.
 */
export async function startWithConfigLayer(
  config: Layer.Layer<AppConfig, unknown>,
  options: ServerLayerOptions = {},
): Promise<StartedServer> {
  const scope = Effect.runSync(Scope.make());
  const built = await Effect.runPromiseExit(
    Layer.buildWithScope(serverLayer(config, options), scope),
  );
  if (Exit.isFailure(built)) {
    await Effect.runPromise(Scope.close(scope, built));
    throw failureOf(built);
  }
  const context = built.value;
  const httpServer = Context.get(context, HttpServer);
  let stopping: Promise<StopResult> | undefined;
  return {
    port: httpServer.port,
    config: Context.get(context, AppConfig),
    stop: () =>
      (stopping ??= Effect.runPromise(Scope.close(scope, Exit.void)).then(() => ({
        forced: httpServer.forced(),
      }))),
  };
}

/** Starts the server with an explicit config (tests, scripts). */
export function startServer(config: ServerConfig, options: ServerLayerOptions = {}) {
  return startWithConfigLayer(AppConfig.layer(config), options);
}
