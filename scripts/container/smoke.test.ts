import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_FILES } from "./image-contents";
import {
  containerSmokeCommand,
  nodeCommandIo,
  nodeSmokeIo,
  parseImageInfo,
  postgresImageOf,
  roleUrl,
  runContainerSmoke,
  SmokeFailure,
  type CommandResult,
  type SmokeIo,
} from "./smoke";

const ADMIN_URL = "postgres://admin:admin-password@127.0.0.1:54320/app";
const options = { image: "app:test", adminUrl: ADMIN_URL, postgresImage: "postgres:18.7" };

interface Container {
  readonly kind: string;
  readonly env: Record<string, string>;
  status: string;
  exitCode: number;
  logs: string;
}

/** What the fake Docker and server answer; each test changes one thing. */
interface Scenario {
  image: unknown;
  listing: string[];
  migrate: { code: number; logs: string; exits: boolean };
  badConfig: (kind: string, env: Record<string, string>) => { code: number; logs: string };
  /** Health per poll; the last repeats. */
  health: string[];
  stopsWhileStarting: boolean;
  uid: string;
  readonlyRootfs: string;
  write: CommandResult;
  stop: { exits: boolean; code: number };
  failCommand?: string;
  /** psql fails on any input that contains this text. */
  failSql?: string;
  /** `docker rm` fails. */
  failRemove?: boolean;
  responses: Record<string, (init?: RequestInit) => Response>;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const pageHeaders = {
  "content-type": "text/html",
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function scenario(): Scenario {
  return {
    image: [
      {
        Size: 394_100_000,
        Config: {
          User: "node",
          Env: ["PATH=/usr/bin", "NODE_ENV=production", "APP_VERSION=abc1234", "EMPTY="],
          Healthcheck: { Test: ["CMD", "node", "-e", "..."] },
          StopSignal: "SIGTERM",
        },
      },
    ],
    listing: [...REQUIRED_FILES, "/app/node_modules/.bun/pg@8.23.1"],
    migrate: { code: 0, logs: "", exits: true },
    badConfig: (kind) => ({
      code: 1,
      logs: `{"level":"error","message":"startup_failed","error":{"message":"Invalid configuration (1 problem):\\n- ${kind === "missing_secret" ? "BETTER_AUTH_SECRET" : "SES_ENDPOINT"} ..."}}\n`,
    }),
    health: ["starting", "healthy"],
    stopsWhileStarting: false,
    uid: "1000",
    readonlyRootfs: "true",
    write: { code: 1, stdout: "", stderr: "Error: EROFS: read-only file system" },
    stop: { exits: true, code: 0 },
    responses: {
      "/health": () => json({ ok: true, status: "ok" }),
      "/ready": () => json({ ok: true, status: "ready" }),
      "/": () => new Response("<!doctype html><html></html>", { headers: pageHeaders }),
      "/config": () => json({ appName: "App", appVersion: "abc1234" }),
      "/api/auth/sign-in/email": () =>
        json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401),
      "/api/app-auth/session": () => json({ ok: true, data: { session: null } }),
    },
  };
}

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });

class FakeSmoke implements SmokeIo {
  readonly commands: string[] = [];
  readonly inputs: string[] = [];
  readonly logs: string[] = [];
  readonly containers = new Map<string, Container>();
  readonly removed: string[] = [];
  private clock = 0;
  private healthPolls = 0;
  private counter = 0;

  constructor(readonly scene: Scenario = scenario()) {}

  run(command: string, args: readonly string[], input?: string): Promise<CommandResult> {
    const line = [command, ...args].join(" ");
    this.commands.push(line);
    if (input !== undefined) this.inputs.push(input);
    if (this.scene.failCommand !== undefined && line.startsWith(this.scene.failCommand)) {
      return Promise.resolve({ code: 125, stdout: "", stderr: "no such image\n" });
    }
    if (args.includes("psql") && this.scene.failSql !== undefined) {
      if (input?.includes(this.scene.failSql) === true) {
        return Promise.resolve({ code: 3, stdout: "", stderr: "ERROR:  something broke\n" });
      }
    }
    return Promise.resolve(this.answer(args));
  }

