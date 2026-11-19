import path from "node:path";

import serverPackage from "../package.json" with { type: "json" };

export interface ServerPaths {
  readonly webDistDir: string;
}

export interface ServerConfig {
  readonly appName: string;
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly paths: ServerPaths;
}

export function resolveServerConfig(
  overrides?: Partial<Pick<ServerConfig, "host" | "port">>,
): ServerConfig {
  return {
    appName: "S10N Base",
    version: serverPackage.version,
    host: overrides?.host ?? process.env.HOST?.trim() ?? "127.0.0.1",
    port: overrides?.port ?? Number(process.env.S10N_BASE_PORT ?? process.env.PORT ?? 4210),
    paths: {
      webDistDir: path.resolve(import.meta.dirname, "../../web/dist"),
    },
  };
}
