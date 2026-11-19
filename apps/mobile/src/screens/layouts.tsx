/**
 * The guards between the `(auth)` and `(app)` route groups, as layouts. They follow the session
 * query, so a session that ends while a screen is open (signed out elsewhere, expired, banned,
 * noticed when the app returns to the foreground) leaves the signed-in screens at once.
 */
import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useSessionQuery } from "@s10n-base/client/session";

import { Button, Loading, Notice } from "../components/ui";

/** The first session read failed: say so and offer a retry, rather than guess a state. */
function StartError(props: { readonly onRetry: () => void }) {
  const { t } = useTranslation("common");
  return (
    <View className="bg-background flex-1 justify-center gap-4 p-4">
      <Notice tone="danger" title={t("startError.title")}>
        {t("startError.body")}
      </Notice>
      <Button onPress={props.onRetry}>{t("routeError.retry")}</Button>
    </View>
  );
}

/** Undefined until the session is known; renders the waiting or failed state meanwhile. */
function useKnownSession() {
  const query = useSessionQuery();
  if (query.data !== undefined) return { session: query.data, waiting: null };
  return {
    session: undefined,
    waiting: query.isError ? <StartError onRetry={() => void query.refetch()} /> : <Loading />,
  };
}

/** `(app)`: signed-in users only. */
export function SignedInLayout() {
  const { t } = useTranslation("common");
  const { session, waiting } = useKnownSession();
  if (session === undefined) return waiting;
  if (session === null) return <Redirect href="/sign-in" />;
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t("nav.home") }} />
      <Stack.Screen name="profile" options={{ title: t("nav.profile") }} />
      <Stack.Screen name="users" options={{ title: t("nav.users") }} />
    </Stack>
  );
}

/** `(auth)`: visitors only; a signed-in user goes home. */
export function SignedOutLayout() {
  const { t } = useTranslation("auth");
  const { session, waiting } = useKnownSession();
  if (session === undefined) return waiting;
  if (session !== null) return <Redirect href="/" />;
  return (
    <Stack>
      <Stack.Screen name="sign-in" options={{ title: t("signIn.title") }} />
      <Stack.Screen name="sign-up" options={{ title: t("signUp.title") }} />
      <Stack.Screen name="forgot-password" options={{ title: t("forgotPassword.title") }} />
    </Stack>
  );
}
