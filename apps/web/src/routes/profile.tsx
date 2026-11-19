import { useMutation } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageKey } from "@s10n-base/client/messages";
import {
  protectedQueryKey,
  type SettledAction,
  useProtectedQuery,
} from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { validateName, fieldErrorText } from "@s10n-base/client/validation";
import { profileGet, profileUpdate, type Profile } from "@s10n-base/contracts";

import { Loading } from "../components/RouteStates";
import { SignOutButton } from "../components/SignOutButton";
import { UnknownOutcome } from "../components/UnknownOutcome";
import { Button, Card, Field, Notice, PageShell } from "../components/ui";
import type { AuthResult, Passkey } from "../lib/auth";
import { useServices } from "../services";
import { authedRoute } from "./authed";

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(value));
}

function NameForm(props: { readonly profile: Profile }) {
  const { t } = useTranslation("profile");
  const { t: tAuth } = useTranslation("auth");
  const { t: tError } = useTranslation("errors");
  const { rpc, gate } = useServices();
  const [name, setName] = useState(props.profile.name);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLInputElement>(null);
  const session = gate.current();
  const save = useMutation({
    mutationKey: protectedQueryKey(session, ["profile", "update"]),
    mutationFn: (value: string) => gate.guard(() => rpc.call(profileUpdate, { name: value })),
    onSuccess: async (profile) => {
      gate.queryClient.setQueryData(protectedQueryKey(session, ["profile"]), profile);
      setName(profile.name);
      // The header and greeting read the name from the session.
      await gate.refresh();
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending) return;
        const checked = validateName(name);
        if (!checked.ok) {
          setFieldError(fieldErrorText(tAuth, checked.error));
          ref.current?.focus();
          return;
        }
        setFieldError(undefined);
        save.mutate(checked.value);
      }}
    >
      <Field
        label={t("nameLabel")}
        name="name"
        autoComplete="name"
        inputRef={ref}
        value={name}
        onValueChange={setName}
        error={fieldError}
      />
      <div>
        <Button type="submit" pending={save.isPending} pendingLabel={t("saving")}>
          {t("save")}
        </Button>
      </div>
      {save.isSuccess ? <Notice tone="success">{t("saved")}</Notice> : null}
      {save.isError ? <Notice tone="danger">{tError(errorMessageKey(save.error))}</Notice> : null}
    </form>
  );
}

function Passkeys() {
  const { t, i18n } = useTranslation("profile");
  const { t: tCommon } = useTranslation("common");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const { query } = useProtectedQuery(["passkeys"], async () => {
    const result = await auth.listPasskeys();
    if (!result.ok) throw new Error(result.code);
    return result.data;
  });
  const [pending, run] = usePending();
  const [message, setMessage] = useState<
    | { kind: "done"; text: string }
    | { kind: "error"; text: string }
    | { kind: "unknown"; outcome: SettledAction<AuthResult> }
    | null
  >(null);
  const supported = typeof window.PublicKeyCredential === "function";

  /** Adds or removes a passkey, then reads the list again: it is the truth either way. */
  const change = (action: () => Promise<AuthResult>, doneText: string) =>
    run(async () => {
      setMessage(null);
      const result = await gate.settle(action);
      await query.refetch();
      if (result.kind === "unknown") setMessage({ kind: "unknown", outcome: result });
      else if (result.value.ok) setMessage({ kind: "done", text: doneText });
      else setMessage({ kind: "error", text: tError(errorMessageKey(result.value)) });
    });

  const list: readonly Passkey[] = query.data ?? [];
  return (
    <Card title={t("passkeys.title")}>
      <p className="text-muted">{t("passkeys.intro")}</p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice tone="danger">{tError("generic")}</Notice>
      ) : list.length === 0 ? (
        <p>{t("passkeys.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((passkey) => {
            const name = passkey.name ?? t("passkeys.unnamed");
            return (
              <li
                key={passkey.id}
                className="border-border flex items-center justify-between gap-4 rounded-md border px-4 py-3"
              >
                <div>
                  <p className="font-medium">{name}</p>
                  <p className="text-muted text-sm">
                    {t("passkeys.addedOn", { date: formatDate(passkey.createdAt, i18n.language) })}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={pending}
                  aria-label={t("passkeys.removeLabel", { name })}
                  onClick={() =>
                    void change(() => auth.deletePasskey(passkey.id), t("passkeys.removed"))
                  }
                >
                  {t("passkeys.remove")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {supported ? (
        <div>
          <Button
            pending={pending}
            pendingLabel={t("passkeys.adding")}
            onClick={() => void change(() => auth.addPasskey(), t("passkeys.added"))}
          >
            {t("passkeys.add")}
          </Button>
        </div>
      ) : (
        <p className="text-muted">{t("passkeys.unsupported")}</p>
      )}
      {message?.kind === "done" ? <Notice tone="success">{message.text}</Notice> : null}
      {message?.kind === "error" ? <Notice tone="danger">{message.text}</Notice> : null}
      {message?.kind === "unknown" ? (
        <UnknownOutcome
          session={message.outcome.session}
          signedInText={tCommon("unknownOutcome.stillSignedIn")}
        />
      ) : null}
    </Card>
  );
}

function ProfilePage() {
  const { t, i18n } = useTranslation("profile");
  const { t: tError } = useTranslation("errors");
  const { rpc } = useServices();
  const { query } = useProtectedQuery(["profile"], (signal) =>
    rpc.call(profileGet, {}, { signal }),
  );
  const profile = query.data;
  return (
    <PageShell title={t("title")} width="wide">
      <Card title={t("details")}>
        {profile === undefined ? (
          query.isError ? (
            <Notice tone="danger">{tError(errorMessageKey(query.error))}</Notice>
          ) : (
            <Loading />
          )
        ) : (
          <>
            {/* Keyed by user, so a form never keeps another user's typed name. */}
            <NameForm key={profile.userId} profile={profile} />
            <dl className="flex flex-col gap-1">
              <dt className="font-medium">{t("emailLabel")}</dt>
              <dd>
                <span>{profile.email}</span>
                <span
                  className={`ml-3 rounded-sm border px-2 text-sm ${profile.emailVerified ? "text-success border-success" : "text-danger border-danger"}`}
                >
                  {profile.emailVerified ? t("verified") : t("unverified")}
                </span>
              </dd>
            </dl>
            <p className="text-muted">
              {t("memberSince", { date: formatDate(profile.createdAt, i18n.language) })}
            </p>
          </>
        )}
      </Card>
      <Passkeys />
      <Card title={t("session.title")}>
        <p className="text-muted">{t("session.intro")}</p>
        <SignOutButton />
      </Card>
    </PageShell>
  );
}

export const profileRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/profile",
  component: ProfilePage,
});
