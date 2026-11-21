import { isIP, isIPv4 } from "node:net";

interface ClientIpRequest {
  readonly socket: { readonly remoteAddress?: string | undefined };
  readonly headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>;
}

const IPV4_MAPPED_PREFIX = "::ffff:";

function plain(address: string): string {
  const mapped = address.slice(IPV4_MAPPED_PREFIX.length);
  return address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) && isIPv4(mapped) ? mapped : address;
}

/**
 * The client's IP address. With no trusted proxy (`hops` 0) it is the socket's peer. Behind
 * `hops` proxies, each proxy appends the address it received the request from to
 * `X-Forwarded-For`, so the client is the entry `hops` places from the right; anything further
 * left was written by the client and is never read. A header that is missing or too short, or
 * whose trusted entries hold something that is not an address, falls back to the socket's peer.
 */
export function resolveClientIp(request: ClientIpRequest, hops: number): string | undefined {
  const peer = request.socket.remoteAddress;
  const fallback = peer === undefined ? undefined : plain(peer);
  if (hops === 0) return fallback;

  const raw = request.headers["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw.join(",") : (raw as string | undefined);
  if (header === undefined || header.trim() === "") return fallback;
  const entries = header.split(",").map((entry) => entry.trim());
  // The entry the outermost trusted proxy added, counting from the right; only the entries the
  // trusted proxies added are checked.
  const entry = entries.length < hops ? undefined : entries[entries.length - hops];
  const trusted = entries.slice(-hops);
  if (entry === undefined || trusted.some((item) => isIP(item) === 0)) return fallback;
  return plain(entry);
}
