import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInputInstance } from "react-native";

import type { AuthResult } from "@s10n-base/client/auth";
import { checkFields, type FieldErrors } from "@s10n-base/client/form";
import { errorMessageKey } from "@s10n-base/client/messages";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { fieldErrorText, validateEmail, validatePassword } from "@s10n-base/client/validation";

import { CheckEmail } from "../components/check-email";
import { Body, Button, Card, Field, Notice, Screen, TextButton } from "../components/ui";
import { UnknownOutcome } from "../components/unknown-outcome";
import { useServices } from "../services";

type Name = "email" | "password";

/**
 * Email and password. On success the session read afterwards is the user's, and the signed-out
 * layout sends them home; whatever the action reported, that read decides.
 */
export function SignInScreen() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [pending, run] = usePending();
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = checkFields<Name>([
        ["email", validateEmail(email), emailRef],
        ["password", validatePassword(password), passwordRef],
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
      if (!result.session) setOutcome(result);
    });

  if (unverified !== null) {
    return (
      <Screen title={t("checkEmail.title")}>
        <CheckEmail
          email={unverified}
          lead={t("signIn.unverified")}
          onSignIn={() => {
            setUnverified(null);
          }}
        />
      </Screen>
    );
  }

  const fieldError = (field: Name) => {
    const error = errors[field];
    return error === undefined ? undefined : fieldErrorText(t, error);
  };

  return (
    <Screen title={t("signIn.title")}>
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
        ) : outcome?.kind === "done" ? (
          // Signed in, but the session could not be read to confirm it.
          <Notice tone="danger">{tError("network")}</Notice>
        ) : null}
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
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry
          autoCapitalize="none"
        />
        <Button
          pending={pending}
          pendingLabel={t("signIn.submitting")}
          onPress={() => void submit()}
        >
          {t("signIn.submit")}
        </Button>
        <TextButton
          onPress={() => {
            router.push("/forgot-password");
          }}
        >
          {t("signIn.forgotPassword")}
        </TextButton>
      </Card>
      <Body>{t("signIn.noAccount")}</Body>
      <TextButton
        onPress={() => {
          router.push("/sign-up");
        }}
      >
        {t("signIn.signUpLink")}
      </TextButton>
    </Screen>
  );
}
