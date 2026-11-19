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
async function stopAll(children: ReadonlyArray<Supervised>, graceMs = STOP_GRACE_MS) {
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

/** A process `bun dev` keeps running: the command, its arguments, and where it runs. */
export interface DevProcess {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

/**
 * What `bun dev` runs once its setup is done: the capture server when `SES_ENDPOINT` is set, the
 * API server in watch mode, and the web dev server. `bun` is the bun running this script.
 */
export function devProcesses(
  env: Readonly<Record<string, string | undefined>>,
  root: string,
  bun: string,
): DevProcess[] {
  const capture: DevProcess[] =
    localInboxUrl(env) === undefined
      ? []
      : [{ name: "ses-local", command: bun, args: ["scripts/ses-local/run.main.ts"], cwd: root }];
  return [
    ...capture,
    {
      name: "server",
      command: bun,
      args: ["--watch", "src/bin.ts"],
      cwd: path.join(root, "apps/server"),
    },
    {
      name: "web",
      command: path.join(root, "apps/web/node_modules/.bin/vite"),
      args: [],
      cwd: path.join(root, "apps/web"),
    },
  ];
}

/** What `bun dev` does to the world, so a test can stand in for it. */
export interface DevIo {
  readonly root: string;
  readonly bun: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Called once with a function to call on Ctrl-C or SIGTERM. */
  readonly onInterrupt: (stop: () => void) => void;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  /** Runs a setup command to its end. @throws when it exits with another code than 0. */
  readonly run: (
    command: string,
    args: ReadonlyArray<string>,
    env: Record<string, string>,
  ) => Promise<void>;
  readonly start: (process: DevProcess, env: Record<string, string>) => Supervised;
}

/** Spawns `command` with the terminal's output, and waits for it to exit with code 0. */
export async function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: Record<string, string> },
): Promise<void> {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: "inherit" });
  const code = await exitOf(child);
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${String(code)}`);
}

/** The real `DevIo`: this process, its environment, and child processes in the terminal. */
export function processDevIo(root: string): DevIo {
  return {
    root,
    bun: process.execPath,
    env: process.env,
    onInterrupt: (stop) => {
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
    run: (command, args, env) => runCommand(command, args, { cwd: root, env }),
    start: (devProcess, env) => ({
      name: devProcess.name,
      child: spawn(devProcess.command, devProcess.args, {
        cwd: devProcess.cwd,
        env,
        stdio: "inherit",
      }),
    }),
  };
}

/** Runs `bun dev` and returns the exit code. */
export async function runDev(io: DevIo): Promise<number> {
  const { source, env } = loadLocalEnv(io.root, io.env);
  io.log(`bun dev: using ${source}`);
  const stop = new Promise<void>((resolve) => {
    io.onInterrupt(resolve);
  });
  try {
    await io.run(
      "docker",
      ["compose", "-f", "docker-compose.local.yml", "up", "-d", "--wait"],
      env,
    );
    await io.run(io.bun, ["apps/server/src/migrate.ts", "up"], env);
  } catch (error) {
    io.error(`bun dev: ${(error as Error).message}`);
    return 1;
  }
  const children = devProcesses(env, io.root, io.bun).map((devProcess) =>
    io.start(devProcess, env),
  );
  io.log(`bun dev: open ${env.APP_URL ?? "the APP_URL origin"}`);
  const inbox = localInboxUrl(env);
  if (inbox !== undefined) io.log(`bun dev: emails are captured, not sent; inbox: ${inbox}`);
  return supervise(children, stop);
}
