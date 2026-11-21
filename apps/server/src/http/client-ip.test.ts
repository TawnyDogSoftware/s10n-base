import { describe, expect, it } from "vitest";

import { resolveClientIp } from "./client-ip";

function request(remoteAddress: string | undefined, forwardedFor?: string | string[]) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  };
}

describe("resolveClientIp", () => {
  it("uses the socket address when no proxy is trusted, ignoring X-Forwarded-For", () => {
    expect(resolveClientIp(request("203.0.113.9", "192.0.2.4"), 0)).toBe("203.0.113.9");
  });

  it("takes the entry the trusted proxy added: the rightmost for one hop", () => {
    expect(resolveClientIp(request("198.51.100.2", "192.0.2.4, 198.51.100.7"), 1)).toBe(
      "198.51.100.7",
    );
  });

  it("takes the entry that many hops from the right, never the leftmost", () => {
    expect(
      resolveClientIp(request("198.51.100.2", "192.0.2.66, 198.51.100.7, 198.51.100.1"), 2),
    ).toBe("198.51.100.7");
  });

  it("ignores text the client wrote left of the trusted entries", () => {
    expect(resolveClientIp(request("198.51.100.2", "junk, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(resolveClientIp(request("198.51.100.2", "junk, 198.51.100.7, 203.0.113.9"), 2)).toBe(
      "198.51.100.7",
    );
  });

  it("joins repeated headers in order", () => {
    expect(resolveClientIp(request("198.51.100.2", ["192.0.2.66", "198.51.100.7"]), 1)).toBe(
      "198.51.100.7",
    );
  });

  it("accepts IPv6 entries", () => {
    expect(resolveClientIp(request("198.51.100.2", "2001:db8::1"), 1)).toBe("2001:db8::1");
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["fewer entries than hops", "198.51.100.7"],
    ["an entry that is not an address", "192.0.2.4, unknown"],
    ["an empty entry", "192.0.2.4,,"],
  ])("falls back to the socket address on %s", (_case, header) => {
    expect(resolveClientIp(request("198.51.100.2", header), 2)).toBe("198.51.100.2");
  });

  it("shows an IPv4-mapped socket address as plain IPv4", () => {
    const client = "203.0.113.9";
    expect(resolveClientIp(request(`::ffff:${client}`), 0)).toBe(client);
  });

  it("returns undefined when the socket has no address", () => {
    expect(resolveClientIp(request(undefined), 0)).toBeUndefined();
  });
});
