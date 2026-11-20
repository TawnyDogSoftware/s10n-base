import { useTranslation } from "react-i18next";

import { Notice } from "./ui";

/** Shown when an action threw something its screen did not expect (see `usePending`). */
export function Unexpected(props: { readonly show: boolean }) {
  const { t } = useTranslation("errors");
  return props.show ? <Notice tone="danger">{t("generic")}</Notice> : null;
}
