import { createRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";

import { Unexpected } from "../components/Unexpected";
import { EmailForm } from "../components/EmailForm";
import { ActionOutcome } from "../components/UnknownOutcome";
import { Card, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { redirectSearch } from "../lib/redirect";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { redirectSignedIn, useLeaveWhenSignedIn } from "./guards";
import { rootRoute } from "./root";

function ForgotPasswordPage() {
  useLeaveWhenSignedIn();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const { redirect } = forgotPasswordRoute.useSearch();
  const [pending, run, failed] = usePending();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);

  if (sentTo !== null) {
    return (
      <PageShell focus title={t("forgotPassword.sentTitle")}>
        <Notice tone="info">{t("forgotPassword.sentBody", { email: sentTo })}</Notice>
        <Link to="/sign-in" search={redirectSearch(redirect)} className={linkClass}>
          {t("forgotPassword.backToSignIn")}
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell title={t("forgotPassword.title")} intro={t("forgotPassword.intro")}>
      <Card>
        <Unexpected show={failed} />
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
      <Link to="/sign-in" search={redirectSearch(redirect)} className={linkClass}>
        {t("forgotPassword.backToSignIn")}
      </Link>
    </PageShell>
  );
}

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = optionalString(search.redirect);
    return redirect === undefined ? {} : { redirect };
  },
  beforeLoad: ({ context, search }) => redirectSignedIn(context, search.redirect),
  component: ForgotPasswordPage,
});
