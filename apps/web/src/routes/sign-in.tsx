import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { checkFields, type FieldErrors } from "@s10n-base/client/form";
import { errorMessageKey } from "@s10n-base/client/messages";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { validateEmail, validatePassword, fieldErrorText } from "@s10n-base/client/validation";

import { CheckEmail } from "../components/CheckEmail";
import { UnknownOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { safeRedirect } from "../lib/redirect";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { redirectSignedIn } from "./guards";
import { rootRoute } from "./root";

type Name = "email" | "password";

function SignInPage() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate, origin } = useServices();
  const navigate = useNavigate();
  const { redirect } = signInRoute.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [pending, run] = usePending();
  const [passkeyPending, runPasskey] = usePending();
  const refs = { email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  /** Whatever the action reported, the session read afterwards decides. */
  const finish = async (result: SettledAction<AuthResult>) => {
    if (result.session) {
      await navigate({ href: safeRedirect(redirect, origin) ?? "/", replace: true });
      return;
    }
    setOutcome(result);
  };

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = checkFields<Name>([
        ["email", validateEmail(email), refs.email],
        ["password", validatePassword(password), refs.password],
      ]);
      if (!checked.ok) {
        setErrors(checked.errors);
        return;
      }
      setErrors({});
      const result = await gate.settle(() => auth.signIn(checked.values));
      if (
        result.kind === "done" &&
        !result.value.ok &&
        result.value.code === "EMAIL_NOT_VERIFIED"
      ) {
        setUnverified(checked.values.email);
        return;
      }
      await finish(result);
    });

  const signInWithPasskey = () =>
    runPasskey(async () => {
      setOutcome(null);
      setErrors({});
      await finish(await gate.settle(() => auth.signInWithPasskey()));
    });

  if (unverified !== null) {
    return (
      <PageShell title={t("checkEmail.title")}>
        <CheckEmail email={unverified} lead={t("signIn.unverified")} />
      </PageShell>
    );
  }

  const fieldError = (field: Name) => {
    const error = errors[field];
    return error === undefined ? undefined : fieldErrorText(t, error);
  };

  return (
    <PageShell title={t("signIn.title")}>
      <Card>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {Object.keys(errors).length > 0 ? (
            <Notice tone="danger">{t("validation.summary")}</Notice>
          ) : null}
          {outcome?.kind === "unknown" ? (
            <UnknownOutcome
              session={outcome.session}
              signedInText={tCommon("unknownOutcome.nowSignedIn")}
            />
          ) : outcome?.kind === "done" && !outcome.value.ok ? (
            <Notice tone="danger">{tError(errorMessageKey(outcome.value))}</Notice>
          ) : outcome?.kind === "done" ? (
            // Signed in, but the session could not be read to confirm it.
            <Notice tone="danger">{tError("network")}</Notice>
          ) : null}
          <Field
            label={t("fields.email")}
            name="email"
            type="email"
            autoComplete="username webauthn"
            inputRef={refs.email}
            value={email}
            onValueChange={setEmail}
            error={fieldError("email")}
          />
          <Field
            label={t("fields.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            inputRef={refs.password}
            value={password}
            onValueChange={setPassword}
            error={fieldError("password")}
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="submit"
              pending={pending}
              pendingLabel={t("signIn.submitting")}
              disabled={passkeyPending}
            >
              {t("signIn.submit")}
            </Button>
            <Link to="/forgot-password" className={linkClass}>
              {t("signIn.forgotPassword")}
            </Link>
          </div>
        </form>
        <p className="text-muted">{t("signIn.or")}</p>
        <div>
          <Button
            variant="secondary"
            pending={passkeyPending}
            pendingLabel={t("signIn.passkeyPending")}
            disabled={pending}
            onClick={() => void signInWithPasskey()}
          >
            {t("signIn.passkey")}
          </Button>
        </div>
      </Card>
      <p>
        {t("signIn.noAccount")}{" "}
        <Link
          to="/sign-up"
          search={redirect === undefined ? {} : { redirect }}
          className={linkClass}
        >
          {t("signIn.signUpLink")}
        </Link>
      </p>
    </PageShell>
  );
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = optionalString(search.redirect);
    return redirect === undefined ? {} : { redirect };
  },
  beforeLoad: ({ context, search }) => redirectSignedIn(context, search.redirect),
  component: SignInPage,
});
