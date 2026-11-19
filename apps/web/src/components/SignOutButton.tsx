import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SettledAction } from "@s10n-base/client/query-state";

import { errorMessageKey } from "../lib/errors";
import type { AuthResult } from "../lib/auth";
import { usePending } from "../lib/use-pending";
import { useServices } from "../services";
import { UnknownOutcome } from "./UnknownOutcome";
import { Button, Notice } from "./ui";

/**
 * Signs out, then trusts only the session read afterwards: if the answer was lost, the server
 * decides whether this browser is still signed in.
 */
export function SignOutButton(props: { readonly variant?: "primary" | "secondary" }) {
  const { t } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
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
      {outcome?.kind === "unknown" ? (
        <UnknownOutcome
          session={outcome.session}
          signedInText={t("unknownOutcome.stillSignedIn")}
        />
      ) : outcome?.kind === "done" && !outcome.value.ok ? (
        <Notice tone="danger">{tError(errorMessageKey(outcome.value))}</Notice>
      ) : outcome?.kind === "done" ? (
        <Notice tone="danger">{t("unknownOutcome.stillSignedIn")}</Notice>
      ) : null}
    </div>
  );
}
