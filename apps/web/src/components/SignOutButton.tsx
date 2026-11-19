import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";

import type { AuthResult } from "../lib/auth";
import { useServices } from "../services";
import { ActionOutcome } from "./UnknownOutcome";
import { Button } from "./ui";

/**
 * Signs out, then trusts only the session read afterwards: if the answer was lost, the server
 * decides whether this browser is still signed in.
 */
export function SignOutButton(props: { readonly variant?: "primary" | "secondary" }) {
  const { t } = useTranslation("common");
  const { auth, gate } = useServices();
  const navigate = useNavigate();
  const [pending, run] = usePending();
  const [outcome, setOutcome] = useState<SettledAction<AuthResult> | null>(null);

  const signOut = () =>
    run(async () => {
      setOutcome(null);
      const result = await gate.settle(() => auth.signOut());
      // The server confirmed the sign-out, and its answer cleared the cookie: if the read after
      // it failed, signed out is still the known state.
      const confirmed = result.kind === "done" && result.value.ok && result.session === undefined;
      if (confirmed) gate.confirmSignedOut();
      if (confirmed || result.session === null) {
        await navigate({ to: "/sign-in", replace: true });
        return;
      }
      setOutcome(result);
    });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          variant={props.variant ?? "secondary"}
          pending={pending}
          pendingLabel={t("signingOut")}
          onClick={() => void signOut()}
        >
          {t("signOut")}
        </Button>
      </div>
      <ActionOutcome
        outcome={outcome}
        signedInText={t("unknownOutcome.stillSignedIn")}
        unconfirmedText={t("unknownOutcome.stillSignedIn")}
      />
    </div>
  );
}
