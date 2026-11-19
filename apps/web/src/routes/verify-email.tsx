import { createRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";
import { NetworkError } from "@s10n-base/client/rpc";

import { EmailForm } from "../components/EmailForm";
import { UnknownOutcome } from "../components/UnknownOutcome";
import { Button, Card, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { errorMessageKey } from "../lib/errors";
import { optionalString } from "../lib/search";
import { usePending } from "../lib/use-pending";
import { useServices } from "../services";
import { rootRoute } from "./root";

type State =
  | { readonly kind: "pending" }
  | { readonly kind: "verified" }
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  | { readonly kind: "unknown"; readonly outcome: SettledAction<AuthResult> };

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
              if (!(error instanceof NetworkError)) throw error;
              setMessage({ tone: "danger", text: tError("network") });
            }
          })
        }
      />
      {message === null ? null : <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

function VerifyEmailPage() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const { token } = verifyEmailRoute.useSearch();
  const [state, setState] = useState<State>(
    token === undefined ? { kind: "missing" } : { kind: "pending" },
  );
  const started = useRef<string | null>(null);

  const verify = async (value: string) => {
    setState({ kind: "pending" });
    const result = await gate.settle(() => auth.verifyEmail(value));
    if (result.kind === "unknown") setState({ kind: "unknown", outcome: result });
    else setState(result.value.ok ? { kind: "verified" } : { kind: "invalid" });
  };

  useEffect(() => {
    // Once per token, also under React's development double effects.
    if (token === undefined || started.current === token) return;
    started.current = token;
    void verify(token);
  }, [token]);

  switch (state.kind) {
    case "pending":
      return (
        <PageShell title={t("verifyEmail.pending")}>
          <p role="status" className="text-muted">
            {tCommon("loading")}
          </p>
        </PageShell>
      );
    case "verified":
      return (
        <PageShell title={t("verifyEmail.successTitle")} intro={t("verifyEmail.successBody")}>
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
