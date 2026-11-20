/**
 * `bun run docker:smoke [image]`: runs the container image in production mode against the local
 * Postgres (DATABASE_URL, an admin role) and checks it, then removes everything it created.
 *
 * 1. The image: runs as `node`, production, a version, a health check and SIGTERM; its files
 *    (image-contents.ts).
 * 2. A throwaway database with an owner role and an app role; `migrate up` from the image as the
 *    owner, granting the app role.
 * 3. A missing and a development-only variable each stop the server with one config error line
 *    and exit 1, without printing a secret.
 * 4. The server from the image as the app role, with production-shaped values and a read-only
 *    root filesystem: healthy, `/health`, `/ready`, the web app with its security headers,
 *    `/config`'s version, Better Auth answering, not root, nothing writable; then SIGTERM ends
 *    it with exit code 0 within the shutdown deadline.
 *
 * Nothing it starts can reach a real service: the email region does not exist and no email is
 * sent. Containers use the host's network, so the local Postgres on 127.0.0.1 is reachable.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { imageContentProblems, LIST_FILES_SCRIPT, runtimePackages } from "./image-contents";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SmokeIo {
  run(command: string, args: readonly string[], input?: string): Promise<CommandResult>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  freePort(): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Random lowercase hex, for names and passwords. */
  random(): string;
  log(line: string): void;
}

export interface SmokeOptions {
  readonly image: string;
  /** A URL for a role that may create roles and databases. */
  readonly adminUrl: string;
  /** The Postgres image whose `psql` runs the admin statements. */
  readonly postgresImage: string;
}

/** A check that failed; its message says which and why. */
export class SmokeFailure extends Error {
  override readonly name = "SmokeFailure";
}

const APP_URL = "https://app.example.com";
const SHUTDOWN_TIMEOUT_MS = 5000;
const HEALTHY_WITHIN_MS = 60_000;
const BAD_CONFIG_WITHIN_MS = 30_000;
const POLL_MS = 250;
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
] as const;

interface Roles {
  readonly database: string;
  readonly owner: { readonly name: string; readonly url: string };
  readonly app: { readonly name: string; readonly url: string };
}

interface Secrets {
  readonly authSecret: string;
  readonly awsSecretKey: string;
  readonly ownerPassword: string;
  readonly appPassword: string;
}

