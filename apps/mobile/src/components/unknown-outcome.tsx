import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { AuthResult } from "@s10n-base/client/auth";
import { errorMessageKey } from "@s10n-base/client/messages";
import type { SettledAction } from "@s10n-base/client/query-state";
import type { AppSession } from "@s10n-base/contracts";

import { Body, Notice } from "./ui";

function sessionText(
  t: TFunction,
  session: AppSession | null | undefined,
  signedInText: string,
): string {
  if (session === undefined) return t("unknownOutcome.offline");
  if (session === null) return t("unknownOutcome.notSignedIn");
  return signedInText;
}

/**
 * Shown when a security action got no answer: it may or may not have happened, so the screen
 * says so and reports what the server said when the session was read again.
 */
function UnknownOutcome(props: {
  /** The session read after the action; `undefined` when that read failed too. */
  readonly session: AppSession | null | undefined;
  /** What a session means for this action, e.g. "you are still signed in" after sign-out. */
  readonly signedInText: string;
}) {
  const { t } = useTranslation("common");
  return (
    <Notice tone="danger" title={t("unknownOutcome.title")}>
      <Body>{t("unknownOutcome.body")}</Body>
      <Body>{sessionText(t, props.session, props.signedInText)}</Body>
    </Notice>
  );
}

/**
 * What a settled security action leaves on screen: nothing before it ran, the unknown outcome
 * of a lost answer, or the server's refusal. An action the server accepted shows
 * `unconfirmedText` if given: the screen is still here only because the session read
 * afterwards failed.
 */
export function ActionOutcome(props: {
  readonly outcome: SettledAction<AuthResult> | null;
  /** Passed on to `UnknownOutcome`. */
  readonly signedInText: string;
  readonly unconfirmedText?: string;
}) {
  const { t } = useTranslation("errors");
  const { outcome } = props;
  if (outcome === null) return null;
  if (outcome.kind === "unknown") {
    return <UnknownOutcome session={outcome.session} signedInText={props.signedInText} />;
  }
  if (!outcome.value.ok) {
    return <Notice tone="danger">{t(errorMessageKey(outcome.value))}</Notice>;
  }
  if (props.unconfirmedText === undefined) return null;
  return <Notice tone="danger">{props.unconfirmedText}</Notice>;
}
