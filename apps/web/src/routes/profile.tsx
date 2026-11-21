import { createRoute } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFocusAfterRender } from "@s10n-base/client/form";
import { errorMessageKey } from "@s10n-base/client/messages";
import { useProfileNameForm } from "@s10n-base/client/profile-name";
import { type SettledAction, useProtectedQuery } from "@s10n-base/client/query-state";
import { usePending } from "@s10n-base/client/use-pending";
import { type FieldError, fieldErrorText, validatePasskeyName } from "@s10n-base/client/validation";
import { profileGet, type Profile } from "@s10n-base/contracts";

import { Unexpected } from "../components/Unexpected";
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

/** Date and time: two passkeys added the same day must not look the same. */
function formatDateTime(value: Date | string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function NameForm(props: { readonly profile: Profile }) {
  const { t } = useTranslation("profile");
  const { t: tAuth } = useTranslation("auth");
  const { t: tError } = useTranslation("errors");
  const { rpc } = useServices();
  const form = useProfileNameForm(rpc, props.profile);
  const ref = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.submit()) focusAfterRender(ref);
      }}
    >
      <Field
        label={t("nameLabel")}
        name="name"
        autoComplete="name"
        inputRef={ref}
        value={form.value}
        onValueChange={form.setValue}
        error={form.fieldError === undefined ? undefined : fieldErrorText(tAuth, form.fieldError)}
      />
      <div>
        <Button type="submit" pending={form.pending} pendingLabel={t("saving")}>
          {t("save")}
        </Button>
      </div>
      {form.saved ? <Notice tone="success">{t("saved")}</Notice> : null}
      {form.error === null ? null : (
        <Notice tone="danger">{tError(errorMessageKey(form.error))}</Notice>
      )}
    </form>
  );
}

type PasskeyMessage =
  | { readonly kind: "done"; readonly text: string }
  | { readonly kind: "error"; readonly text: string }
  | { readonly kind: "unknown"; readonly outcome: SettledAction<AuthResult> };

/** What to say after a passkey change: done, the server's refusal, or an unknown outcome. */
function passkeyMessage(
  result: SettledAction<AuthResult>,
  doneText: string,
  tError: TFunction<"errors">,
): PasskeyMessage {
  if (result.kind === "unknown") return { kind: "unknown", outcome: result };
  if (result.value.ok) return { kind: "done", text: doneText };
  return { kind: "error", text: tError(errorMessageKey(result.value)) };
}

/** A list that is still shown but could not be read again, with a retry. */
function RefreshFailed(props: { readonly text: string; readonly onRetry: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Notice tone="danger">
      <p>{props.text}</p>
      <div>
        <Button variant="secondary" onClick={props.onRetry}>
          {t("routeError.retry")}
        </Button>
      </div>
    </Notice>
  );
}

/** What the profile shows while a query has no data: loading, or the reason it failed. */
function QueryFallback(props: { readonly failed: boolean; readonly message: string }) {
  return props.failed ? <Notice tone="danger">{props.message}</Notice> : <Loading />;
}

/** Each passkey's shown name and its buttons' names, numbered where two would match. */
function usePasskeyLabels(passkeys: readonly Passkey[]) {
  const { t, i18n } = useTranslation("profile");
  const seen = new Map<string, number>();
  return passkeys.map((passkey) => {
    const name = passkey.name ?? t("passkeys.unnamed");
    const date = formatDateTime(passkey.createdAt, i18n.language);
    const base = t("passkeys.removeLabel", { name, date });
    const number = (seen.get(base) ?? 0) + 1;
    seen.set(base, number);
    // Two rename buttons match exactly when the two remove buttons do, so one number serves.
    const [removeLabel, renameLabel] =
      number === 1
        ? [base, t("passkeys.renameLabel", { name, date })]
        : [
            t("passkeys.removeLabelNumbered", { name, date, number }),
            t("passkeys.renameLabelNumbered", { name, date, number }),
          ];
    return { passkey, name, date, removeLabel, renameLabel };
  });
}
type PasskeyLabels = ReturnType<typeof usePasskeyLabels>[number];

/** What the passkey card is doing: adding, removing or renaming one passkey, or nothing. */
type PasskeyBusy =
  | { readonly kind: "add" }
  | { readonly kind: "remove" | "rename"; readonly id: string };

