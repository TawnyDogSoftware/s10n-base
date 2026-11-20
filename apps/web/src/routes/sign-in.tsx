import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  checkFields,
  type FieldErrors,
  useFocusAfterRender,
  withoutError,
} from "@s10n-base/client/form";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { validateEmail, validatePassword, fieldErrorText } from "@s10n-base/client/validation";

import { Unexpected } from "../components/Unexpected";
import { CheckEmail } from "../components/CheckEmail";
import { ActionOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { safeRedirect } from "../lib/redirect";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { redirectSignedIn, useLeaveWhenSignedIn } from "./guards";
import { rootRoute } from "./root";

type Name = "email" | "password";

/** Whether this browser can use passkeys at all; if not, the button would only fail. */
function passkeysSupported(): boolean {
  return typeof window.PublicKeyCredential === "function";
}

function SignInPage() {
  useLeaveWhenSignedIn();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const navigate = useNavigate();
  const { redirect } = signInRoute.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [pending, run, failed] = usePending();
  const [passkeyPending, runPasskey, passkeyFailed] = usePending();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  /** Whatever the action reported, the session read afterwards decides. */
  const finish = async (result: SettledAction<AuthResult>) => {
    if (result.session) {
      await navigate({ href: safeRedirect(redirect) ?? "/", replace: true });
      return;
    }
    setOutcome(result);
  };

  const submit = () => {
    setOutcome(null);
    const checked = checkFields<Name>([
      ["email", validateEmail(email), emailRef],
      ["password", validatePassword(password), passwordRef],
    ]);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusAfterRender(checked.first);
      return;
    }
    setErrors({});
    void run(async () => {
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
  };

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

  /** A changed field drops its own error and any refusal, which described the old values. */
  const edit = (field: Name, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => withoutError(current, field));
    setOutcome(null);
  };

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
            submit();
          }}
        >
          {Object.keys(errors).length > 0 ? (
            <Notice tone="danger">{t("validation.summary")}</Notice>
          ) : null}
          <Unexpected show={failed || passkeyFailed} />
          <ActionOutcome
            outcome={outcome}
            signedInText={tCommon("unknownOutcome.nowSignedIn")}
            unconfirmedText={tCommon("unknownOutcome.unconfirmed")}
          />
          <Field
            label={t("fields.email")}
            name="email"
            type="email"
            autoComplete="username webauthn"
            inputRef={emailRef}
            value={email}
            onValueChange={edit("email", setEmail)}
            disabled={pending}
            alertError={false}
            error={fieldError("email")}
          />
          <Field
            label={t("fields.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            inputRef={passwordRef}
            value={password}
            onValueChange={edit("password", setPassword)}
            disabled={pending}
            alertError={false}
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
        {passkeysSupported() ? (
          <>
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
          </>
        ) : (
          <p className="text-muted">{t("signIn.passkeyUnsupported")}</p>
        )}
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
