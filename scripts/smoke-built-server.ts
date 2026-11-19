/**
 * Starts the built server (`node apps/server/dist/bin.mjs`) on a free port, waits for
 * `/health` to answer, checks the body and stops the server. Exits non-zero with the
 * server's output when anything goes wrong. Run with `bun run smoke` after `bun run build`.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface SmokeOptions {
  readonly serverEntry: string;
  readonly deadlineMs: number;
  readonly pollIntervalMs?: number;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly output: string;
}

const STOP_GRACE_MS = 5_000;

/** Returns undefined when the body is the server's healthy response, otherwise why not. */
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
      reason: `/health answered ${response.status} but its body could not be read: ${detail}`,
    };
  }
  if (response.status !== 200) {
    return { done: true, reason: `/health answered ${response.status}: ${text}` };
  }
  const problem = checkHealthBody(text);
  return problem === undefined
    ? { done: true }
    : { done: true, reason: `/health answered 200 but ${problem}` };
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const port = await findFreePort();
  // Always Node, never bun: the built server must run on the runtime it ships for.
  const child = spawn("node", [options.serverEntry], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), S10N_BASE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));

  let exitCode: number | null | undefined;
  const exited = once(child, "exit").then(([code]) => {
    exitCode = code as number | null;
  });

  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + options.deadlineMs;
  let reason: string | undefined = `/health did not answer within ${options.deadlineMs} ms`;

  try {
    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        reason = `the server exited with code ${exitCode} before /health answered`;
        break;
      }
      const probe = await probeHealth(url);
      if (probe.done) {
        reason = probe.reason;
        break;
      }
      await delay(options.pollIntervalMs ?? 100);
    }
  } finally {
    // Whatever happened above, never leave the server running.
    if (exitCode === undefined) {
      child.kill("SIGTERM");
      const stopped = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS, false)]);
      if (!stopped) child.kill("SIGKILL");
    }
    await exited;
  }

  return reason === undefined ? { ok: true, output } : { ok: false, reason, output };
}

if (import.meta.main) {
  const serverEntry = path.resolve(import.meta.dirname, "../apps/server/dist/bin.mjs");
  const result = await runSmoke({ serverEntry, deadlineMs: 30_000 });
  if (result.ok) {
    console.log(`Smoke test passed: ${serverEntry} answered /health.`);
  } else {
    console.error(`Smoke test failed: ${result.reason}`);
    console.error("Server output:");
    console.error(result.output.trim() === "" ? "(none)" : result.output);
    process.exitCode = 1;
  }
}
