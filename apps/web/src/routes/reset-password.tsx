import { createRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFocusAfterRender } from "@s10n-base/client/form";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { PASSWORD_MIN, validateNewPassword, fieldErrorText } from "@s10n-base/client/validation";

import { Unexpected } from "../components/Unexpected";
import { ActionOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, linkClass, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { rootRoute } from "./root";

function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const { token } = resetPasswordRoute.useSearch();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [done, setDone] = useState(false);
  const [pending, run, failed] = usePending();
  const ref = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  if (token === undefined) {
    return (
      <PageShell title={t("resetPassword.missingTitle")} intro={t("resetPassword.missingBody")}>
        <Link to="/forgot-password" className={linkClass}>
          {t("resetPassword.requestNew")}
        </Link>
      </PageShell>
    );
  }

  if (done) {
    return (
      <PageShell title={t("resetPassword.successTitle")} intro={t("resetPassword.successBody")}>
        <Link to="/sign-in" className={linkClass}>
          {t("resetPassword.signIn")}
        </Link>
      </PageShell>
    );
  }

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = validateNewPassword(password);
      if (!checked.ok) {
        setError(fieldErrorText(t, checked.error));
        focusAfterRender(ref);
        return;
      }
      setError(undefined);
      const result = await gate.settle(() => auth.resetPassword(token, checked.value));
      if (result.kind === "done" && result.value.ok) {
        setDone(true);
        return;
      }
      setOutcome(result);
    });

  const refusedToken =
    outcome?.kind === "done" &&
    !outcome.value.ok &&
    (outcome.value.code === "INVALID_TOKEN" || outcome.value.code === "TOKEN_EXPIRED");

  return (
    <PageShell title={t("resetPassword.title")}>
      <Card>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Unexpected show={failed} />
          <ActionOutcome outcome={outcome} signedInText={tCommon("unknownOutcome.nowSignedIn")}>
            {refusedToken ? (
              <Link to="/forgot-password" className={linkClass}>
                {t("resetPassword.requestNew")}
              </Link>
            ) : null}
          </ActionOutcome>
          <Field
            label={t("fields.newPassword")}
            name="password"
            type="password"
            autoComplete="new-password"
            hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
            inputRef={ref}
            value={password}
            onValueChange={setPassword}
            error={error}
          />
          <div>
            <Button type="submit" pending={pending} pendingLabel={t("resetPassword.submitting")}>
              {t("resetPassword.submit")}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (search: Record<string, unknown>): { token?: string } => {
    const token = optionalString(search.token);
    return token === undefined ? {} : { token };
  },
  component: ResetPasswordPage,
});
