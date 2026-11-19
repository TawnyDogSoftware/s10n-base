/**
 * The few components every screen is built from. Styled only with the theme's tokens
 * (`packages/theme/theme.css`); no colour or radius is written here or anywhere else in the app.
 * Every string they show comes from the caller, who reads it from `packages/i18n`.
 */
import { type InputHTMLAttributes, type ReactNode, type Ref, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function Button(props: {
  readonly children: ReactNode;
  readonly type?: "button" | "submit";
  readonly variant?: "primary" | "secondary";
  /** While true the button is disabled and shows `pendingLabel`. */
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly "aria-label"?: string;
}) {
  const { pending = false, variant = "primary" } = props;
  const colours =
    variant === "primary"
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-background text-foreground border-border";
  return (
    <button
      type={props.type ?? "button"}
      disabled={pending || props.disabled === true}
      aria-disabled={pending || props.disabled === true}
      aria-label={pending ? undefined : props["aria-label"]}
      onClick={props.onClick}
      className={`${colours} ${focusRing} rounded-md border px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-70`}
    >
      {pending ? (props.pendingLabel ?? props.children) : props.children}
    </button>
  );
}

export function Field(
  props: {
    readonly label: string;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly inputRef?: Ref<HTMLInputElement>;
    readonly value: string;
    readonly onValueChange: (value: string) => void;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id">,
) {
  const { label, hint, error, inputRef, value, onValueChange, ...input } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      )}
      <input
        {...input}
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        className={`bg-background text-foreground border-border aria-[invalid=true]:border-danger ${focusRing} rounded-md border px-3 py-2`}
      />
      {error === undefined ? null : (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A message about what just happened. `danger` is an alert, read out at once; the others are
 * polite status messages.
 */
export function Notice(props: {
  readonly tone?: "info" | "success" | "danger";
  readonly title?: string;
  readonly children?: ReactNode;
}) {
  const tone = props.tone ?? "info";
  const colour =
    tone === "danger"
      ? "text-danger border-danger"
      : tone === "success"
        ? "text-success border-success"
        : "text-foreground border-border";
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`${colour} rounded-md border px-4 py-3`}
    >
      {props.title === undefined ? null : <p className="font-semibold">{props.title}</p>}
      {props.children === undefined ? null : (
        <div className="text-foreground">{props.children}</div>
      )}
    </div>
  );
}

export function Card(props: { readonly title?: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={props.title === undefined ? undefined : headingId}
      className="border-border flex flex-col gap-4 rounded-lg border p-6"
    >
      {props.title === undefined ? null : (
        <h2 id={headingId} className="text-lg font-semibold">
          {props.title}
        </h2>
      )}
      {props.children}
    </section>
  );
}

/** One page: its heading, which is also the document title, and its content. */
export function PageShell(props: {
  readonly title: string;
  readonly intro?: string;
  readonly width?: "narrow" | "wide";
  readonly children?: ReactNode;
}) {
  const { t } = useTranslation("common");
  const appName = t("appName");
  useEffect(() => {
    document.title = `${props.title} · ${appName}`;
  }, [props.title, appName]);
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 py-10 ${props.width === "wide" ? "max-w-4xl" : "max-w-md"}`}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        {props.intro === undefined ? null : <p className="text-muted">{props.intro}</p>}
      </div>
      {props.children}
    </div>
  );
}

/** A link styled as text in the primary colour. Pass the router's `Link` render. */
export const linkClass = `text-primary underline underline-offset-2 ${focusRing} rounded-sm`;
