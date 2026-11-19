import { createRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";

import { EmailForm } from "../components/EmailForm";
import { ActionOutcome } from "../components/UnknownOutcome";
import { Card, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { useServices } from "../services";
import { redirectSignedIn } from "./guards";
import { rootRoute } from "./root";

function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const [pending, run] = usePending();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);

  if (sentTo !== null) {
    return (
      <PageShell title={t("forgotPassword.sentTitle")}>
        <Notice tone="info">{t("forgotPassword.sentBody", { email: sentTo })}</Notice>
        <Link to="/sign-in" className={linkClass}>
          {t("forgotPassword.backToSignIn")}
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title={t("forgotPassword.title")} intro={t("forgotPassword.intro")}>
      <Card>
        <ActionOutcome outcome={outcome} signedInText={tCommon("unknownOutcome.nowSignedIn")} />
        <EmailForm
          submitLabel={t("forgotPassword.submit")}
          pendingLabel={t("forgotPassword.submitting")}
          pending={pending}
          onSubmit={(email) =>
            void run(async () => {
              setOutcome(null);
              const result = await gate.settle(() => auth.requestPasswordReset(email));
              // The same answer whether or not an account uses the address; only a rate limit
              // or a lost answer is reported, since neither says anything about the address.
              if (
                result.kind === "done" &&
                (result.value.ok || result.value.code !== "RATE_LIMITED")
              ) {
                setSentTo(email);
                return;
              }
              setOutcome(result);
            })
          }
        />
      </Card>
      <Link to="/sign-in" className={linkClass}>
        {t("forgotPassword.backToSignIn")}
      </Link>
    </PageShell>
  );
}

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  beforeLoad: ({ context }) => redirectSignedIn(context, undefined),
  component: ForgotPasswordPage,
});
