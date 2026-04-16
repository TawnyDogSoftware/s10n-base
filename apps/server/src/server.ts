import http from "node:http";

import { createLogger } from "./observability/logger";
import { resolveServerConfig, ensureRuntimePaths, type ServerConfig } from "./config";
import { createDatabaseClient } from "./persistence/database";
import { handleHttpRequest } from "./http/routes";
import { ProjectService } from "./services/projectService";
import { SettingsService } from "./services/settingsService";
import { createActivityHub } from "./ws/hub";

export interface StartedServer {
  readonly config: ServerConfig;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export async function startServer(
  overrides?: Partial<Pick<ServerConfig, "host" | "port">>,
): Promise<StartedServer> {
  const config = resolveServerConfig(overrides);
  ensureRuntimePaths(config.paths);

  const logger = createLogger(config.paths.logDir);
  const database = createDatabaseClient(config.paths.databasePath);
  const hub = createActivityHub(() => database.listActivities(25));
  const settingsService = new SettingsService(config.paths.settingsPath);
  const projectService = new ProjectService(database, hub);

  const server = http.createServer((request, response) => {
    void handleHttpRequest(request, response, {
      config,
      logger,
      projectService,
      settingsService,
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    hub.handleUpgrade(request, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  logger.info("server_started", {
    host: config.host,
    port,
    baseDir: config.paths.baseDir,
  });

  return {
    config,
    port,
    stop: async () => {
      hub.close();
      database.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
