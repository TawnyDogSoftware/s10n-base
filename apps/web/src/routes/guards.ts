/**
 * `beforeLoad` guards. They read the session through the gate, so a guard and the screens agree
 * on who is signed in.
 */
import { redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSession } from "@s10n-base/client/session";

import type { AppSession } from "@s10n-base/contracts";

import { safeRedirect } from "../lib/redirect";
import type { WebServices } from "../services";

export interface RouterContext {
  readonly services: WebServices;
}

/**
 * For pages that need a signed-in user. Anyone else goes to `/sign-in`, which brings them back
 * to `href` afterwards.
 *
 * @throws a redirect to `/sign-in?redirect=<href>` when no one is signed in.
 */
export async function requireSession(
  context: RouterContext,
  href: string,
): Promise<{ readonly session: AppSession }> {
  const session = await context.services.gate.ensure();
  if (session === null) {
    throw redirect({ to: "/sign-in", search: href === "/" ? {} : { redirect: href } });
  }
  return { session };
}

/**
 * For the sign-in, sign-up and forgot-password pages: someone already signed in goes on to the
 * safe `redirect` target, or home.
 *
 * @throws a redirect when someone is signed in.
 */
export async function redirectSignedIn(context: RouterContext, target: unknown): Promise<void> {
  const session = await context.services.gate.ensure();
  if (session !== null) {
    throw redirect({ href: safeRedirect(target) ?? "/", replace: true });
  }
}

/**
 * For the pages {@link redirectSignedIn} guards: when a session appears while one is open (signed
 * in in another tab), the router runs the guard again, which sends the user on. As the signed-in
 * layout does, it does not navigate itself, so the guard decides from the location it matched.
 */
export function useLeaveWhenSignedIn(): void {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session) void router.invalidate();
  }, [session, router]);
}