function isBusyWith(busy: PasskeyBusy | null, kind: "remove" | "rename", id: string): boolean {
  return busy?.kind === kind && busy.id === id;
}

/** The form that replaces a passkey's row while it is renamed. */
function RenamePasskeyForm(props: {
  readonly passkey: Passkey;
  readonly saving: boolean;
  readonly onRename: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation("profile");
  const { t: tAuth } = useTranslation("auth");
  const [value, setValue] = useState(props.passkey.name ?? "");
  const [error, setError] = useState<FieldError>();
  const ref = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  // The field takes focus when the form appears.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const checked = validatePasskeyName(value);
        if (checked.ok) {
          setError(undefined);
          props.onRename(checked.value);
        } else {
          setError(checked.error);
          focusAfterRender(ref);
        }
      }}
    >
      <Field
        label={t("passkeys.nameLabel")}
        name="passkey-name"
        autoComplete="off"
        inputRef={ref}
        value={value}
        onValueChange={setValue}
        error={error === undefined ? undefined : fieldErrorText(tAuth, error)}
      />
      <div className="flex gap-3">
        <Button type="submit" pending={props.saving} pendingLabel={t("passkeys.savingName")}>
          {t("passkeys.saveName")}
        </Button>
        <Button variant="secondary" disabled={props.saving} onClick={props.onCancel}>
          {t("passkeys.cancelRename")}
        </Button>
      </div>
    </form>
  );
}

interface PasskeyRowActions {
  readonly onEdit: (passkey: Passkey) => void;
  readonly onRename: (passkey: Passkey, name: string) => void;
  readonly onCancel: () => void;
  readonly onRemove: (passkey: Passkey) => void;
}

function PasskeyRow(
  props: PasskeyRowActions & {
    readonly labels: PasskeyLabels;
    readonly busy: PasskeyBusy | null;
    readonly editing: boolean;
  },
) {
  const { t } = useTranslation("profile");
  const { passkey, name, date, removeLabel, renameLabel } = props.labels;
  const renameRef = useRef<HTMLButtonElement>(null);
  // When the form closes, focus returns to the button that opened it.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !props.editing) renameRef.current?.focus();
    wasEditing.current = props.editing;
  }, [props.editing]);

  if (props.editing) {
    return (
      <li className="border-border rounded-md border px-4 py-3">
        <RenamePasskeyForm
          passkey={passkey}
          saving={isBusyWith(props.busy, "rename", passkey.id)}
          onRename={(next) => {
            props.onRename(passkey, next);
          }}
          onCancel={props.onCancel}
        />
      </li>
    );
  }
  return (
    <li className="border-border flex items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-muted text-sm">{t("passkeys.addedOn", { date })}</p>
      </div>
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={props.busy !== null}
          aria-label={renameLabel}
          buttonRef={renameRef}
          onClick={() => {
            props.onEdit(passkey);
          }}
        >
          {t("passkeys.rename")}
        </Button>
        <Button
          variant="secondary"
          disabled={props.busy !== null}
          pending={isBusyWith(props.busy, "remove", passkey.id)}
          pendingLabel={t("passkeys.removing")}
          aria-label={removeLabel}
          onClick={() => {
            props.onRemove(passkey);
          }}
        >
          {t("passkeys.remove")}
        </Button>
      </div>
    </li>
  );
}

function PasskeyList(
  props: PasskeyRowActions & {
    readonly passkeys: readonly Passkey[];
    readonly busy: PasskeyBusy | null;
    /** The id of the passkey being renamed: one at a time. */
    readonly editing: string | null;
  },
) {
  const { t } = useTranslation("profile");
  const { passkeys, editing, ...row } = props;
  const labels = usePasskeyLabels(passkeys);
  if (passkeys.length === 0) return <p>{t("passkeys.empty")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {labels.map((entry) => (
        <PasskeyRow
          key={entry.passkey.id}
          {...row}
          labels={entry}
          editing={editing === entry.passkey.id}
        />
      ))}
    </ul>
  );
}

function PasskeyNotice(props: { readonly message: PasskeyMessage | null }) {
  const { t } = useTranslation("common");
  const { message } = props;
  if (message === null) return null;
  if (message.kind === "unknown") {
    return (
      <UnknownOutcome
        session={message.outcome.session}
        signedInText={t("unknownOutcome.stillSignedIn")}
      />
    );
  }
  return <Notice tone={message.kind === "done" ? "success" : "danger"}>{message.text}</Notice>;
}

