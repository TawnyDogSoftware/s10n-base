/**
 * Every route Better Auth serves, each one either exposed at `/api/auth` or deliberately not,
 * with the reason. The route guard admits only exposed routes. A test fails when Better Auth
 * serves a route that is on neither list, so an upgrade that adds an endpoint forces a decision,
 * and when a listed route no longer exists.
 *
 * To expose a route, move it to `EXPOSED_AUTH_ROUTES` with the reason a client needs it.
 */
export interface AuthRouteDecision {
  readonly method: string;
  readonly path: string;
  readonly reason: string;
}

const route = (method: string, path: string, reason: string): AuthRouteDecision => ({
  method,
  path,
  reason,
});

export const EXPOSED_AUTH_ROUTES: readonly AuthRouteDecision[] = [
  route("POST", "/sign-up/email", "Sign up with email and password."),
  route("POST", "/sign-in/email", "Sign in with email and password."),
  route("POST", "/sign-out", "Sign out."),
  route("GET", "/get-session", "The Better Auth client reads the session here."),
  route("GET", "/verify-email", "The web app's /verify-email page sends the email's token here."),
  route("POST", "/send-verification-email", "Send the verification email again."),
  route("POST", "/request-password-reset", "Ask for a password reset email."),
  route("POST", "/reset-password", "The web app's /reset-password page sets the new password."),
  route("POST", "/change-password", "Change the password while signed in."),
  route("POST", "/update-user", "Change the name and image while signed in."),
  route("GET", "/list-sessions", "List the signed-in user's sessions."),
  route("POST", "/revoke-session", "End one of the signed-in user's sessions."),
  route("POST", "/revoke-sessions", "End all of the signed-in user's sessions."),
  route("POST", "/revoke-other-sessions", "End the signed-in user's other sessions."),
  route("GET", "/passkey/generate-register-options", "Start adding a passkey."),
  route("POST", "/passkey/verify-registration", "Finish adding a passkey."),
  route("GET", "/passkey/generate-authenticate-options", "Start signing in with a passkey."),
  route("POST", "/passkey/verify-authentication", "Finish signing in with a passkey."),
  route("GET", "/passkey/list-user-passkeys", "List the signed-in user's passkeys."),
  route("POST", "/passkey/update-passkey", "Rename a passkey."),
  route("POST", "/passkey/delete-passkey", "Remove a passkey."),
  route("GET", "/admin/list-users", "Admins: list users."),
  route("GET", "/admin/get-user", "Admins: read one user."),
  route("POST", "/admin/set-role", "Admins: change a user's role."),
  route("POST", "/admin/ban-user", "Admins: ban a user, which also ends their sessions."),
  route("POST", "/admin/unban-user", "Admins: lift a ban."),
  route("POST", "/admin/list-user-sessions", "Admins: list a user's sessions."),
  route("POST", "/admin/revoke-user-session", "Admins: end one of a user's sessions."),
  route("POST", "/admin/revoke-user-sessions", "Admins: end all of a user's sessions."),
  route("POST", "/admin/has-permission", "Admins: check a permission."),
];

export const UNEXPOSED_AUTH_ROUTES: readonly AuthRouteDecision[] = [
  route("POST", "/get-session", "The client uses GET; one method is enough."),
  route(
    "GET",
    "/reset-password/:token",
    "Reset emails link to the web app's /reset-password page, which posts the token itself.",
  ),
  route("POST", "/sign-in/social", "No social sign-in in the base (a documented recipe)."),
  route("GET", "/callback/:id", "OAuth callback; no social sign-in in the base."),
  route("POST", "/callback/:id", "OAuth callback; no social sign-in in the base."),
  route("POST", "/link-social", "No social sign-in in the base."),
  route(
    "GET",
    "/list-accounts",
    "Lists linked sign-in providers; nothing to link without social sign-in.",
  ),
  route("POST", "/unlink-account", "No social sign-in in the base."),
  route("POST", "/refresh-token", "OAuth provider tokens; no social sign-in in the base."),
  route("POST", "/get-access-token", "OAuth provider tokens; no social sign-in in the base."),
  route("GET", "/account-info", "OAuth provider profile; no social sign-in in the base."),
  route("GET", "/expo-authorization-proxy", "Used by social sign-in on Expo; none in the base."),
  route(
    "POST",
    "/change-email",
    "Changing the email address is left out of the base (plan 000, section 7).",
  ),
  route(
    "POST",
    "/delete-user",
    "Account deletion needs product-specific cleanup; left out of the base.",
  ),
  route("GET", "/delete-user/callback", "Account deletion is left out of the base."),
  route("POST", "/verify-password", "Not used by any flow in the base."),
  route("POST", "/update-session", "Sessions have no fields a client may change."),
  route("POST", "/admin/create-user", "Users sign up and verify their address themselves."),
  route(
    "POST",
    "/admin/update-user",
    "Lets an admin change any field, the email included; add a guarded RPC instead.",
  ),
  route(
    "POST",
    "/admin/set-user-password",
    "An admin should not know a user's password; users reset their own.",
  ),
  route(
    "POST",
    "/admin/impersonate-user",
    "Impersonation is off until a project decides it needs it and how to audit it.",
  ),
  route("POST", "/admin/stop-impersonating", "Impersonation is off."),
  route("GET", "/ok", "Better Auth's health check; the server has /health."),
  route("GET", "/error", "Better Auth's HTML error page for OAuth redirects; not used."),
];
