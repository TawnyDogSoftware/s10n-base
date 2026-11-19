import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import type { AppAuth } from "./instance";
import { createSessionActorResolver } from "./session-actor";

const session = {
  userId: "u1",
  email: "user@example.com",
  name: "User",
  image: null,
  role: "admin" as const,
  emailVerified: true,
};

function requestWith(headers: IncomingMessage["headers"]): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  request.headers = headers;
  return request;
}

describe("createSessionActorResolver", () => {
  it("is the signed-in user with their role, looked up from the request's cookie", async () => {
    const getSession = vi.fn<AppAuth["getSession"]>(() => Promise.resolve(session));
    const resolve = createSessionActorResolver({ getSession });

    const actor = await resolve(requestWith({ cookie: "s10n-base.session_token=t" }));

    expect(actor).toEqual({ kind: "user", userId: "u1", role: "admin" });
    expect(getSession.mock.calls[0]?.[0].get("cookie")).toBe("s10n-base.session_token=t");
  });

  it("is anonymous without a session or without a request", async () => {
    const getSession = vi.fn<AppAuth["getSession"]>(() => Promise.resolve(null));
    const resolve = createSessionActorResolver({ getSession });

    expect(await resolve(requestWith({}))).toEqual({ kind: "anonymous" });
    expect(await resolve(undefined)).toEqual({ kind: "anonymous" });
    expect(getSession).toHaveBeenCalledOnce();
  });
});