interface Context {
  readonly io: SmokeIo;
  readonly options: SmokeOptions;
  readonly roles: Roles;
  readonly secrets: Secrets;
  /** Containers to remove at the end. */
  readonly containers: string[];
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

async function docker(io: SmokeIo, args: readonly string[], input?: string): Promise<string> {
  const result = await io.run("docker", args, input);
  check(
    result.code === 0,
    `docker ${args.slice(0, 2).join(" ")} failed (exit ${String(result.code)}): ${result.stderr.trim()}`,
  );
  return result.stdout;
}

/** A URL for `name` with `password` on the admin URL's host, in `database`. */
export function roleUrl(adminUrl: string, name: string, password: string, database: string) {
  const url = new URL(adminUrl);
  url.username = name;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

function makeSecrets(random: () => string): Secrets {
  return {
    authSecret: random(),
    awsSecretKey: random(),
    ownerPassword: random(),
    appPassword: random(),
  };
}

function makeRoles(adminUrl: string, prefix: string, secrets: Secrets): Roles {
  return {
    database: prefix,
    owner: {
      name: `${prefix}_owner`,
      url: roleUrl(adminUrl, `${prefix}_owner`, secrets.ownerPassword, prefix),
    },
    app: {
      name: `${prefix}_app`,
      url: roleUrl(adminUrl, `${prefix}_app`, secrets.appPassword, prefix),
    },
  };
}

function psql(context: Context, sql: string): Promise<string> {
  const { io, options } = context;
  return docker(
    io,
    [
      "run",
      "--rm",
      "-i",
      "--network",
      "host",
      options.postgresImage,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      options.adminUrl,
    ],
    sql,
  );
}

/** Names and passwords come from `random()`, which is hex, so quoting is safe. */
function setupSql(roles: Roles, secrets: Secrets): string {
  return [
    `create role "${roles.owner.name}" login password '${secrets.ownerPassword}';`,
    `create role "${roles.app.name}" login password '${secrets.appPassword}';`,
    `create database "${roles.database}" owner "${roles.owner.name}";`,
    "",
  ].join("\n");
}

function teardownSql(roles: Roles): string {
  return [
    `drop database if exists "${roles.database}" with (force);`,
    `drop role if exists "${roles.app.name}";`,
    `drop role if exists "${roles.owner.name}";`,
    "",
  ].join("\n");
}

interface ImageInfo {
  readonly user: string;
  readonly env: Readonly<Record<string, string>>;
  readonly size: number;
  readonly healthcheck: boolean;
  readonly stopSignal: string;
}

export function parseImageInfo(json: string): ImageInfo {
  const [image] = JSON.parse(json) as Array<{
    readonly Size: number;
    readonly Config: {
      readonly User?: string;
      readonly Env?: readonly string[];
      readonly Healthcheck?: { readonly Test?: readonly string[] } | null;
      readonly StopSignal?: string;
    };
  }>;
  check(image !== undefined, "docker image inspect returned no image");
  const env = Object.fromEntries(
    (image.Config.Env ?? []).map((entry) => {
      const at = entry.indexOf("=");
      return [entry.slice(0, at), entry.slice(at + 1)];
    }),
  );
  return {
    user: image.Config.User ?? "",
    env,
    size: image.Size,
    healthcheck: (image.Config.Healthcheck?.Test ?? []).length > 0,
    stopSignal: image.Config.StopSignal ?? "",
  };
}

/** The image's settings; returns its APP_VERSION. */
async function checkImage(context: Context): Promise<string> {
  const { io, options } = context;
  const info = parseImageInfo(await docker(io, ["image", "inspect", options.image]));
  check(info.user === "node", `the image runs as "${info.user}", not node`);
  check(info.env.NODE_ENV === "production", "the image does not set NODE_ENV=production");
  check(info.healthcheck, "the image has no HEALTHCHECK");
  check(
    info.stopSignal === "SIGTERM",
    `the image's stop signal is "${info.stopSignal}", not SIGTERM`,
  );
  const version = info.env.APP_VERSION ?? "";
  check(version !== "", "the image has no APP_VERSION: build it with --build-arg APP_VERSION=...");
  io.log(
    `ok: image ${options.image}, ${(info.size / 1_000_000).toFixed(1)} MB, version ${version}, runs as node`,
  );
  return version;
}

async function checkContents(context: Context): Promise<void> {
  const { io, options } = context;
  const listing = await docker(io, [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    options.image,
    "-e",
    LIST_FILES_SCRIPT,
  ]);
  const paths = JSON.parse(listing) as string[];
  const problems = imageContentProblems(paths);
  check(problems.length === 0, `the image holds what it must not:\n${problems.join("\n")}`);
  const packages = runtimePackages(paths);
  io.log(
    `ok: image contents (${String(paths.length)} paths), ${String(packages.length)} run-time packages:`,
  );
  for (const entry of packages) io.log(`  ${entry}`);
}

/** Flags for every container: the host's network, a read-only root, no privileges. */
function hardened(name: string, env: Readonly<Record<string, string>>): string[] {
  return [
    "--name",
    name,
    "--network",
    "host",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
  ];
}

async function containerState(io: SmokeIo, name: string, field: string): Promise<string> {
  return (await docker(io, ["inspect", "-f", `{{${field}}}`, name])).trim();
}

/** Waits until `name` has exited, or `withinMs` has passed; returns whether it exited. */
async function waitForExit(io: SmokeIo, name: string, withinMs: number): Promise<boolean> {
  const deadline = io.now() + withinMs;
  while (io.now() <= deadline) {
    if ((await containerState(io, name, ".State.Status")) === "exited") return true;
    await io.sleep(POLL_MS);
  }
  return false;
}

async function logsOf(io: SmokeIo, name: string): Promise<string> {
  const result = await io.run("docker", ["logs", name]);
  return `${result.stdout}${result.stderr}`;
}

/** Runs a command from the image to its end; returns its exit code and output. */
async function runToExit(
  context: Context,
  label: string,
  env: Readonly<Record<string, string>>,
  command: readonly string[],
): Promise<{ readonly code: number; readonly output: string }> {
  const { io, options } = context;
  const name = `${context.roles.database}_${label}`;
  context.containers.push(name);
  await docker(io, ["run", "-d", ...hardened(name, env), options.image, ...command]);
  check(await waitForExit(io, name, BAD_CONFIG_WITHIN_MS), `${label} did not exit`);
  const code = Number(await containerState(io, name, ".State.ExitCode"));
  return { code, output: await logsOf(io, name) };
}

async function migrate(context: Context): Promise<void> {
  const { roles } = context;
  const result = await runToExit(
    context,
    "migrate",
    {
      NODE_ENV: "production",
      MIGRATION_DATABASE_URL: roles.owner.url,
      DATABASE_APP_ROLE: roles.app.name,
    },
    ["apps/server/dist/migrate.mjs", "up"],
  );
  check(
    result.code === 0 && result.output.includes(`"grantedTo":"${roles.app.name}"`),
    `migrate up as the owner failed (exit ${String(result.code)}):\n${result.output}`,
  );
  context.io.log(`ok: migrate up as ${roles.owner.name}, granting ${roles.app.name}`);
}

/** Production-shaped values: an https origin, a real-length secret, no local endpoint. */
function serverEnv(context: Context, port: number): Record<string, string> {
  const { roles, secrets } = context;
  return {
    PORT: String(port),
    APP_URL,
    DATABASE_URL: roles.app.url,
    BETTER_AUTH_SECRET: secrets.authSecret,
    APP_VARIANT: "production",
    EMAIL_FROM: "no-reply@example.com",
    SUPPORT_EMAIL: "support@example.com",
    // A well-formed region that does not exist: nothing can be sent anywhere real.
    SES_REGION: "zz-smoke-1",
    AWS_ACCESS_KEY_ID: "AKIDSMOKETEST",
    AWS_SECRET_ACCESS_KEY: secrets.awsSecretKey,
    SHUTDOWN_TIMEOUT_MS: String(SHUTDOWN_TIMEOUT_MS),
  };
}

/** One bad variable: one config error line, exit 1, and no secret in the output. */
async function checkBadConfig(
  context: Context,
  label: string,
  env: Readonly<Record<string, string>>,
  variable: string,
): Promise<void> {
  const result = await runToExit(context, label, env, ["apps/server/dist/bin.mjs"]);
  const lines = result.output.split("\n").filter((line) => line.trim() !== "");
  const [line = ""] = lines;
  check(result.code === 1, `with ${label}, the server exited ${String(result.code)}, not 1`);
  check(
    lines.length === 1 && line.includes("Invalid configuration") && line.includes(variable),
    `with ${label}, the server did not print one config error naming ${variable}:\n${result.output}`,
  );
  const leaked = Object.values(context.secrets).filter((secret) => result.output.includes(secret));
  check(leaked.length === 0, `with ${label}, the server printed a secret`);
  context.io.log(
    `ok: ${label} stops the server with one config error line and exit 1, no secret printed`,
  );
}

async function checkBadConfigs(context: Context): Promise<void> {
  const { BETTER_AUTH_SECRET: _omitted, ...withoutSecret } = serverEnv(context, 1);
  await checkBadConfig(context, "missing_secret", withoutSecret, "BETTER_AUTH_SECRET");
  await checkBadConfig(
    context,
    "local_email_endpoint",
    { ...serverEnv(context, 1), SES_ENDPOINT: "http://127.0.0.1:8005" },
    "SES_ENDPOINT",
  );
}

async function startServer(context: Context, port: number): Promise<string> {
  const { io, options } = context;
  const name = `${context.roles.database}_server`;
  context.containers.push(name);
  await docker(io, ["run", "-d", ...hardened(name, serverEnv(context, port)), options.image]);
  const deadline = io.now() + HEALTHY_WITHIN_MS;
  let health = "";
  while (io.now() <= deadline && health !== "healthy") {
    await io.sleep(POLL_MS);
    health = await containerState(io, name, ".State.Health.Status");
    check(
      (await containerState(io, name, ".State.Status")) === "running",
      `the server stopped while starting:\n${await logsOf(io, name)}`,
    );
  }
  check(health === "healthy", `the server's health check did not pass:\n${await logsOf(io, name)}`);
  io.log("ok: the server started as the app role and its HEALTHCHECK reports healthy");
  return name;
}

async function expectJson(io: SmokeIo, url: string, status: number, init?: RequestInit) {
  const response = await io.fetch(url, init);
  const text = await response.text();
  check(
    response.status === status,
    `${init?.method ?? "GET"} ${url} answered ${String(response.status)}, not ${String(status)}: ${text}`,
  );
  return JSON.parse(text) as Record<string, unknown>;
}

async function checkHttp(context: Context, base: string, version: string): Promise<void> {
  const { io } = context;
  await expectJson(io, `${base}/health`, 200);
  await expectJson(io, `${base}/ready`, 200);
  const page = await io.fetch(`${base}/`);
  const html = await page.text();
  check(
    page.status === 200 && /^<!doctype html>/i.test(html),
    `/ answered ${String(page.status)} without the web app`,
  );
  const missing = SECURITY_HEADERS.filter((header) => !page.headers.has(header));
  check(missing.length === 0, `/ lacks ${missing.join(", ")}`);
  const config = await expectJson(io, `${base}/config`, 200);
  check(
    config.appVersion === version,
    `/config reports ${String(config.appVersion)}, not ${version}`,
  );
  // Better Auth, with its packages and the app role's grants: an unknown user is refused.
  const signIn = await expectJson(io, `${base}/api/auth/sign-in/email`, 401, {
    method: "POST",
    headers: { origin: APP_URL, "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
  });
  check(signIn.code === "INVALID_EMAIL_OR_PASSWORD", `sign-in answered ${JSON.stringify(signIn)}`);
  const session = await expectJson(io, `${base}/api/app-auth/session`, 200);
  check(
    JSON.stringify(session) === '{"ok":true,"data":{"session":null}}',
    "the session route did not answer",
  );
  io.log(
    `ok: /health, /ready, / with ${SECURITY_HEADERS.join(", ")}, /config ${version}, sign-in, session`,
  );
}

async function checkProcess(context: Context, name: string): Promise<void> {
  const { io } = context;
  const uid = await docker(io, [
    "exec",
    name,
    "node",
    "-e",
    "process.stdout.write(String(process.getuid()))",
  ]);
  check(uid !== "0", "the server runs as root");
  check(
    (await containerState(io, name, ".HostConfig.ReadonlyRootfs")) === "true",
    "the root filesystem is writable",
  );
  const write = await io.run("docker", [
    "exec",
    name,
    "node",
    "-e",
    'require("node:fs").writeFileSync("/tmp/probe", "")',
  ]);
  check(
    write.code !== 0 && write.stderr.includes("EROFS"),
    "the container could write to its filesystem",
  );
  io.log(`ok: runs as uid ${uid}, with a read-only root filesystem`);
}

async function checkStop(context: Context, name: string): Promise<void> {
  const { io } = context;
  const started = io.now();
  await docker(io, ["kill", "--signal", "SIGTERM", name]);
  check(
    await waitForExit(io, name, SHUTDOWN_TIMEOUT_MS),
    `the server did not exit within ${String(SHUTDOWN_TIMEOUT_MS)} ms of SIGTERM`,
  );
  const code = await containerState(io, name, ".State.ExitCode");
  check(code === "0", `the server exited ${code} after SIGTERM, not 0:\n${await logsOf(io, name)}`);
  io.log(`ok: SIGTERM, exit code 0 after ${String(io.now() - started)} ms`);
}

async function cleanUp(context: Context): Promise<void> {
  for (const name of context.containers) await context.io.run("docker", ["rm", "-f", name]);
  await psql(context, teardownSql(context.roles));
}

/** Runs every check; throws {@link SmokeFailure} at the first that fails, after cleaning up. */
export async function runContainerSmoke(io: SmokeIo, options: SmokeOptions): Promise<void> {
  const secrets = makeSecrets(() => io.random());
  const roles = makeRoles(options.adminUrl, `smoke_${io.random().slice(0, 12)}`, secrets);
  const context: Context = { io, options, roles, secrets, containers: [] };
  const version = await checkImage(context);
  await checkContents(context);
  await psql(context, setupSql(roles, secrets));
  try {
    await migrate(context);
    await checkBadConfigs(context);
    const port = await io.freePort();
    const name = await startServer(context, port);
    await checkHttp(context, `http://127.0.0.1:${String(port)}`, version);
    await checkProcess(context, name);
    await checkStop(context, name);
  } finally {
    await cleanUp(context);
  }
}

/** The tag in `image:` of the compose file's Postgres service. */
export function postgresImageOf(compose: string): string {
  const image = /^\s*image:\s*(postgres:\S+)\s*$/m.exec(compose)?.[1];
  check(image !== undefined, "docker-compose.local.yml names no postgres image");
  return image;
}

export interface CommandIo {
  readonly smoke: SmokeIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly compose: string;
  readonly error: (line: string) => void;
}

/** `docker:smoke [image]`. Returns the exit code. */
export async function containerSmokeCommand(
  argv: readonly string[],
  io: CommandIo,
): Promise<number> {
  try {
    check(argv.length <= 1, "Usage: docker:smoke [image]");
    const adminUrl = io.env.DATABASE_URL;
    check(
      adminUrl !== undefined && adminUrl !== "",
      "DATABASE_URL is not set: it names the local Postgres",
    );
    await runContainerSmoke(io.smoke, {
      image: argv[0] ?? "s10n-base:local",
      adminUrl,
      postgresImage: postgresImageOf(io.compose),
    });
    io.smoke.log("docker:smoke passed");
    return 0;
  } catch (error) {
    io.error(`docker:smoke failed: ${(error as Error).message}`);
    return 1;
  }
}

/** The real `SmokeIo`: commands through `spawn`, the global `fetch`, the clock. */
export function nodeSmokeIo(print: (line: string) => void): SmokeIo {
  return {
    run: (command, args, input) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(input ?? "");
      }),
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
    freePort,
    sleep: (ms) => delay(ms),
    now: () => Date.now(),
    random: () => randomBytes(16).toString("hex"),
    log: print,
  };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, "close");
  return port;
}

/** What `smoke.main.ts` passes: the real I/O, the process's environment, the compose file. */
export function nodeCommandIo(root: string): CommandIo {
  return {
    smoke: nodeSmokeIo(console.log),
    env: process.env,
    compose: readFileSync(path.join(root, "docker-compose.local.yml"), "utf8"),
    error: console.error,
  };
}
