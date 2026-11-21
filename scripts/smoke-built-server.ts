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
import { type AddressInfo, createServer } from "node:net";
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
  // A TCP server listening on a host and port always has an AddressInfo.
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, "close");
  return port;
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
    // fetch fails with an Error, here a TypeError for a dropped connection.
    const detail = (error as Error).message;
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
    return `/ready did not answer: ${(error as Error).message}`;
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
    return `/ did not answer: ${(error as Error).message}`;
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
  /** Why the server is no longer running, or undefined while it runs. */
  ended: () => string | undefined,
): Promise<string | undefined> {
  const deadline = Date.now() + options.deadlineMs;
  let reason: string | undefined = `/health did not answer within ${String(options.deadlineMs)} ms`;
  while (Date.now() < deadline) {
    const gone = ended();
    if (gone !== undefined) return gone;
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

  // Both handlers from the start: a server that cannot be spawned emits `error`, never `exit`.
  let exitCode: number | null | undefined;
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code) => {
      exitCode = code;
      resolve();
    });
    child.once("error", (error) => {
      spawnError = error;
      resolve();
    });
  });
  const ended = (): string | undefined => {
    if (spawnError !== undefined) return `the server could not start: ${spawnError.message}`;
    if (exitCode === undefined) return undefined;
    return `the server exited with code ${String(exitCode)} before /health answered`;
  };

  const base = `http://127.0.0.1:${String(port)}`;
  let reason: string | undefined;
  try {
    reason = await checkServer(base, options, ended);
  } finally {
    // Whatever happened above, never leave the server running.
    const running = exitCode === undefined && spawnError === undefined;
    if (running && !(await stopServer(child, exited, shutdownDeadlineMs))) {
      reason ??= `the server did not exit within ${String(shutdownDeadlineMs)} ms of SIGTERM`;
    }
    await exited;
  }
  if (reason === undefined && exitCode !== 0) {
    reason = `the server exited with code ${String(exitCode)} after SIGTERM, not 0`;
  }

  return reason === undefined ? { ok: true, output } : { ok: false, reason, output };
}

/** Where the output of `smokeCommand` goes. */
export interface SmokeOutput {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/**
 * `bun run smoke`: smoke-tests the built server under `root`, expecting the web app at `/` when
 * it was built, and returns the exit code.
 */
export async function smokeCommand(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  out: SmokeOutput,
): Promise<number> {
  const serverEntry = path.join(root, "apps/server/dist/bin.mjs");
  const expectWebApp = existsSync(path.join(root, "apps/web/dist/index.html"));
  const shutdown = env.SHUTDOWN_TIMEOUT_MS;
  const result = await runSmoke({
    serverEntry,
    deadlineMs: 30_000,
    expectWebApp,
    ...(shutdown === undefined ? {} : { shutdownDeadlineMs: Number(shutdown) }),
  });
  if (result.ok) {
    const web = expectWebApp ? ", served the web app" : "";
    out.log(
      `Smoke test passed: ${serverEntry} answered /health and /ready${web} and exited 0 on SIGTERM.`,
    );
    return 0;
  }
  out.error(`Smoke test failed: ${String(result.reason)}`);
  out.error("Server output:");
  out.error(result.output.trim() === "" ? "(none)" : result.output);
  return 1;
}
