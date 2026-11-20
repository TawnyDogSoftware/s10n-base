import { createRoute, Link } from "@tanstack/react-router";
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
import {
  PASSWORD_MIN,
  validateEmail,
  validateName,
  validateNewPassword,
  fieldErrorText,
} from "@s10n-base/client/validation";

import { Unexpected } from "../components/Unexpected";
import { CheckEmail } from "../components/CheckEmail";
import { ActionOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, linkClass, Notice, PageShell } from "../components/ui";
import type { AuthResult } from "../lib/auth";
import { optionalString } from "../lib/search";
import { useServices } from "../services";
import { redirectSignedIn, useLeaveWhenSignedIn } from "./guards";
import { rootRoute } from "./root";

type Name = "name" | "email" | "password";

function SignUpPage() {
  useLeaveWhenSignedIn();
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, run, failed] = usePending();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  const submit = () => {
    setOutcome(null);
    const checked = checkFields<Name>([
      ["name", validateName(name), nameRef],
      ["email", validateEmail(email), emailRef],
      ["password", validateNewPassword(password), passwordRef],
    ]);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusAfterRender(checked.first);
      return;
    }
    setErrors({});
    void run(async () => {
      const result = await gate.settle(() => auth.signUp(checked.values));
      if (result.kind === "done" && result.value.ok) {
        setSentTo(checked.values.email);
        return;
      }
      setOutcome(result);
    });
  };

  if (sentTo !== null) {
    return (
      <PageShell title={t("checkEmail.title")}>
        <CheckEmail email={sentTo} />
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
    <PageShell title={t("signUp.title")}>
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
          <Unexpected show={failed} />
          <ActionOutcome outcome={outcome} signedInText={tCommon("unknownOutcome.nowSignedIn")} />
          <Field
            label={t("fields.name")}
            name="name"
            autoComplete="name"
            inputRef={nameRef}
            value={name}
            onValueChange={edit("name", setName)}
            disabled={pending}
            alertError={false}
            error={fieldError("name")}
          />
          <Field
            label={t("fields.email")}
            name="email"
            type="email"
            autoComplete="username"
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
            autoComplete="new-password"
            hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
            inputRef={passwordRef}
            value={password}
            onValueChange={edit("password", setPassword)}
            disabled={pending}
            alertError={false}
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
