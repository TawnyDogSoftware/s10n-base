import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useSession } from "@s10n-base/client/session";

import { Screen, TextButton } from "../components/ui";

/** The signed-in home: where a project's app starts. */
export function HomeScreen() {
  const { t } = useTranslation("common");
  const session = useSession();
  const router = useRouter();
  if (!session) return null;
  return (
    <Screen title={t("home.title", { name: session.name })} intro={t("home.intro")}>
      <TextButton
        onPress={() => {
          router.push("/profile");
        }}
      >
        {t("home.profileLink")}
      </TextButton>
      {session.role === "admin" ? (
        <TextButton
          onPress={() => {
            router.push("/users");
          }}
        >
          {t("home.usersLink")}
        </TextButton>
      ) : null}
    </Screen>
  );
}
