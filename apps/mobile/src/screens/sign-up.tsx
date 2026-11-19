import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInputInstance } from "react-native";

import type { AuthResult } from "@s10n-base/client/auth";
import { checkFields, type FieldErrors } from "@s10n-base/client/form";
import { errorMessageKey } from "@s10n-base/client/messages";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import {
  fieldErrorText,
  PASSWORD_MIN,
  validateEmail,
  validateName,
  validateNewPassword,
} from "@s10n-base/client/validation";

import { CheckEmail } from "../components/check-email";
import { Body, Button, Card, Field, Notice, Screen, TextButton } from "../components/ui";
import { UnknownOutcome } from "../components/unknown-outcome";
import { useServices } from "../services";

type Name = "name" | "email" | "password";

/** Name, email and password; then "check your email". */
export function SignUpScreen() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, run] = usePending();
  const nameRef = useRef<TextInputInstance>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = checkFields<Name>([
        ["name", validateName(name), nameRef],
        ["email", validateEmail(email), emailRef],
        ["password", validateNewPassword(password), passwordRef],
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
      <Screen title={t("checkEmail.title")}>
        <CheckEmail email={sentTo} onSignIn={() => router.replace("/sign-in")} />
      </Screen>
    );
  }

  const fieldError = (field: Name) => {
    const error = errors[field];
    return error === undefined ? undefined : fieldErrorText(t, error);
  };

  return (
    <Screen title={t("signUp.title")}>
      <Card>
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
          inputRef={nameRef}
          value={name}
          onChangeText={setName}
          error={fieldError("name")}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
        />
        <Field
          label={t("fields.email")}
          inputRef={emailRef}
          value={email}
          onChangeText={setEmail}
          error={fieldError("email")}
          autoComplete="email"
          textContentType="username"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label={t("fields.password")}
          inputRef={passwordRef}
          value={password}
          onChangeText={setPassword}
          error={fieldError("password")}
          hint={t("fields.passwordHint", { min: PASSWORD_MIN })}
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry
          autoCapitalize="none"
        />
        <Button
          pending={pending}
          pendingLabel={t("signUp.submitting")}
          onPress={() => void submit()}
        >
          {t("signUp.submit")}
        </Button>
      </Card>
      <Body>{t("signUp.haveAccount")}</Body>
      <TextButton onPress={() => router.replace("/sign-in")}>{t("signUp.signInLink")}</TextButton>
    </Screen>
  );
}
