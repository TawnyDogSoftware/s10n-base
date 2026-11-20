/**
 * `bun dev`: starts the local database and waits until it is healthy, applies migrations, then
 * runs the local SES capture server (when `SES_ENDPOINT` is set), the API server (in watch mode)
 * and the web dev server until interrupted. Ctrl-C stops them all; if one exits on its own, the
 * others are stopped too. The database container keeps running (`bun run db:down` stops it).
 *
 * Environment: `.env` if present, otherwise `.env.example` (see local-env.ts).
 */
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

import { loadLocalEnv } from "./local-env";

const STOP_GRACE_MS = 15_000;

/** How a child ended: its exit code (1 when a signal ended it), or the error that kept it from starting. */
interface Ending {
  readonly code: number;
  readonly error?: Error;
}

export interface Supervised {
  readonly name: string;
  readonly child: ChildProcess;
  /** Settles when the child exits or fails to spawn; never rejects. */
  readonly ended: Promise<Ending>;
}

/**
 * Watches a child from the moment it is spawned. A command that cannot be spawned (a missing
 * binary) emits `error` and never `exit`, so both are listened for, before either can be missed.
 */
export function watch(name: string, child: ChildProcess): Supervised {
  const ended = new Promise<Ending>((resolve) => {
    child.once("exit", (code) => {
      resolve({ code: typeof code === "number" ? code : 1 });
    });
    child.once("error", (error) => {
      resolve({ code: 1, error });
    });
  });
  return { name, child, ended };
}

/**
 * Sends SIGTERM to every child still running, then SIGKILL to any left after the grace period.
 * A child that never spawned has no process to stop.
 */
async function stopAll(children: ReadonlyArray<Supervised>, graceMs = STOP_GRACE_MS) {
  const running = children.filter(
    ({ child }) => child.pid !== undefined && child.exitCode === null && child.signalCode === null,
  );
  for (const { child } of running) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const { child } of running) if (child.exitCode === null) child.kill("SIGKILL");
  }, graceMs);
  await Promise.all(running.map(({ ended }) => ended));
  clearTimeout(timer);
}

/**
 * Waits until a child ends on its own or fails to spawn (then stops the rest and returns its
 * code) or `stop` resolves (then stops all and returns 0). The others are stopped in every case.
 */
export async function supervise(
  children: ReadonlyArray<Supervised>,
  stop: Promise<void>,
  graceMs = STOP_GRACE_MS,
): Promise<number> {
  const firstEnd = Promise.race(
    children.map(({ name, ended }) => ended.then((ending) => ({ name, ...ending }))),
  );
  let outcome: (Ending & { readonly name: string }) | undefined;
  try {
    outcome = await Promise.race([firstEnd, stop.then(() => undefined)]);
  } finally {
    await stopAll(children, graceMs);
  }
  if (outcome === undefined) return 0;
  const what =
    outcome.error === undefined
      ? `exited with code ${String(outcome.code)}`
      : `could not start (${outcome.error.message})`;
  console.error(`${outcome.name} ${what}; stopped the others.`);
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
  const { code, error } = await watch(command, child).ended;
  if (error !== undefined) throw error;
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
    start: (devProcess, env) =>
      watch(
        devProcess.name,
        spawn(devProcess.command, devProcess.args, {
          cwd: devProcess.cwd,
          env,
          stdio: "inherit",
        }),
      ),
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
