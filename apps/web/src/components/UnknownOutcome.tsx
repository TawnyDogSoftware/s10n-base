import { useTranslation } from "react-i18next";

import type { AppSession } from "@s10n-base/contracts";

import { Notice } from "./ui";

/**
 * Shown when a security action got no answer: it may or may not have happened, so the screen
 * says so and reports what the server said when the session was read again.
 */
export function UnknownOutcome(props: {
  /** The session read after the action; `undefined` when that read failed too. */
  readonly session: AppSession | null | undefined;
  /** What a session means for this action, e.g. "you are still signed in" after sign-out. */
  readonly signedInText: string;
}) {
  const { t } = useTranslation("common");
  const state =
    props.session === undefined
      ? t("unknownOutcome.offline")
      : props.session === null
        ? t("unknownOutcome.notSignedIn")
        : props.signedInText;
  return (
    <Notice tone="danger" title={t("unknownOutcome.title")}>
      <p>{t("unknownOutcome.body")}</p>
      <p>{state}</p>
    </Notice>
  );
}
