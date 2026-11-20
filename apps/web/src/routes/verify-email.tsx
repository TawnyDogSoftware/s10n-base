import { createRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageKey } from "@s10n-base/client/messages";
import type { ErrorMessageKey } from "@s10n-base/i18n";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";

import { EmailForm } from "../components/EmailForm";
import { UnknownOutcome } from "../components/UnknownOutcome";
import { Button, Card, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { rootRoute } from "./root";

type State =
  | { readonly kind: "pending" }
  | { readonly kind: "verified" }
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  /** Not an answer about the link (a rate limit, a server error, an exception): retry it. */
  | { readonly kind: "failed"; readonly message: ErrorMessageKey }
  | { readonly kind: "unknown"; readonly outcome: SettledAction<AuthResult> };

/** Refusals that say the link itself is dead: used, expired or never valid. */
const DEAD_LINK = new Set(["INVALID_TOKEN", "TOKEN_EXPIRED"]);

/** What the page shows after the verification settled. */
function stateAfter(result: SettledAction<AuthResult>): State {
  if (result.kind === "unknown") return { kind: "unknown", outcome: result };
  if (result.value.ok) return { kind: "verified" };
  if (DEAD_LINK.has(result.value.code)) return { kind: "invalid" };
  return { kind: "failed", message: errorMessageKey(result.value) };
}

/** Asks for a new verification link, answering the same way whether or not the address exists. */
function Resend() {
  const { t } = useTranslation("auth");
  const { t: tError } = useTranslation("errors");
  const { auth } = useServices();
  const [pending, run] = usePending();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <EmailForm
        submitLabel={t("verifyEmail.resendSubmit")}
        pendingLabel={t("checkEmail.resending")}
        pending={pending}
        onSubmit={(email) =>
          void run(async () => {
            setMessage(null);
            try {
              const result = await auth.sendVerificationEmail(email);
              setMessage(
                result.ok || result.code !== "RATE_LIMITED"
                  ? { tone: "success", text: t("checkEmail.resent") }
                  : { tone: "danger", text: tError(errorMessageKey(result)) },
              );
            } catch (error) {
              // A lost answer, or anything else that went wrong: say which, as the other screens do.
              setMessage({ tone: "danger", text: tError(errorMessageKey(error)) });
            }
          })
        }
      />
      {message === null ? null : <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

/** The page for one link: a new token in the address starts it again, clean. */
function VerifyEmailPage() {
  const { token } = verifyEmailRoute.useSearch();
  return <VerifyEmail key={token ?? ""} token={token} />;
}

function VerifyEmail(props: { readonly token: string | undefined }) {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const { token } = props;
  const [state, setState] = useState<State>(
    token === undefined ? { kind: "missing" } : { kind: "pending" },
  );
  const started = useRef<string | null>(null);

  const verify = useCallback(
    async (value: string) => {
      setState({ kind: "pending" });
      let result: SettledAction<AuthResult>;
      try {
        result = await gate.settle(() => auth.verifyEmail(value));
      } catch (error) {
        // Something the page did not expect: say so and offer a retry, never wait forever.
        console.error(error);
        setState({ kind: "failed", message: "generic" });
        return;
      }
      setState(stateAfter(result));
    },
    [auth, gate],
  );

  useEffect(() => {
    // Once per token, also under React's development double effects.
    if (token === undefined || started.current === token) return;
    started.current = token;
    void verify(token);
  }, [token, verify]);

  switch (state.kind) {
    case "pending":
      return (
        <PageShell title={t("verifyEmail.pending")}>
          <output className="text-muted block">{tCommon("loading")}</output>
        </PageShell>
      );
    case "verified":
      return (
        <PageShell focus title={t("verifyEmail.successTitle")} intro={t("verifyEmail.successBody")}>
          <Link to="/sign-in" className={linkClass}>
            {t("verifyEmail.continue")}
          </Link>
        </PageShell>
      );
    case "unknown":
      return (
        <PageShell title={t("verifyEmail.pending")}>
          <UnknownOutcome
            session={state.outcome.session}
            signedInText={tCommon("unknownOutcome.nowSignedIn")}
          />
          <div>
            <Button onClick={() => token !== undefined && void verify(token)}>
              {tCommon("routeError.retry")}
            </Button>
          </div>
        </PageShell>
      );
    case "failed":
      return (
        <PageShell title={tCommon("routeError.title")}>
          <Notice tone="danger">{tError(state.message)}</Notice>
          <div>
            <Button onClick={() => token !== undefined && void verify(token)}>
              {tCommon("routeError.retry")}
            </Button>
          </div>
        </PageShell>
      );
    case "invalid":
    case "missing": {
      const title =
        state.kind === "invalid" ? t("verifyEmail.invalidTitle") : t("verifyEmail.missingTitle");
      const body =
        state.kind === "invalid" ? t("verifyEmail.invalidBody") : t("verifyEmail.missingBody");
      return (
        <PageShell title={title} intro={body}>
          <Card>
            <Resend />
          </Card>
        </PageShell>
      );
    }
  }
}

export const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const token = optionalString(search.token);
    return token === undefined ? {} : { token };
  },
  component: VerifyEmailPage,
});
