import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AuthResult } from "@s10n-base/client/auth";
import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";

import { useServices } from "../services";
import { Button } from "./ui";
import { ActionOutcome } from "./unknown-outcome";

/**
 * Signs out, then trusts only the session read afterwards. The signed-in layout leaves for the
 * sign-in screen as soon as the session is gone.
 *
 * Better Auth's Expo client forgets the stored cookie before it sends the request, so on a phone
 * a sign-out always signs this device out, even when the answer is lost; the server's session
 * then lapses on its own.
 */
export function SignOutButton() {
  const { t } = useTranslation("common");
  const { auth, gate } = useServices();
  const [pending, run] = usePending();
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);

  const signOut = () =>
    run(async () => {
      setOutcome(null);
      const result = await gate.settle(() => auth.signOut());
      // The server confirmed the sign-out and the cookie is gone: if the read after it failed,
      // signed out is still the known state.
      const confirmed = result.kind === "done" && result.value.ok && result.session === undefined;
      if (confirmed) gate.confirmSignedOut();
      if (confirmed || result.session === null) return;
      setOutcome(result);
    });

  return (
    <>
      <Button
        variant="secondary"
        pending={pending}
        pendingLabel={t("signingOut")}
        onPress={() => void signOut()}
      >
        {t("signOut")}
      </Button>
      <ActionOutcome
        outcome={outcome}
        signedInText={t("unknownOutcome.stillSignedIn")}
        unconfirmedText={t("unknownOutcome.stillSignedIn")}
      />
    </>
  );
}
