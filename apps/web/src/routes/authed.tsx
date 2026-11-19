import { createRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { useSession } from "@s10n-base/client/session";

import { Loading } from "../components/RouteStates";
import { requireSession } from "./guards";
import { rootRoute } from "./root";

/**
 * Every page that needs a signed-in user sits under this layout. The guard checks on navigation;
 * the component follows the session afterwards, so a session that ends while a page is open
 * (signed out in another tab, or expired) leaves the page at once.
 *
 * It does not navigate itself: it asks the router to run the guards again, which redirect from
 * the location they matched. Building the target here would read the location of a navigation
 * already under way (to `/sign-in` after signing out) and send the user to
 * `/sign-in?redirect=/sign-in`, again and again.
 */
function SignedInLayout() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session === null) void router.invalidate();
  }, [session, router]);
  if (!session) return <Loading />;
  return <Outlet />;
}

export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "signed-in",
  beforeLoad: ({ context, location }) => requireSession(context, location.href),
  component: SignedInLayout,
});
