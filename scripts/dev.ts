/**
 * `bun dev`: starts the local database and waits until it is healthy, applies migrations, then
 * runs the local SES capture server (when `SES_ENDPOINT` is set), the API server (in watch mode)
 * and the web dev server until interrupted. Ctrl-C stops them all; if one exits on its own, the
 * others are stopped too. The database container keeps running (`bun run db:down` stops it).
 *
 * Environment: `.env` if present, otherwise `.env.example` (see local-env.ts).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { loadLocalEnv } from "./local-env";

const ROOT = path.resolve(import.meta.dirname, "..");
const STOP_GRACE_MS = 15_000;

export interface Supervised {
  readonly name: string;
  readonly child: ChildProcess;
}

function exitOf(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  if (child.signalCode !== null) return Promise.resolve(1);
  return once(child, "exit").then(([code]) => (typeof code === "number" ? code : 1));
}

/** Sends SIGTERM to every child still running, then SIGKILL to any left after the grace period. */
export async function stopAll(children: ReadonlyArray<Supervised>, graceMs = STOP_GRACE_MS) {
  const running = children.filter(
    ({ child }) => child.exitCode === null && child.signalCode === null,
  );
  for (const { child } of running) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const { child } of running) if (child.exitCode === null) child.kill("SIGKILL");
  }, graceMs);
  await Promise.all(running.map(({ child }) => exitOf(child)));
  clearTimeout(timer);
}

/**
 * Waits until a child exits on its own (then stops the rest and returns its code) or `stop`
 * resolves (then stops all and returns 0).
 */
export async function supervise(
  children: ReadonlyArray<Supervised>,
  stop: Promise<void>,
  graceMs = STOP_GRACE_MS,
): Promise<number> {
  const firstExit = Promise.race(
    children.map(({ name, child }) => exitOf(child).then((code) => ({ name, code }))),
  );
  const outcome = await Promise.race([firstExit, stop.then(() => undefined)]);
  await stopAll(children, graceMs);
  if (outcome === undefined) return 0;
  console.error(`${outcome.name} exited with code ${String(outcome.code)}; stopped the others.`);
  return outcome.code === 0 ? 1 : outcome.code;
}

async function run(command: string, args: ReadonlyArray<string>, env: Record<string, string>) {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" });
  const code = await exitOf(child);
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${String(code)}`);
}

/**
 * The local inbox URL when `SES_ENDPOINT` points at the capture server, or undefined when it is
 * unset (email then goes to real SES, and no capture server is started).
 */
export function localInboxUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const endpoint = env.SES_ENDPOINT;
  if (endpoint === undefined || endpoint === "") return undefined;
  return `${new URL(endpoint).origin}/`;
}

const noop = () => {};

async function main(): Promise<number> {
  const { source, env } = loadLocalEnv(ROOT, process.env);
  console.log(`bun dev: using ${source}`);

  let requestStop: () => void = noop;
  const stop = new Promise<void>((resolve) => {
    requestStop = resolve;
  });
  process.on("SIGINT", () => {
    requestStop();
  });
  process.on("SIGTERM", () => {
    requestStop();
  });

  await run("docker", ["compose", "-f", "docker-compose.local.yml", "up", "-d", "--wait"], env);
  await run("bun", ["apps/server/src/migrate.ts", "up"], env);

  const inbox = localInboxUrl(env);
  const children: Supervised[] = [
    ...(inbox === undefined
      ? []
      : [
          {
            name: "ses-local",
            child: spawn(process.execPath, ["scripts/ses-local/main.ts"], {
              cwd: ROOT,
              env,
              stdio: "inherit",
            }),
          },
        ]),
    {
      name: "server",
      child: spawn(process.execPath, ["--watch", "src/bin.ts"], {
        cwd: path.join(ROOT, "apps/server"),
        env,
        stdio: "inherit",
      }),
    },
    {
      name: "web",
      child: spawn(path.join(ROOT, "apps/web/node_modules/.bin/vite"), [], {
        cwd: path.join(ROOT, "apps/web"),
        env,
        stdio: "inherit",
      }),
    },
  ];
  console.log(`bun dev: open ${env.APP_URL ?? "the APP_URL origin"}`);
  if (inbox !== undefined) console.log(`bun dev: emails are captured, not sent; inbox: ${inbox}`);
  return supervise(children, stop);
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`bun dev: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
