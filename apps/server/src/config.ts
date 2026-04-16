import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serverPackage from "../package.json" with { type: "json" };

export interface RuntimePaths {
  readonly baseDir: string;
  readonly dataDir: string;
  readonly logDir: string;
  readonly databasePath: string;
  readonly settingsPath: string;
  readonly webDistDir: string;
}

export interface ServerConfig {
  readonly appName: string;
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly paths: RuntimePaths;
}

export function resolveRuntimePaths(baseDir = process.env.S10N_BASE_HOME?.trim()): RuntimePaths {
  const resolvedBaseDir =
    baseDir && baseDir.length > 0 ? path.resolve(baseDir) : path.join(os.homedir(), ".s10n-base");

  return {
    baseDir: resolvedBaseDir,
    dataDir: path.join(resolvedBaseDir, "data"),
    logDir: path.join(resolvedBaseDir, "logs"),
    databasePath: path.join(resolvedBaseDir, "data", "app.db"),
    settingsPath: path.join(resolvedBaseDir, "data", "settings.json"),
    webDistDir: path.resolve(import.meta.dirname, "../../web/dist"),
  };
}

export function resolveServerConfig(
  overrides?: Partial<Pick<ServerConfig, "host" | "port">>,
): ServerConfig {
  const paths = resolveRuntimePaths();
  return {
    appName: "S10N Base",
    version: serverPackage.version,
    host: overrides?.host ?? process.env.HOST?.trim() ?? "127.0.0.1",
    port: overrides?.port ?? Number(process.env.S10N_BASE_PORT ?? process.env.PORT ?? 4210),
    paths,
  };
}

export function ensureRuntimePaths(paths: RuntimePaths): void {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });
}
