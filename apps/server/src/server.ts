import http from "node:http";

import { createLogger } from "./observability/logger";
import { resolveServerConfig, type ServerConfig } from "./config";
import { handleHttpRequest } from "./http/routes";

export interface StartedServer {
  readonly config: ServerConfig;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export async function startServer(
  overrides?: Partial<Pick<ServerConfig, "host" | "port">>,
): Promise<StartedServer> {
  const config = resolveServerConfig(overrides);
  const logger = createLogger();

  const server = http.createServer((request, response) => {
    void handleHttpRequest(request, response, {
      config,
      logger,
    });
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
  });

  return {
    config,
    port,
    stop: async () => {
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
