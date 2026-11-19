import { useState } from "react";
import { useTranslation } from "react-i18next";

import { NetworkError } from "@s10n-base/client/rpc";

import { errorMessageKey } from "../lib/errors";
import { usePending } from "../lib/use-pending";
import { useServices } from "../services";
import { Button, Notice } from "./ui";

/** "Check your email", after sign-up or a sign-in by an unverified user, with a resend. */
export function CheckEmail(props: { readonly email: string; readonly lead?: string }) {
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
        if (!(error instanceof NetworkError)) throw error;
        setMessage({ tone: "danger", text: tError("network") });
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" title={t("checkEmail.title")}>
        {props.lead === undefined ? null : <p>{props.lead}</p>}
        <p>{t("checkEmail.body", { email: props.email })}</p>
      </Notice>
      <div>
        <Button
          variant="secondary"
          pending={pending}
          pendingLabel={t("checkEmail.resending")}
          onClick={() => void resend()}
        >
          {t("checkEmail.resend")}
        </Button>
      </div>
      {message === null ? null : <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