  private answer(args: readonly string[]): CommandResult {
    const handler = this.handlers[args[0] ?? ""];
    return handler === undefined ? ok() : handler(args);
  }

  private readonly handlers: Record<string, (args: readonly string[]) => CommandResult> = {
    image: () => ok(JSON.stringify(this.scene.image)),
    run: (args) => this.runContainer(args),
    inspect: (args) => ok(`${this.inspect(args[2] ?? "", args[3] ?? "")}\n`),
    logs: (args) => ok(this.container(args[1] ?? "").logs),
    exec: (args) => this.exec(args),
    kill: (args) => this.kill(args[3] ?? ""),
    rm: (args) => {
      if (this.scene.failRemove === true) {
        return { code: 1, stdout: "", stderr: "Error: cannot remove container\n" };
      }
      this.removed.push(args[2] ?? "");
      return ok();
    },
  };

  private runContainer(args: readonly string[]): CommandResult {
    if (args.includes("none")) return ok(JSON.stringify(this.scene.listing));
    if (args.includes("psql")) return ok();
    return this.start(args);
  }

  private container(name: string): Container {
    const found = this.containers.get(name);
    if (found === undefined) throw new Error(`no container ${name}`);
    return found;
  }

  private start(args: readonly string[]): CommandResult {
    const name = args[args.indexOf("--name") + 1] ?? "";
    const env = Object.fromEntries(
      args.flatMap((arg, index) =>
        args[index - 1] === "-e" ? [arg.split(/=(.*)/s).slice(0, 2)] : [],
      ),
    ) as Record<string, string>;
    const kind = name.slice(name.indexOf("_", "smoke_".length) + 1);
    const container: Container = { kind, env, status: "running", exitCode: 0, logs: "" };
    if (kind === "migrate") {
      const { code, logs, exits } = this.scene.migrate;
      Object.assign(container, {
        status: exits ? "exited" : "running",
        exitCode: code,
        logs:
          logs === ""
            ? `{"message":"migrations_applied","grantedTo":"${env.DATABASE_APP_ROLE ?? ""}"}\n`
            : logs,
      });
    } else if (kind !== "server") {
      const { code, logs } = this.scene.badConfig(kind, env);
      Object.assign(container, { status: "exited", exitCode: code, logs });
    }
    this.containers.set(name, container);
    return ok("container-id\n");
  }

  private inspect(field: string, name: string): string {
    const container = this.container(name);
    if (field === "{{.State.Status}}") {
      return container.kind === "server" && this.scene.stopsWhileStarting
        ? "exited"
        : container.status;
    }
    if (field === "{{.State.ExitCode}}") return String(container.exitCode);
    if (field === "{{.HostConfig.ReadonlyRootfs}}") return this.scene.readonlyRootfs;
    const { health } = this.scene;
    return health[Math.min(this.healthPolls++, health.length - 1)] ?? "";
  }

  private exec(args: readonly string[]): CommandResult {
    const script = args.at(-1) ?? "";
    return script.includes("getuid") ? ok(this.scene.uid) : this.scene.write;
  }

  private kill(name: string): CommandResult {
    const container = this.container(name);
    if (this.scene.stop.exits)
      Object.assign(container, { status: "exited", exitCode: this.scene.stop.code });
    return ok();
  }

  fetch(url: string, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const respond = this.scene.responses[pathname];
    return respond === undefined
      ? Promise.reject(new Error(`unexpected ${url}`))
      : Promise.resolve(respond(init));
  }

  freePort(): Promise<number> {
    return Promise.resolve(4399);
  }

  sleep(ms: number): Promise<void> {
    this.clock += ms;
    return Promise.resolve();
  }

  now(): number {
    return this.clock;
  }

  random(): string {
    this.counter += 1;
    return `${String(this.counter).padStart(2, "0")}${"ab".repeat(15)}`;
  }

  log(line: string): void {
    this.logs.push(line);
  }
}

