/**
 * Serves the built web app (`apps/web/dist`) from the same origin as the API. Files are found
 * with async `stat` and streamed. A request path is decoded, resolved against the build directory
 * and must stay inside it, compared by path segments, so a sibling directory whose name starts
 * with the same text is not inside.
 */
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/** Paths that belong to the server; the HTML fallback never answers under them. */
export const API_PREFIXES = ["/rpc", "/api", "/health", "/ready", "/config"] as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/** Vite writes content-hashed files under `assets/`; their contents never change. */
const IMMUTABLE = "public, max-age=31536000, immutable";

export interface StaticFile {
  readonly filePath: string;
  readonly size: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly isHtml: boolean;
}

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Whether `candidate` is strictly inside `root`. Both must be absolute. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function decode(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes("\0") ? undefined : decoded;
  } catch {
    return undefined;
  }
}

/** The built file a URL path names, or `null` when there is none or it is outside `root`. */
export async function resolveStaticFile(
  root: string,
  pathname: string,
): Promise<StaticFile | null> {
  const decoded = decode(pathname === "/" ? "/index.html" : pathname);
  if (decoded === undefined) return null;
  const filePath = path.resolve(root, `.${decoded}`);
  if (!isInside(root, filePath)) return null;
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    // Missing, a path below a file (ENOTDIR), a name too long: none of these is a file to serve.
    return null;
  }
  if (!stats.isFile()) return null;
  const extension = path.extname(filePath);
  const isHtml = extension === ".html";
  const relative = path.relative(root, filePath);
  return {
    filePath,
    size: stats.size,
    contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
    cacheControl: relative.startsWith(`assets${path.sep}`) ? IMMUTABLE : "no-cache",
    isHtml,
  };
}

/**
 * Whether a request that matched no file should get `index.html`, so the client router can handle
 * the path: page navigations only (a `GET` that accepts HTML), never under the API's paths.
 */
export function wantsHtmlFallback(
  method: string | undefined,
  pathname: string,
  accept: string | undefined,
) {
  return method === "GET" && accept?.includes("text/html") === true && !isApiPath(pathname);
}

/**
 * Sends `file`. `HEAD` gets the headers only. The file is opened before anything is written, so
 * a file that cannot be read throws with the response untouched and the caller can answer 500.
 */
export async function sendStaticFile(
  method: string | undefined,
  response: ServerResponse,
  file: StaticFile,
): Promise<void> {
  const handle = await fs.promises.open(file.filePath, "r");
  response.statusCode = 200;
  response.setHeader("Content-Type", file.contentType);
  response.setHeader("Content-Length", String(file.size));
  response.setHeader("Cache-Control", file.cacheControl);
  if (method === "HEAD") {
    await handle.close();
    response.end();
    return;
  }
  // The stream closes the handle when it ends or fails.
  await pipeline(handle.createReadStream(), response);
}
