import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageKey } from "@s10n-base/client/messages";
import { usePending } from "@s10n-base/client/use-pending";

import { useServices } from "../services";
import { Body, Button, Notice } from "./ui";

/**
 * "Check your email", after sign-up or a sign-in by an unverified user, with a resend. The link
 * opens in the browser (the web app finishes the job), so the screen says to come back and sign
 * in. Opening it in the app would need universal links, which need a real domain.
 */
export function CheckEmail(props: {
  readonly email: string;
  readonly lead?: string;
  readonly onSignIn: () => void;
}) {
  const { t } = useTranslation("auth");
  const { t: tError } = useTranslation("errors");
  const { auth } = useServices();
  const [pending, run] = usePending();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const resend = () =>
    run(async () => {
      setMessage(null);
      try {
        const result = await auth.sendVerificationEmail(props.email);
        setMessage(
          result.ok
            ? { tone: "success", text: t("checkEmail.resent") }
            : { tone: "danger", text: tError(errorMessageKey(result)) },
        );
      } catch (error) {
        // A lost answer, or anything else that went wrong: say which, as the other screens do.
        setMessage({ tone: "danger", text: tError(errorMessageKey(error)) });
      }
    });

  return (
    <>
      <Notice tone="info" title={t("checkEmail.title")}>
        {props.lead === undefined ? null : <Body>{props.lead}</Body>}
        <Body>{t("checkEmail.body", { email: props.email })}</Body>
        <Body>{t("checkEmail.inBrowser")}</Body>
      </Notice>
      <Button onPress={props.onSignIn}>{t("checkEmail.toSignIn")}</Button>
      <Button
        variant="secondary"
        pending={pending}
        pendingLabel={t("checkEmail.resending")}
        onPress={() => void resend()}
      >
        {t("checkEmail.resend")}
      </Button>
      {message === null ? null : <Notice tone={message.tone}>{message.text}</Notice>}
    </>
  );
}
