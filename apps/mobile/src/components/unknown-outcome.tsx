import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { AuthResult } from "@s10n-base/client/auth";
import { errorMessageKey } from "@s10n-base/client/messages";
import { type SettledAction, useRecheck } from "@s10n-base/client/query-state";
import type { AppSession } from "@s10n-base/contracts";

import { Body, Button, Notice } from "./ui";

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
 * What the session read after an action says, or, when that read failed, a button that reads it
 * again without repeating the action.
 */
function SessionAfter(props: {
  readonly session: AppSession | null | undefined;
  readonly signedInText: string;
}) {
  const { t } = useTranslation("common");
  const { session, checking, recheck } = useRecheck(props.session);
  return (
    <>
      <Body>{sessionText(t, session, props.signedInText)}</Body>
      {session === undefined ? (
        <Button
          variant="secondary"
          pending={checking}
          pendingLabel={t("unknownOutcome.checking")}
          onPress={() => void recheck()}
        >
          {t("unknownOutcome.checkAgain")}
        </Button>
      ) : null}
    </>
  );
}

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
  return (
    <Notice tone="danger" title={t("unknownOutcome.title")}>
      <Body>{t("unknownOutcome.body")}</Body>
      <SessionAfter session={props.session} signedInText={props.signedInText} />
    </Notice>
  );
}

/**
 * What a settled security action leaves on screen: nothing before it ran, the unknown outcome
 * of a lost answer, or the server's refusal. An action the server accepted shows
 * `unconfirmedText` if given: the screen is still here only because the session read
 * afterwards failed, and it offers to read it again.
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
  return (
    <Notice tone="danger" announce={props.unconfirmedText}>
      <Body>{props.unconfirmedText}</Body>
      <SessionAfter session={outcome.session} signedInText={props.signedInText} />
    </Notice>
  );
}
