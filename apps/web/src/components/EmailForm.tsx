import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFocusAfterRender } from "@s10n-base/client/form";
import { validateEmail, fieldErrorText } from "@s10n-base/client/validation";

import { Button, Field } from "./ui";

/** One email field and a submit button; validates before calling `onSubmit`. */
export function EmailForm(props: {
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly pending: boolean;
  readonly onSubmit: (email: string) => void;
}) {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const checked = validateEmail(email);
        if (!checked.ok) {
          setError(fieldErrorText(t, checked.error));
          focusAfterRender(ref);
          return;
        }
        setError(undefined);
        props.onSubmit(checked.value);
      }}
    >
      <Field
        label={t("fields.email")}
        name="email"
        type="email"
        autoComplete="username"
        inputRef={ref}
        value={email}
        onValueChange={setEmail}
        error={error}
      />
      <div>
        <Button type="submit" pending={props.pending} pendingLabel={props.pendingLabel}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
