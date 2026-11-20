/**
 * The local SES capture server's address: what `SES_ENDPOINT` may be outside production, and
 * where `bun run ses:local` listens. The server's config and the capture server both read it
 * here, so an endpoint the config accepts is always one the capture server can listen on.
 */
import { parseBareOrigin } from "./origin";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface CaptureEndpoint {
  /** The endpoint as an origin, such as `http://127.0.0.1:8005`. */
  readonly origin: string;
  /** The host to listen on, without an IPv6 address's brackets. */
  readonly host: string;
  readonly port: number;
}

/**
 * The capture server's address when `value` is a bare http origin on a loopback host with an
 * explicit port (`http://127.0.0.1:8005`); null otherwise. A default port (`:80`) is not explicit:
 * a URL drops it, and listening there needs privileges.
 */
export function parseCaptureEndpoint(value: string): CaptureEndpoint | null {
  const url = parseBareOrigin(value);
  if (url === null || url.protocol !== "http:" || url.port === "") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  return {
    origin: url.origin,
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(url.port),
  };
}
