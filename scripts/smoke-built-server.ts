/**
 * Starts the built server (`node apps/server/dist/bin.mjs`) on a free port, waits for
 * `/health` to answer, checks that `/ready` answers 200 (so the database is reachable) and,
 * when the web app is built, that `/` serves its HTML, then
 * sends SIGTERM and checks the server exits with code 0 within its shutdown deadline. Exits
 * non-zero with the server's output when anything goes wrong. Run with `bun run smoke` after
 * `bun run build`; it needs DATABASE_URL (from the environment, `.env` or `.env.example`) and a
 * running database (`bun run db:up`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface SmokeOptions {
  readonly serverEntry: string;
  readonly deadlineMs: number;
  /** Extra environment for the server, such as DATABASE_URL. */
  readonly env?: Readonly<Record<string, string>>;
  /** Whether `/` must serve the web app's HTML (when `apps/web/dist` was built). */
  readonly expectWebApp?: boolean;
  /** How long the server may take to exit after SIGTERM; its SHUTDOWN_TIMEOUT_MS. */
  readonly shutdownDeadlineMs?: number;
  readonly pollIntervalMs?: number;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly output: string;
}

const DEFAULT_SHUTDOWN_DEADLINE_MS = 10_000;

/** Returns undefined when the body is `{"ok":true,...}`, otherwise why not. */
export function checkHealthBody(text: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return `expected JSON, got ${text}`;
  }
  if (typeof body === "object" && body !== null && "ok" in body && body.ok === true) {
    return undefined;
  }
  return `expected {"ok":true}, got ${text}`;
}

async function findFreePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  if (address === null || typeof address === "string") {
    throw new Error("could not read the probe port");
  }
  return address.port;
}

type Probe = { readonly done: true; readonly reason?: string } | { readonly done: false };

async function probeHealth(url: string): Promise<Probe> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  } catch {
    // Not listening yet.
    return { done: false };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      done: true,
      reason: `/health answered ${String(response.status)} but its body could not be read: ${detail}`,
    };
  }
  if (response.status !== 200) {
    return { done: true, reason: `/health answered ${String(response.status)}: ${text}` };
  }
  const problem = checkHealthBody(text);
  return problem === undefined
    ? { done: true }
    : { done: true, reason: `/health answered 200 but ${problem}` };
}

async function checkReady(url: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    return `/ready did not answer: ${error instanceof Error ? error.message : String(error)}`;
  }
  const text = await response.text().catch(() => "(body could not be read)");
  if (response.status !== 200) return `/ready answered ${String(response.status)}: ${text}`;
  const problem = checkHealthBody(text);
  return problem === undefined ? undefined : `/ready answered 200 but ${problem}`;
}

async function checkWebApp(url: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    return `/ did not answer: ${error instanceof Error ? error.message : String(error)}`;
  }
  await response.body?.cancel();
  const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "(no type)";
  return response.status === 200 && type === "text/html"
    ? undefined
    : `/ answered ${String(response.status)} ${type}, not the web app's HTML`;
}

/** Polls /health until it answers, the server exits, or the deadline passes; then /ready and /. */
async function checkServer(
  base: string,
  options: SmokeOptions,
  exitCode: () => number | null | undefined,
): Promise<string | undefined> {
  const deadline = Date.now() + options.deadlineMs;
  let reason: string | undefined = `/health did not answer within ${String(options.deadlineMs)} ms`;
  while (Date.now() < deadline) {
    const code = exitCode();
    if (code !== undefined)
      return `the server exited with code ${String(code)} before /health answered`;
    const probe = await probeHealth(`${base}/health`);
    if (probe.done) {
      reason = probe.reason;
      break;
    }
    await delay(options.pollIntervalMs ?? 100);
  }
  if (reason === undefined) reason = await checkReady(`${base}/ready`);
  if (reason === undefined && options.expectWebApp === true) {
    reason = await checkWebApp(`${base}/`);
  }
  return reason;
}

/** SIGTERM, then SIGKILL if the server has not exited in time. Returns whether SIGTERM was enough. */
async function stopServer(
  child: ChildProcess,
  exited: Promise<void>,
  shutdownDeadlineMs: number,
): Promise<boolean> {
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    delay(shutdownDeadlineMs + 2_000, false),
  ]);
  if (!stopped) child.kill("SIGKILL");
  return stopped;
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const port = await findFreePort();
  const shutdownDeadlineMs = options.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  // Always Node, never bun: the built server must run on the runtime it ships for.
  const child = spawn("node", [options.serverEntry], {
    env: {
      ...process.env,
      ...options.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${String(port)}`,
      SHUTDOWN_TIMEOUT_MS: String(shutdownDeadlineMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));

  let exitCode: number | null | undefined;
  const exited = once(child, "exit").then(([code]) => {
    exitCode = code as number | null;
  });

  const base = `http://127.0.0.1:${String(port)}`;
  let reason: string | undefined;
  try {
    reason = await checkServer(base, options, () => exitCode);
  } finally {
    // Whatever happened above, never leave the server running.
    if (exitCode === undefined && !(await stopServer(child, exited, shutdownDeadlineMs))) {
      reason ??= `the server did not exit within ${String(shutdownDeadlineMs)} ms of SIGTERM`;
    }
    await exited;
  }
  if (reason === undefined && exitCode !== 0) {
    reason = `the server exited with code ${String(exitCode)} after SIGTERM, not 0`;
  }

  return reason === undefined ? { ok: true, output } : { ok: false, reason, output };
}

if (import.meta.main) {
  const serverEntry = path.resolve(import.meta.dirname, "../apps/server/dist/bin.mjs");
  const webIndex = path.resolve(import.meta.dirname, "../apps/web/dist/index.html");
  const result = await runSmoke({
    serverEntry,
    deadlineMs: 30_000,
    expectWebApp: existsSync(webIndex),
    ...(process.env.SHUTDOWN_TIMEOUT_MS
      ? { shutdownDeadlineMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) }
      : {}),
  });
  if (result.ok) {
    console.log(
      `Smoke test passed: ${serverEntry} answered /health and /ready${webIndex && existsSync(webIndex) ? ", served the web app" : ""} and exited 0 on SIGTERM.`,
    );
  } else {
    console.error(`Smoke test failed: ${String(result.reason)}`);
    console.error("Server output:");
    console.error(result.output.trim() === "" ? "(none)" : result.output);
    process.exitCode = 1;
  }
}
