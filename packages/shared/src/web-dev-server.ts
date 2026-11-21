/**
 * Where the web app's Vite dev server listens, kept apart from where the browser reaches it.
 * `APP_URL` is the browser's address. When it is plain http (the computer itself, or its address
 * on the local network), Vite listens on that host and port. When it is https, something else
 * ends TLS in front of Vite (a forwarder on a private network), so Vite listens on
 * 127.0.0.1:5173 and the forwarder points there. `WEB_DEV_HOST` and `WEB_DEV_PORT` override
 * either. This file imports nothing, so the Vite config can load it as it is.
 */

export interface WebDevServer {
  readonly host: string;
  readonly port: number;
  /** The host names Vite answers besides IP addresses and localhost: `APP_URL`'s. */
  readonly allowedHosts: readonly string[];
}

const BEHIND_TLS = { host: "127.0.0.1", port: 5173 } as const;

/** A port number from 1 to 65535. @throws {Error} naming the variable otherwise. */
function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new Error(`WEB_DEV_PORT must be a port number from 1 to 65535, not ${value}.`);
  }
  return port;
}

/** Where to listen, from `APP_URL`, `WEB_DEV_HOST` and `WEB_DEV_PORT`. */
export function webDevServer(env: Readonly<Record<string, string | undefined>>): WebDevServer {
  const appUrl = new URL(env.APP_URL?.trim() || "http://localhost:5173");
  const direct =
    appUrl.protocol === "http:"
      ? { host: appUrl.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(appUrl.port || "80") }
      : BEHIND_TLS;
  const port = env.WEB_DEV_PORT?.trim() ?? "";
  return {
    host: env.WEB_DEV_HOST?.trim() || direct.host,
    port: port === "" ? direct.port : parsePort(port),
    allowedHosts: [appUrl.hostname],
  };
}
