/**
 * Serves the built web app (`apps/web/dist`) from the same origin as the API. A request path is
 * decoded, resolved against the build directory and must stay inside it, compared by path
 * segments, so a sibling directory whose name starts with the same text is not inside. Links are
 * followed first and the real path is checked, so a link inside the build cannot serve a file
 * outside it. The file is opened once: its size and its bytes come from the same handle, so a
 * rebuild that replaces it mid-request cannot make `Content-Length` disagree with the body.
 */
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/** Paths that belong to the server; the HTML fallback never answers under them. */
const API_PREFIXES = ["/rpc", "/api", "/health", "/ready", "/config"] as const;

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
  /** Open for reading; {@link sendStaticFile} closes it. */
  readonly handle: fs.promises.FileHandle;
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
  const [first] = relative.split(path.sep);
  return relative !== "" && first !== ".." && !path.isAbsolute(relative);
}

/** Errors that mean "no file to serve here"; anything else (a permission error) is a failure. */
const NOT_A_FILE = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG", "ELOOP"]);

/** `operation`'s result, or null when it fails because there is no file to serve. */
async function unlessMissing<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (NOT_A_FILE.has(String((error as NodeJS.ErrnoException).code))) return null;
    throw error;
  }
}

/** Opens the real file `filePath` names when it is a regular file inside `root`'s real path. */
async function openInside(
  root: string,
  filePath: string,
): Promise<{ handle: fs.promises.FileHandle; size: number } | null> {
  const realRoot = await unlessMissing(() => fs.promises.realpath(root));
  const real = await unlessMissing(() => fs.promises.realpath(filePath));
  if (realRoot === null || real === null || !isInside(realRoot, real)) return null;
  const handle = await unlessMissing(() =>
    fs.promises.open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW),
  );
  if (handle === null) return null;
  let kept = false;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    kept = true;
    return { handle, size: stats.size };
  } finally {
    if (!kept) await handle.close();
  }
}

function decode(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes("\0") ? undefined : decoded;
  } catch {
    return undefined;
  }
}

/**
 * The built file a URL path names, opened, or `null` when there is none or it is outside `root`.
 *
 * @throws the file system's error when the file exists but cannot be read (a permission error),
 * so the caller answers 500 rather than 404.
 */
export async function resolveStaticFile(
  root: string,
  pathname: string,
): Promise<StaticFile | null> {
  const decoded = decode(pathname === "/" ? "/index.html" : pathname);
  if (decoded === undefined) return null;
  const filePath = path.resolve(root, `.${decoded}`);
  if (!isInside(root, filePath)) return null;
  const opened = await openInside(root, filePath);
  if (opened === null) return null;
  const extension = path.extname(filePath);
  const relative = path.relative(root, filePath);
  return {
    filePath,
    handle: opened.handle,
    size: opened.size,
    contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
    cacheControl: relative.startsWith(`assets${path.sep}`) ? IMMUTABLE : "no-cache",
    isHtml: extension === ".html",
  };
}

/** One media range of an `Accept` header that is `text/html`, with or without parameters. */
const HTML_RANGE = /^\s*text\/html\s*(?:;|$)/i;

/** Whether an `Accept` header lists `text/html` as one of its media types. */
function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined) return false;
  return accept.split(",").some((range) => HTML_RANGE.test(range));
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
  return method === "GET" && acceptsHtml(accept) && !isApiPath(pathname);
}

function writeHeaders(response: ServerResponse, file: StaticFile): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", file.contentType);
  response.setHeader("Content-Length", String(file.size));
  response.setHeader("Cache-Control", file.cacheControl);
}

/**
 * Sends `file` and closes its handle, whatever happens. `HEAD` gets the headers only. A client
 * that has gone before or during the send ends the stream, which closes the handle too.
 */
export async function sendStaticFile(
  method: string | undefined,
  response: ServerResponse,
  file: StaticFile,
): Promise<void> {
  writeHeaders(response, file);
  if (method === "HEAD" || response.destroyed) {
    await file.handle.close();
    response.end();
    return;
  }
  // The stream closes the handle when it ends or fails, a client leaving included.
  await pipeline(file.handle.createReadStream({ start: 0 }), response);
}