function Passkeys() {
  const { t, i18n } = useTranslation("profile");
  const { t: tError } = useTranslation("errors");
  const { auth, gate } = useServices();
  const { query } = useProtectedQuery(["passkeys"], async () => {
    const result = await auth.listPasskeys();
    if (!result.ok) throw new Error(result.code);
    return result.data;
  });
  const [pending, run, failed] = usePending();
  const [message, setMessage] = useState<PasskeyMessage | null>(null);
  const supported = typeof window.PublicKeyCredential === "function";

  const [busy, setBusy] = useState<PasskeyBusy | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * Adds, removes or renames a passkey, then reads the list again: it is the truth either way.
   * Answers how it ended, or nothing when it did not run (another change is running) or threw.
   */
  const change = async (
    what: PasskeyBusy,
    action: () => Promise<AuthResult>,
    doneText: string,
  ): Promise<PasskeyMessage["kind"] | undefined> => {
    let ended: PasskeyMessage["kind"] | undefined;
    await run(async () => {
      setBusy(what);
      setMessage(null);
      try {
        const result = await gate.settle(action);
        await query.refetch();
        const next = passkeyMessage(result, doneText, tError);
        setMessage(next);
        ended = next.kind;
      } finally {
        setBusy(null);
      }
    });
    return ended;
  };

  const rename = async (passkey: Passkey, name: string) => {
    if (name === passkey.name) {
      setEditing(null);
      return;
    }
    const ended = await change(
      { kind: "rename", id: passkey.id },
      () => auth.renamePasskey(passkey.id, name),
      t("passkeys.renamed"),
    );
    // A refusal leaves the form open with its message; after an unknown outcome the list that
    // was just read says what the name is.
    if (ended === "done" || ended === "unknown") setEditing(null);
  };

  return (
    <Card title={t("passkeys.title")}>
      <p className="text-muted">{t("passkeys.intro")}</p>
      {query.data === undefined ? (
        <QueryFallback failed={query.isError} message={tError("generic")} />
      ) : (
        <PasskeyList
          passkeys={query.data}
          busy={pending ? busy : null}
          editing={editing}
          onEdit={(passkey) => {
            setEditing(passkey.id);
          }}
          onRename={(passkey, name) => void rename(passkey, name)}
          onCancel={() => {
            setEditing(null);
          }}
          onRemove={(passkey) =>
            void change(
              { kind: "remove", id: passkey.id },
              () => auth.deletePasskey(passkey.id),
              t("passkeys.removed"),
            )
          }
        />
      )}
      {query.isError && query.data !== undefined ? (
        <RefreshFailed text={t("passkeys.refreshFailed")} onRetry={() => void query.refetch()} />
      ) : null}
      {supported ? (
        <div>
          <Button
            pending={pending && busy?.kind === "add"}
            disabled={pending}
            pendingLabel={t("passkeys.adding")}
            onClick={() =>
              void change(
                { kind: "add" },
                () =>
                  auth.addPasskey(
                    t("passkeys.defaultName", {
                      date: formatDateTime(new Date(), i18n.language),
                    }),
                  ),
                t("passkeys.added"),
              )
            }
          >
            {t("passkeys.add")}
          </Button>
        </div>
      ) : (
        <p className="text-muted">{t("passkeys.unsupported")}</p>
      )}
      <Unexpected show={failed} />
      <PasskeyNotice message={message} />
    </Card>
  );
}

function ProfileDetails(props: { readonly profile: Profile }) {
  const { t, i18n } = useTranslation("profile");
  const { profile } = props;
  return (
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
  );
}

function ProfilePage() {
  const { t } = useTranslation("profile");
  const { t: tError } = useTranslation("errors");
  const { rpc } = useServices();
  const { query } = useProtectedQuery(["profile"], (signal) =>
    rpc.call(profileGet, {}, { signal }),
  );
  return (
    <PageShell title={t("title")} width="wide">
      <Card title={t("details")}>
        {query.data === undefined ? (
          <QueryFallback failed={query.isError} message={tError(errorMessageKey(query.error))} />
        ) : (
          <ProfileDetails profile={query.data} />
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
