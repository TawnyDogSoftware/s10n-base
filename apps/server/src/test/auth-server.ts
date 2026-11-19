/**
 * A running server for live auth tests: a migrated fixture schema, the local SES capture server
 * in-process, and the real HTTP surface on a free loopback port, with `APP_URL` set to that
 * address so the links in emails point back at it.
 */
import net from "node:net";

import { Redacted } from "effect";

import {
  startSesLocal,
  type SesLocal,
  type StoredEmail,
} from "../../../../scripts/ses-local/server";
import type { ServerConfig } from "../config";
import { createPool } from "../infra/postgres/pool";
import type { RpcHandler } from "../rpc/dispatcher";
import { startServer, type StartedServer } from "../server";
import { createMigratedSchema, type MigratedSchema } from "./auth-database";
import { testServerConfig } from "./config";

export interface AuthServer {
  readonly base: string;
  readonly server: StartedServer;
  readonly ses: SesLocal;
  readonly schema: MigratedSchema;
  /** Emails captured so far for `to`, oldest first. */
  readonly emailsTo: (to: string) => Promise<StoredEmail[]>;
  readonly stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export async function startAuthServer(
  options: {
    readonly handlers?: ReadonlyArray<RpcHandler>;
    readonly config?: Partial<ServerConfig>;
  } = {},
): Promise<AuthServer> {
  const schema = await createMigratedSchema();
  const ses = await startSesLocal({ host: "127.0.0.1", port: 0 });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const defaults = testServerConfig();
  const config = testServerConfig({
    appOrigin: base,
    port,
    databaseUrl: Redacted.make(schema.fixture.url),
    databasePoolMax: 4,
    // Each test sends its own X-Forwarded-For, so rate limits do not carry between tests.
    trustedProxyHops: 1,
    requestBodyLimitBytes: 64 * 1024,
    logLevel: "error",
    email: { ...defaults.email, ses: { ...defaults.email.ses, endpoint: ses.url } },
    ...options.config,
  });
  let server: StartedServer;
  try {
    server = await startServer(config, {
      write: () => {},
      createPool: (_config, logger) =>
        createPool({
          connectionString: schema.fixture.url,
          max: 4,
          searchPath: schema.fixture.schema,
          onIdleError: (error) => {
            logger.warn("database_idle_connection_failed", { error });
          },
        }),
      ...(options.handlers ? { handlers: options.handlers } : {}),
    });
  } catch (error) {
    await ses.stop();
    await schema.drop();
    throw error;
  }
  return {
    base,
    server,
    ses,
    schema,
    emailsTo: (to) =>
      Promise.resolve(ses.emails().filter((email) => email.destination.to.includes(to))),
    stop: async () => {
      await server.stop();
      await ses.stop();
      await schema.drop();
    },
  };
}

/** The first http(s) link in an email's text. */
export function linkIn(email: StoredEmail | undefined): string {
  const link = /https?:\/\/\S+/.exec(email?.body.text ?? "")?.[0];
  if (link === undefined) throw new Error("The email has no link.");
  return link;
}

/** The `token` of the link in an email, as the web page that the link opens reads it. */
export function tokenIn(email: StoredEmail | undefined): string {
  const token = new URL(linkIn(email)).searchParams.get("token");
  if (token === null) throw new Error("The email's link has no token.");
  return token;
}

/**
 * Does what the web app's `/verify-email` page does with the link in a verification email: sends
 * its token to Better Auth.
 */
export function verifyPath(email: StoredEmail | undefined): string {
  return `/api/auth/verify-email?token=${encodeURIComponent(tokenIn(email))}`;
}

/**
 * A browser-like client: it keeps cookies, sends `Origin` like a browser on the app's page, and
 * comes from its own address (through `X-Forwarded-For`), so rate limits stay per client.
 */
export class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly base: string,
    readonly ip: string,
    private readonly origin: string | undefined = base,
  ) {}

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /** Copies another client's cookies, to act as a second tab of the same browser. */
  copyCookiesFrom(other: TestClient): void {
    for (const part of other.cookieHeader().split("; ").filter(Boolean)) {
      const [name = "", value = ""] = part.split(/=(.*)/s);
      this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const response = await fetch(path.startsWith("http") ? path : `${this.base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        "x-forwarded-for": this.ip,
        ...(this.origin === undefined ? {} : { origin: this.origin }),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const [name = "", value = ""] = pair.split(/=(.*)/s);
      if (value === "" || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request("GET", path, undefined, headers);
  }

  post(path: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request("POST", path, body, headers);
  }

  async session() {
    const response = await this.get("/api/app-auth/session");
    return ((await response.json()) as { data: { session: unknown } }).data.session;
  }
}
