import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInputInstance } from "react-native";

import { useFocusAfterRender } from "@s10n-base/client/form";
import type { AuthResult } from "@s10n-base/client/auth";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { fieldErrorText, validateEmail } from "@s10n-base/client/validation";

import { Unexpected } from "../components/unexpected";
import { Body, Button, Card, Field, Notice, Screen, TextButton } from "../components/ui";
import { ActionOutcome } from "../components/unknown-outcome";
import { useServices } from "../services";

/**
 * Always the same answer, whether or not an account uses the address. The link in the email opens
 * the web app, where the new password is chosen.
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { auth, gate } = useServices();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);
  const [pending, run, failed] = usePending();
  const ref = useRef<TextInputInstance>(null);
  const focusAfterRender = useFocusAfterRender();

  const submit = () =>
    run(async () => {
      setOutcome(null);
      const checked = validateEmail(email);
      if (!checked.ok) {
        setError(fieldErrorText(t, checked.error));
        focusAfterRender(ref);
        return;
      }
      setError(undefined);
      const result = await gate.settle(() => auth.requestPasswordReset(checked.value));
      // Only a rate limit or a lost answer is reported, since neither says anything about
      // whether the address has an account.
      if (result.kind === "done" && (result.value.ok || result.value.code !== "RATE_LIMITED")) {
        setSentTo(checked.value);
        return;
      }
      setOutcome(result);
    });

  // Each layout has its own key, so its buttons mount with their own press handlers:
  // react-native-web gives a reused button a new handler only in an effect.
  if (sentTo !== null) {
    return (
      <Screen key="sent" title={t("forgotPassword.sentTitle")}>
        <Notice tone="info">
          <Body>{t("forgotPassword.sentBody", { email: sentTo })}</Body>
          <Body>{t("forgotPassword.inBrowser")}</Body>
        </Notice>
        <TextButton
          onPress={() => {
            router.replace("/sign-in");
          }}
        >
          {t("forgotPassword.backToSignIn")}
        </TextButton>
      </Screen>
    );
  }

  return (
    <Screen key="form" title={t("forgotPassword.title")} intro={t("forgotPassword.intro")}>
      <Card>
        <Unexpected show={failed} />
        <ActionOutcome outcome={outcome} signedInText={tCommon("unknownOutcome.nowSignedIn")} />
        <Field
          label={t("fields.email")}
          inputRef={ref}
          value={email}
          onChangeText={setEmail}
          error={error}
          autoComplete="email"
          textContentType="username"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button
          pending={pending}
          pendingLabel={t("forgotPassword.submitting")}
          onPress={() => void submit()}
        >
          {t("forgotPassword.submit")}
        </Button>
      </Card>
      <TextButton
        onPress={() => {
          router.replace("/sign-in");
        }}
      >
        {t("forgotPassword.backToSignIn")}
      </TextButton>
    </Screen>
  );
}
