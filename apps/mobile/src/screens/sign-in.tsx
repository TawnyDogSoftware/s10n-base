import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInputInstance } from "react-native";

import type { AuthResult } from "@s10n-base/client/auth";
import { checkFields, type FieldErrors } from "@s10n-base/client/form";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { fieldErrorText, validateEmail, validatePassword } from "@s10n-base/client/validation";

import { Unexpected } from "../components/unexpected";
import { CheckEmail } from "../components/check-email";
import { Body, Button, Card, Field, Notice, Screen, TextButton } from "../components/ui";
import { ActionOutcome } from "../components/unknown-outcome";
import { useServices } from "../services";

type Name = "email" | "password";

/**
 * Email and password. On success the session read afterwards is the user's, and the signed-out
 * layout sends them home; whatever the action reported, that read decides.
 */
export function SignInScreen() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Name>>({});
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [pending, run, failed] = usePending();
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

  // Each layout has its own key, so its buttons mount with their own press handlers:
  // react-native-web gives a reused button a new handler only in an effect.
  if (unverified !== null) {
    return (
      <Screen key="check-email" title={t("checkEmail.title")}>
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
    <Screen key="form" title={t("signIn.title")}>
      <Card>
        {Object.keys(errors).length > 0 ? (
          <Notice tone="danger">{t("validation.summary")}</Notice>
        ) : null}
        <Unexpected show={failed} />
        <ActionOutcome
          outcome={outcome}
          signedInText={tCommon("unknownOutcome.nowSignedIn")}
          unconfirmedText={tCommon("unknownOutcome.unconfirmed")}
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
