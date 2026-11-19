import { createRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";

import { CheckEmail } from "../components/CheckEmail";
import { UnknownOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { errorMessageKey } from "../lib/errors";
import { checkFields, type FieldErrors } from "../lib/form";
import { optionalString } from "../lib/search";
import { usePending } from "../lib/use-pending";
import {
  PASSWORD_MIN,
  validateEmail,
  validateName,
  validateNewPassword,
  fieldErrorText,
} from "../lib/validation";
import { useServices } from "../services";
import { redirectSignedIn } from "./guards";
import { rootRoute } from "./root";

type Name = "name" | "email" | "password";

function SignUpPage() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, run] = usePending();
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = checkFields<Name>([
        ["name", validateName(name), refs.name],
        ["email", validateEmail(email), refs.email],
        ["password", validateNewPassword(password), refs.password],
      ]);
      if (!checked.ok) {
        setErrors(checked.errors);
        return;
      }
      setErrors({});
      const result = await gate.settle(() => auth.signUp(checked.values));
      if (result.kind === "done" && result.value.ok) {
        setSentTo(checked.values.email);
        return;
      }
      setOutcome(result);
    });

  if (sentTo !== null) {
    return (
      <PageShell title={t("checkEmail.title")}>
        <CheckEmail email={sentTo} />
      </PageShell>
    );
  }

  const fieldError = (field: Name) => {
    const error = errors[field];
    return error === undefined ? undefined : fieldErrorText(t, error);
  };

  return (
    <PageShell title={t("signUp.title")}>
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
          ) : null}
          <Field
            label={t("fields.name")}
            name="name"
            autoComplete="name"
            inputRef={refs.name}
            value={name}
            onValueChange={setName}
            error={fieldError("name")}
          />
          <Field
            label={t("fields.email")}
            name="email"
            type="email"
            autoComplete="username"
            inputRef={refs.email}
            value={email}
            onValueChange={setEmail}
            error={fieldError("email")}
          />
          <Field
            label={t("fields.password")}
            name="password"
            type="password"
            autoComplete="new-password"
            hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
            inputRef={refs.password}
            value={password}
            onValueChange={setPassword}
            error={fieldError("password")}
          />
          <div>
            <Button type="submit" pending={pending} pendingLabel={t("signUp.submitting")}>
              {t("signUp.submit")}
            </Button>
          </div>
        </form>
      </Card>
      <p>
        {t("signUp.haveAccount")}{" "}
        <Link to="/sign-in" className={linkClass}>
          {t("signUp.signInLink")}
        </Link>
      </p>
    </PageShell>
  );
}

export const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = optionalString(search.redirect);
    return redirect === undefined ? {} : { redirect };
  },
  beforeLoad: ({ context, search }) => redirectSignedIn(context, search.redirect),
  component: SignUpPage,
});
