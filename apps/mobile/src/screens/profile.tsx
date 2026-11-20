import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text, type TextInputInstance, View } from "react-native";

import { errorMessageKey } from "@s10n-base/client/messages";
import { useProfileNameForm } from "@s10n-base/client/profile-name";
import { useProtectedQuery } from "@s10n-base/client/query-state";
import { fieldErrorText } from "@s10n-base/client/validation";
import { type Profile, profileGet } from "@s10n-base/contracts";

import { SignOutButton } from "../components/sign-out-button";
import { Body, Button, Card, Field, Loading, Notice, Screen } from "../components/ui";
import { useServices } from "../services";

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(value));
}

function NameForm(props: { readonly profile: Profile }) {
  const { t } = useTranslation("profile");
  const { t: tAuth } = useTranslation("auth");
  const { t: tError } = useTranslation("errors");
  const { rpc } = useServices();
  const form = useProfileNameForm(rpc, props.profile);
  const ref = useRef<TextInputInstance>(null);

  return (
    <>
      <Field
        label={t("nameLabel")}
        inputRef={ref}
        value={form.value}
        onChangeText={form.setValue}
        error={form.fieldError === undefined ? undefined : fieldErrorText(tAuth, form.fieldError)}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
      />
      <Button
        pending={form.pending}
        pendingLabel={t("saving")}
        onPress={() => {
          if (!form.submit()) ref.current?.focus();
        }}
      >
        {t("save")}
      </Button>
      {form.saved ? <Notice tone="success">{t("saved")}</Notice> : null}
      {form.error === null ? null : (
        <Notice tone="danger">{tError(errorMessageKey(form.error))}</Notice>
      )}
    </>
  );
}

function ProfileDetails(props: { readonly profile: Profile }) {
  const { t, i18n } = useTranslation("profile");
  const { profile } = props;
  return (
    <>
      {/* Keyed by user, so the form never keeps another user's typed name. */}
      <NameForm key={profile.userId} profile={profile} />
      <View className="gap-1">
        <Text className="text-foreground font-medium">{t("emailLabel")}</Text>
        <Body>{profile.email}</Body>
        <Text
          className={`self-start rounded-sm border px-2 text-sm ${
            profile.emailVerified ? "text-success border-success" : "text-danger border-danger"
          }`}
        >
          {profile.emailVerified ? t("verified") : t("unverified")}
        </Text>
      </View>
      <Body muted>{t("memberSince", { date: formatDate(profile.createdAt, i18n.language) })}</Body>
    </>
  );
}

/** Edit the name, see the email, sign out. No passkeys on mobile yet (docs/mobile-dev.md). */
export function ProfileScreen() {
  const { t } = useTranslation("profile");
  const { t: tError } = useTranslation("errors");
  const { rpc } = useServices();
  const { query } = useProtectedQuery(["profile"], (signal) =>
    rpc.call(profileGet, {}, { signal }),
  );
  let details: ReactNode;
  if (query.data !== undefined) details = <ProfileDetails profile={query.data} />;
  else if (query.isError) {
    details = <Notice tone="danger">{tError(errorMessageKey(query.error))}</Notice>;
  } else details = <Loading />;
  return (
    <Screen title={t("title")}>
      <Card title={t("details")}>{details}</Card>
      <Card title={t("session.title")}>
        <Body muted>{t("session.introApp")}</Body>
        <SignOutButton />
      </Card>
    </Screen>
  );
}