async function failure(io: FakeSmoke): Promise<string> {
  try {
    await runContainerSmoke(io, options);
  } catch (error) {
    if (error instanceof SmokeFailure) return error.message;
    throw error;
  }
  throw new Error("expected the smoke run to fail");
}

/** The fake with one change to its scenario. */
function fake(change: (scene: Scenario) => void): FakeSmoke {
  const scene = scenario();
  change(scene);
  return new FakeSmoke(scene);
}

describe("runContainerSmoke", () => {
  it("passes every check and removes what it created", async () => {
    const io = new FakeSmoke();

    await runContainerSmoke(io, options);

    expect(io.logs.filter((line) => line.startsWith("ok:"))).toEqual([
      "ok: image app:test, 394.1 MB, version abc1234, runs as node",
      "ok: image contents (5 paths), 1 run-time packages:",
      "ok: migrate up as smoke_05ababababab_owner, granting smoke_05ababababab_app",
      "ok: missing_secret stops the server with one config error line and exit 1, no secret printed",
      "ok: local_email_endpoint stops the server with one config error line and exit 1, no secret printed",
      "ok: the server started as the app role and its HEALTHCHECK reports healthy",
      "ok: /health, /ready, / with strict-transport-security, content-security-policy, x-content-type-options, x-frame-options, referrer-policy, /config abc1234, sign-in, session",
      "ok: runs as uid 1000, with a read-only root filesystem",
      "ok: SIGTERM, exit code 0 after 0 ms",
    ]);
    expect(io.logs).toContain("  pg@8.23.1");
    expect(io.removed.toSorted((left, right) => left.localeCompare(right))).toEqual(
      [...io.containers.keys()].toSorted((left, right) => left.localeCompare(right)),
    );
    expect(io.inputs.slice(-3)).toEqual([
      'drop database if exists "smoke_05ababababab" with (force);\n',
      'drop role if exists "smoke_05ababababab_app";\n',
      'drop role if exists "smoke_05ababababab_owner";\n',
    ]);
    expect(io.logs.some((line) => line.startsWith("cleanup failed"))).toBe(false);
  });

  it("creates the two roles and a database the owner owns", async () => {
    const io = new FakeSmoke();

    await runContainerSmoke(io, options);

    expect(io.inputs.slice(0, 3)).toEqual([
      `create role "smoke_05ababababab_owner" login password '03${"ab".repeat(15)}';\n`,
      `create role "smoke_05ababababab_app" login password '04${"ab".repeat(15)}';\n`,
      'create database "smoke_05ababababab" owner "smoke_05ababababab_owner";\n',
    ]);
  });

  it("migrates as the owner, granting the app role, and runs the server as the app role in production shape", async () => {
    const io = new FakeSmoke();

    await runContainerSmoke(io, options);

    const migrate = io.containers.get("smoke_05ababababab_migrate");
    expect(migrate?.env).toEqual({
      NODE_ENV: "production",
      MIGRATION_DATABASE_URL: `postgres://smoke_05ababababab_owner:03${"ab".repeat(15)}@127.0.0.1:54320/smoke_05ababababab`,
      DATABASE_APP_ROLE: "smoke_05ababababab_app",
    });
    const server = io.containers.get("smoke_05ababababab_server");
    expect(server?.env).toMatchObject({
      APP_URL: "https://app.example.com",
      APP_VARIANT: "production",
      SES_REGION: "zz-smoke-1",
      DATABASE_URL: `postgres://smoke_05ababababab_app:04${"ab".repeat(15)}@127.0.0.1:54320/smoke_05ababababab`,
    });
    expect(server?.env.BETTER_AUTH_SECRET).toHaveLength(32);
    expect(server?.env).not.toHaveProperty("SES_ENDPOINT");
    expect(
      io.commands.find((line) => line.includes("_server") && line.startsWith("docker run")),
    ).toContain("--read-only --cap-drop ALL --security-opt no-new-privileges");
    expect(io.containers.get("smoke_05ababababab_missing_secret")?.env).not.toHaveProperty(
      "BETTER_AUTH_SECRET",
    );
    expect(io.containers.get("smoke_05ababababab_local_email_endpoint")?.env.SES_ENDPOINT).toBe(
      "http://127.0.0.1:8005",
    );
  });

  it.each<[string, (image: { Config: Record<string, unknown> }) => void, string]>([
    ["runs as root", (image) => (image.Config.User = "root"), 'the image runs as "root", not node'],
    ["names no user", (image) => delete image.Config.User, 'the image runs as "", not node'],
    [
      "is not production",
      (image) => (image.Config.Env = []),
      "the image does not set NODE_ENV=production",
    ],
    [
      "has no env",
      (image) => delete image.Config.Env,
      "the image does not set NODE_ENV=production",
    ],
    [
      "has no health check",
      (image) => (image.Config.Healthcheck = null),
      "the image has no HEALTHCHECK",
    ],
    [
      "has an empty health check",
      (image) => (image.Config.Healthcheck = {}),
      "the image has no HEALTHCHECK",
    ],
    [
      "stops with SIGKILL",
      (image) => (image.Config.StopSignal = "SIGKILL"),
      'the image\'s stop signal is "SIGKILL", not SIGTERM',
    ],
    [
      "names no stop signal",
      (image) => delete image.Config.StopSignal,
      'the image\'s stop signal is "", not SIGTERM',
    ],
    [
      "has no version",
      (image) => (image.Config.Env = ["NODE_ENV=production"]),
      "the image has no APP_VERSION: build it with --build-arg APP_VERSION=...",
    ],
  ])("fails when the image %s", async (_what, change, message) => {
    const io = fake((scene) => {
      const [image] = scene.image as Array<{ Config: Record<string, unknown> }>;
      if (image !== undefined) change(image);
    });

    expect(await failure(io)).toBe(message);
  });

  it("fails when there is no such image, with docker's error", async () => {
    const io = fake((scene) => (scene.failCommand = "docker image inspect"));

    expect(await failure(io)).toBe("docker image inspect failed (exit 125): no such image");
  });

  it("fails when docker inspect lists no image", async () => {
    expect(await failure(fake((scene) => (scene.image = [])))).toBe(
      "docker image inspect returned no image",
    );
  });

  it("fails on files the image must not hold, before touching the database", async () => {
    const io = fake((scene) =>
      scene.listing.push("/app/.env", "/app/node_modules/.bun/vitest@5.1.0"),
    );

    expect(await failure(io)).toBe(
      "the image holds what it must not:\n/app/.env: an environment file\nvitest@5.1.0: a development package (vitest)",
    );
    expect(io.inputs).toEqual([]);
  });

  it("fails when migrate fails, and still cleans up", async () => {
    const io = fake(
      (scene) => (scene.migrate = { code: 1, logs: "migrate_failed\n", exits: true }),
    );

    expect(await failure(io)).toBe("migrate up as the owner failed (exit 1):\nmigrate_failed\n");
    expect(io.removed).toEqual(["smoke_05ababababab_migrate"]);
    expect(io.inputs.at(-3)).toContain("drop database");
  });

  it("drops the roles it made when creating the database fails", async () => {
    const io = fake((scene) => (scene.failSql = "create database"));

    expect(await failure(io)).toMatch(
      /^docker run --rm failed \(exit 3\): ERROR: {2}something broke/,
    );
    expect(io.inputs.slice(-2)).toEqual([
      'drop role if exists "smoke_05ababababab_app";\n',
      'drop role if exists "smoke_05ababababab_owner";\n',
    ]);
    expect(io.inputs.join("")).not.toContain("drop database");
  });

  it("reports a failed cleanup without hiding the failure that came first", async () => {
    const io = fake((scene) => {
      scene.migrate = { code: 1, logs: "migrate_failed\n", exits: true };
      scene.failSql = "drop database";
      scene.failRemove = true;
    });

    expect(await failure(io)).toBe("migrate up as the owner failed (exit 1):\nmigrate_failed\n");
    expect(io.logs).toContain(
      "cleanup failed: docker rm -f smoke_05ababababab_migrate failed (exit 1): Error: cannot remove container",
    );
    expect(io.logs.some((line) => line.startsWith("cleanup failed: docker run --rm failed"))).toBe(
      true,
    );
    // The roles are still dropped after the database could not be.
    expect(io.inputs.slice(-2)).toEqual([
      'drop role if exists "smoke_05ababababab_app";\n',
      'drop role if exists "smoke_05ababababab_owner";\n',
    ]);
  });

  it("fails when only the cleanup fails", async () => {
    const io = fake((scene) => (scene.failSql = 'drop role if exists "smoke_05ababababab_app"'));

    expect(await failure(io)).toMatch(/^cleanup failed: docker run --rm failed \(exit 3\)/);
  });

  it("fails when migrate exits 0 without granting the app role", async () => {
    const io = fake(
      (scene) => (scene.migrate = { code: 0, logs: "migrations_applied\n", exits: true }),
    );

    expect(await failure(io)).toBe(
      "migrate up as the owner failed (exit 0):\nmigrations_applied\n",
    );
  });

  it("fails when migrate never exits", async () => {
    const io = fake((scene) => (scene.migrate = { code: 0, logs: "", exits: false }));

    expect(await failure(io)).toBe("migrate did not exit");
  });

  it.each<[string, { code: number; logs: string }, string]>([
    [
      "exits 0",
      { code: 0, logs: "Invalid configuration BETTER_AUTH_SECRET\n" },
      "with missing_secret, the server exited 0, not 1",
    ],
    [
      "prints two lines",
      { code: 1, logs: "Invalid configuration BETTER_AUTH_SECRET\nmore\n" },
      "with missing_secret, the server did not print one config error naming BETTER_AUTH_SECRET:\nInvalid configuration BETTER_AUTH_SECRET\nmore\n",
    ],
    [
      "prints nothing",
      { code: 1, logs: "" },
      "with missing_secret, the server did not print one config error naming BETTER_AUTH_SECRET:\n",
    ],
    [
      "names another variable",
      { code: 1, logs: "Invalid configuration APP_URL\n" },
      "with missing_secret, the server did not print one config error naming BETTER_AUTH_SECRET:\nInvalid configuration APP_URL\n",
    ],
    [
      "is not a config error",
      { code: 1, logs: "crashed BETTER_AUTH_SECRET\n" },
      "with missing_secret, the server did not print one config error naming BETTER_AUTH_SECRET:\ncrashed BETTER_AUTH_SECRET\n",
    ],
  ])("fails when a bad config %s", async (_what, result, message) => {
    expect(await failure(fake((scene) => (scene.badConfig = () => result)))).toBe(message);
  });

  it("fails when a bad config prints a secret", async () => {
    const io = fake(
      (scene) =>
        (scene.badConfig = (_kind, env) => ({
          code: 1,
          logs: `Invalid configuration BETTER_AUTH_SECRET ${env.AWS_SECRET_ACCESS_KEY ?? ""}\n`,
        })),
    );

    expect(await failure(io)).toBe("with missing_secret, the server printed a secret");
  });

  it("fails when the server stops while starting, with its logs", async () => {
    expect(await failure(fake((scene) => (scene.stopsWhileStarting = true)))).toBe(
      "the server stopped while starting:\n",
    );
  });

  it("fails when the server never reports healthy", async () => {
    expect(await failure(fake((scene) => (scene.health = ["starting"])))).toBe(
      "the server's health check did not pass:\n",
    );
  });

  it.each<[string, string, (init?: RequestInit) => Response, string]>([
    [
      "/health fails",
      "/health",
      () => json({ ok: false }, 500),
      'GET http://127.0.0.1:4399/health answered 500, not 200: {"ok":false}',
    ],
    [
      "/ready fails",
      "/ready",
      () => json({ ok: false }, 503),
      'GET http://127.0.0.1:4399/ready answered 503, not 200: {"ok":false}',
    ],
    [
      "/ is not the web app",
      "/",
      () => new Response("not found", { status: 404 }),
      "/ answered 404 without the web app",
    ],
    [
      "/ is not HTML",
      "/",
      () => new Response("{}", { headers: pageHeaders }),
      "/ answered 200 without the web app",
    ],
    [
      "/ lacks headers",
      "/",
      () =>
        new Response("<!DOCTYPE html>", {
          headers: { "content-security-policy": "x", "x-frame-options": "DENY" },
        }),
      "/ lacks strict-transport-security, x-content-type-options, referrer-policy",
    ],
    [
      "/config reports another version",
      "/config",
      () => json({ appVersion: "0.0.0" }),
      "/config reports 0.0.0, not abc1234",
    ],
    [
      "sign-in is not refused",
      "/api/auth/sign-in/email",
      () => json({ code: "OTHER" }, 401),
      'sign-in answered {"code":"OTHER"}',
    ],
    [
      "sign-in fails",
      "/api/auth/sign-in/email",
      () => json({ message: "boom" }, 500),
      'POST http://127.0.0.1:4399/api/auth/sign-in/email answered 500, not 401: {"message":"boom"}',
    ],
    [
      "the session route answers otherwise",
      "/api/app-auth/session",
      () => json({ ok: false }),
      "the session route did not answer",
    ],
  ])("fails when %s", async (_what, route, respond, message) => {
    expect(await failure(fake((scene) => (scene.responses[route] = respond)))).toBe(message);
  });

  it("signs in with the app's origin, as a browser would", async () => {
    let sent: RequestInit | undefined;
    const io = fake(
      (scene) =>
        (scene.responses["/api/auth/sign-in/email"] = (init) => {
          sent = init;
          return json({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401);
        }),
    );

    await runContainerSmoke(io, options);

    expect(sent?.method).toBe("POST");
    expect(sent?.headers).toEqual({
      origin: "https://app.example.com",
      "content-type": "application/json",
    });
  });

  it.each<[string, (scene: Scenario) => void, string]>([
    ["runs as root", (scene) => (scene.uid = "0"), "the server runs as root"],
    [
      "has a writable root",
      (scene) => (scene.readonlyRootfs = "false"),
      "the root filesystem is writable",
    ],
    [
      "can write a file",
      (scene) => (scene.write = ok()),
      "the container could write to its filesystem",
    ],
    [
      "fails to write for another reason",
      (scene) => (scene.write = { code: 1, stdout: "", stderr: "EACCES" }),
      "the container could write to its filesystem",
    ],
    [
      "does not stop on SIGTERM",
      (scene) => (scene.stop = { exits: false, code: 0 }),
      "the server did not exit within 5000 ms of SIGTERM",
    ],
    [
      "exits 1 after SIGTERM",
      (scene) => (scene.stop = { exits: true, code: 1 }),
      "the server exited 1 after SIGTERM, not 0:\n",
    ],
  ])("fails when the server %s", async (_what, change, message) => {
    expect(await failure(fake(change))).toBe(message);
  });
});

describe("parseImageInfo", () => {
  it("reads the user, environment, size, health check and stop signal", () => {
    expect(parseImageInfo(JSON.stringify(scenario().image))).toEqual({
      user: "node",
      env: { PATH: "/usr/bin", NODE_ENV: "production", APP_VERSION: "abc1234", EMPTY: "" },
      size: 394_100_000,
      healthcheck: true,
      stopSignal: "SIGTERM",
    });
  });
});

describe("roleUrl", () => {
  it("puts the role, its password and the database on the admin URL's host", () => {
    expect(roleUrl(ADMIN_URL, "owner", "pw", "db")).toBe("postgres://owner:pw@127.0.0.1:54320/db");
  });
});

describe("postgresImageOf", () => {
  it("reads the compose file's Postgres image", () => {
    expect(postgresImageOf("services:\n  postgres:\n    image: postgres:18.7\n")).toBe(
      "postgres:18.7",
    );
  });

  it("fails when there is none", () => {
    expect(() => postgresImageOf("services: {}\n")).toThrow(
      "docker-compose.local.yml names no postgres image",
    );
  });
});

function commandIo(env: Record<string, string | undefined>) {
  const errors: string[] = [];
  const smoke = new FakeSmoke();
  return {
    io: {
      smoke,
      env,
      compose: "    image: postgres:18.7\n",
      error: (line: string) => errors.push(line),
    },
    smoke,
    errors,
  };
}

describe("containerSmokeCommand", () => {
  it("smokes s10n-base:local by default, with DATABASE_URL as the admin, exit 0", async () => {
    const { io, smoke, errors } = commandIo({ DATABASE_URL: ADMIN_URL });
    (smoke.scene.image as Array<{ Config: { Env: string[] } }>)[0]?.Config.Env.push("X=1");

    expect(await containerSmokeCommand([], io)).toBe(0);
    expect(smoke.commands[0]).toBe("docker image inspect s10n-base:local");
    expect(smoke.commands).toContain(
      `docker run --rm -i --network host postgres:18.7 psql -v ON_ERROR_STOP=1 -q ${ADMIN_URL}`,
    );
    expect(smoke.logs.at(-1)).toBe("docker:smoke passed");
    expect(errors).toEqual([]);
  });

  it("smokes the image it is given", async () => {
    const { io, smoke } = commandIo({ DATABASE_URL: ADMIN_URL });

    expect(await containerSmokeCommand(["other:tag"], io)).toBe(0);
    expect(smoke.commands[0]).toBe("docker image inspect other:tag");
  });

  it.each([
    [
      [],
      { DATABASE_URL: "" },
      "docker:smoke failed: DATABASE_URL is not set: it names the local Postgres",
    ],
    [[], {}, "docker:smoke failed: DATABASE_URL is not set: it names the local Postgres"],
    [["a", "b"], { DATABASE_URL: ADMIN_URL }, "docker:smoke failed: Usage: docker:smoke [image]"],
  ])("fails with %j and %j, exit 1", async (argv, env, message) => {
    const { io, errors } = commandIo(env);

    expect(await containerSmokeCommand(argv, io)).toBe(1);
    expect(errors).toEqual([message]);
  });
});

describe("nodeSmokeIo", () => {
  const lines: string[] = [];
  const io = nodeSmokeIo((line) => lines.push(line));

  it("runs a command with input and returns its code and output", async () => {
    expect(
      await io.run(
        "node",
        ["-e", "process.stdin.pipe(process.stdout); console.error('err')"],
        "in",
      ),
    ).toEqual({ code: 0, stdout: "in", stderr: "err\n" });
    expect(await io.run("node", ["-e", "process.exit(3)"])).toMatchObject({ code: 3 });
  });

  it("reports the exit code of a command that exits without reading its input", async () => {
    // Writing the input then fails with EPIPE, which is the command's choice, not an error.
    expect(
      await io.run("node", ["-e", "process.exit(3)"], "x".repeat(4 * 1024 * 1024)),
    ).toMatchObject({
      code: 3,
    });
  });

  it("reports a command a signal ended as exit 1, and rejects one that cannot start", async () => {
    expect(await io.run("node", ["-e", "process.kill(process.pid, 'SIGKILL')"])).toMatchObject({
      code: 1,
    });
    await expect(io.run("no-such-command-anywhere", [])).rejects.toThrow(/ENOENT/);
  });

  it("fetches, finds a free port, sleeps, reads the clock, makes random hex and logs", async () => {
    const server = http.createServer((_request, response) => response.end("pong"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      expect(await (await io.fetch(`http://127.0.0.1:${String(port)}/`)).text()).toBe("pong");
    } finally {
      server.close();
    }
    expect(await io.freePort()).toBeGreaterThan(0);
    const before = io.now();
    await io.sleep(5);
    expect(io.now()).toBeGreaterThanOrEqual(before);
    expect(io.random()).toMatch(/^[0-9a-f]{32}$/);
    io.log("a line");
    expect(lines).toEqual(["a line"]);
  });
});

describe("nodeCommandIo", () => {
  it("reads the repository's compose file and the process's environment", () => {
    const io = nodeCommandIo(path.resolve(import.meta.dirname, "../.."));

    expect(postgresImageOf(io.compose)).toMatch(/^postgres:18\./);
    expect(io.env).toBe(process.env);
  });
});
