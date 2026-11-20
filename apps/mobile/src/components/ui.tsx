/**
 * The few components every screen is built from. Styled only with the theme's tokens
 * (`packages/theme/theme.css`, through Uniwind); no colour or radius is written here or anywhere
 * else in the app. Text keeps React Native's default of scaling with the system font size.
 */
import { type ReactNode, type Ref, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  View,
} from "react-native";

/** A screen's scrolling body, with its title as the screen reader's heading. */
export function Screen(props: {
  readonly title: string;
  readonly intro?: string;
  readonly children?: ReactNode;
}) {
  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="gap-4 p-4"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text role="heading" className="text-foreground text-2xl font-bold">
        {props.title}
      </Text>
      {props.intro === undefined ? null : <Text className="text-muted">{props.intro}</Text>}
      {props.children}
    </ScrollView>
  );
}

export function Card(props: { readonly title?: string; readonly children?: ReactNode }) {
  return (
    <View className="border-border bg-background gap-4 rounded-lg border p-4">
      {props.title === undefined ? null : (
        <Text role="heading" className="text-foreground text-lg font-semibold">
          {props.title}
        </Text>
      )}
      {props.children}
    </View>
  );
}

/** Body text in the theme's foreground colour. */
export function Body(props: { readonly children?: ReactNode; readonly muted?: boolean }) {
  return (
    <Text className={props.muted === true ? "text-muted" : "text-foreground"}>
      {props.children}
    </Text>
  );
}

export function Button(props: {
  readonly children: string;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary";
  /** While true the button is disabled and shows `pendingLabel`. */
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly disabled?: boolean;
  /** A fuller name for screen readers, when the visible label is not enough. */
  readonly accessibilityLabel?: string;
}) {
  const pending = props.pending === true;
  const disabled = pending || props.disabled === true;
  const label = pending ? (props.pendingLabel ?? props.children) : props.children;
  const primary = (props.variant ?? "primary") === "primary";
  return (
    <Pressable
      role="button"
      accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy: pending }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={props.onPress}
      className={`min-h-11 items-center justify-center rounded-md border px-4 py-2 ${
        primary ? "bg-primary border-primary" : "border-border bg-background"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <Text className={`font-semibold ${primary ? "text-primary-foreground" : "text-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A link-styled button that navigates. */
export function TextButton(props: { readonly children: string; readonly onPress: () => void }) {
  return (
    <Pressable role="link" onPress={props.onPress} className="min-h-11 justify-center">
      <Text className="text-primary font-semibold underline">{props.children}</Text>
    </Pressable>
  );
}

/** A labelled text field with its hint and error. */
export function Field(
  props: {
    readonly label: string;
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    readonly error?: string | undefined;
    readonly hint?: string;
    readonly inputRef?: Ref<TextInputInstance>;
    /** Not editable, while what was typed is being sent. */
    readonly disabled?: boolean;
  } & Pick<
    TextInputProps,
    "autoComplete" | "textContentType" | "keyboardType" | "secureTextEntry" | "autoCapitalize"
  >,
) {
  const { label, value, onChangeText, error, hint, inputRef, disabled = false, ...input } = props;
  const invalid = error !== undefined;
  // Read out when it appears, even when focus does not move.
  useEffect(() => {
    if (error !== undefined) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);
  return (
    <View className="gap-1">
      <Text className="text-foreground font-medium">{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        // React Native has no aria-describedby: the hint and error are read after the label.
        accessibilityHint={[error, hint].filter((part) => part !== undefined).join(" ")}
        aria-invalid={invalid}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        aria-disabled={disabled}
        autoCorrect={false}
        className={`text-foreground bg-background min-h-11 rounded-md border px-3 py-2 ${
          invalid ? "border-danger" : "border-border"
        }`}
        {...input}
      />
      {hint === undefined ? null : <Text className="text-muted text-sm">{hint}</Text>}
      {invalid ? <Text className="text-danger text-sm">{error}</Text> : null}
    </View>
  );
}

const TONE = {
  info: "border-border",
  success: "border-success",
  danger: "border-danger",
} as const;

/**
 * A message box. A danger notice is an alert: it is announced when it appears, on iOS through
 * `announceForAccessibility` and on Android through its live region.
 */
export function Notice(props: {
  readonly tone: keyof typeof TONE;
  readonly title?: string;
  readonly children?: ReactNode;
  /** What to announce; defaults to the title, or the children when they are a string. */
  readonly announce?: string;
}) {
  const alert = props.tone === "danger";
  const announcement =
    props.announce ??
    props.title ??
    (typeof props.children === "string" ? props.children : undefined);
  useEffect(() => {
    if (alert && announcement !== undefined) {
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [alert, announcement]);
  return (
    <View
      role={alert ? "alert" : undefined}
      accessibilityLiveRegion={alert ? "assertive" : "polite"}
      className={`gap-2 rounded-md border p-3 ${TONE[props.tone]}`}
    >
      {props.title === undefined ? null : (
        <Text className="text-foreground font-semibold">{props.title}</Text>
      )}
      {typeof props.children === "string" ? (
        <Text className={alert ? "text-danger" : "text-foreground"}>{props.children}</Text>
      ) : (
        props.children
      )}
    </View>
  );
}

export function Loading() {
  const { t } = useTranslation("common");
  return (
    <View className="bg-background flex-1 items-center justify-center gap-2 p-4">
      <ActivityIndicator accessibilityLabel={t("loading")} />
      <Text className="text-muted">{t("loading")}</Text>
    </View>
  );
}
