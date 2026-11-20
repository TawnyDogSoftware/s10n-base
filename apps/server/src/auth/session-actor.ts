import { toFetchHeaders } from "../http/fetch-bridge";
import type { Actor, ActorResolver } from "../rpc/dispatcher";
import type { AppAuth } from "./instance";

const anonymous: Actor = { kind: "anonymous" };

/**
 * The RPC caller from the request's session cookie: a signed-in user with their role and session
 * row, or anonymous when there is no valid session, it has expired, or the user is banned.
 */
export function createSessionActorResolver(auth: Pick<AppAuth, "getSession">): ActorResolver {
  return async (request) => {
    if (request === undefined) return anonymous;
    const signedIn = await auth.getSession(toFetchHeaders(request.headers));
    if (signedIn === null) return anonymous;
    const { session, sessionId } = signedIn;
    return { kind: "user", userId: session.userId, role: session.role, sessionId };
  };
}
