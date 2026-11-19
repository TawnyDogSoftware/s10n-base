import type { IncomingMessage } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { createSessionActorResolver } from "./session-actor";

const session = {
  userId: "u1",
  email: "user@example.com",
  name: "User",
  image: null,
  role: "admin" as const,
  emailVerified: true,
};

describe("createSessionActorResolver", () => {
  it("is the signed-in user with their role, looked up from the request's cookie", async () => {
    const getSession = vi.fn((_headers: Headers) => Promise.resolve(session));
    const resolve = createSessionActorResolver({ getSession });

    const actor = await resolve({
      headers: { cookie: "s10n-base.session_token=t" },
    } as IncomingMessage);

    expect(actor).toEqual({ kind: "user", userId: "u1", role: "admin" });
    expect(getSession.mock.calls[0]?.[0].get("cookie")).toBe("s10n-base.session_token=t");
  });

  it("is anonymous without a session or without a request", async () => {
    const getSession = vi.fn(() => Promise.resolve(null));
    const resolve = createSessionActorResolver({ getSession });

    expect(await resolve({ headers: {} } as IncomingMessage)).toEqual({ kind: "anonymous" });
    expect(await resolve(undefined)).toEqual({ kind: "anonymous" });
    expect(getSession).toHaveBeenCalledOnce();
  });
});
