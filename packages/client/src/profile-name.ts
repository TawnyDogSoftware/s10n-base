/**
 * The profile's name form, on the web and on mobile: what the field shows, how a save runs, and
 * what the screen says afterwards.
 *
 * The field shows the user's draft, or the saved name while there is none, so a name changed
 * elsewhere appears in an untouched field and never replaces what the user is typing. A save
 * clears the draft only if it still holds what was sent, and "saved" is shown only while the
 * field shows the saved name. A second submit while a save runs is ignored, even before React
 * has re-rendered the disabled button.
 */
import { hashKey, useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { type Profile, profileUpdate } from "@s10n-base/contracts";

import { protectedQueryKey, useSessionGate } from "./query-state";
import type { RpcClient } from "./rpc";
import { NetworkError } from "./transport";
import { type FieldError, validateName } from "./validation";

export interface ProfileNameForm {
  /** What the field shows. */
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly fieldError: FieldError | undefined;
  /**
   * Checks the name and saves it. False when the name is invalid (its error is set); true when
   * the save started or one was already running.
   */
  readonly submit: () => boolean;
  readonly pending: boolean;
  /** The last save succeeded and the field still shows the saved name. */
  readonly saved: boolean;
  /** Why the last save failed, or null. */
  readonly error: unknown;
}

export function useProfileNameForm(rpc: RpcClient, profile: Profile): ProfileNameForm {
  const gate = useSessionGate();
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | undefined>(undefined);
  const running = useRef(false);
  const sentDraft = useRef<string | null>(null);
  const session = gate.current();
  const profileKey = protectedQueryKey(session, ["profile"]);
  const { queryClient } = gate;

  const save = useMutation({
    mutationKey: protectedQueryKey(session, ["profile", "update"]),
    mutationFn: (name: string) =>
      gate.guard(() => rpc.call(profileUpdate, { userId: profile.userId, name })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(profileKey, updated);
      const sent = sentDraft.current;
      setDraft((current) => (current === sent ? null : current));
      // Anything else of this user's may show the name (the user list): what no screen shows
      // now is dropped, so it is never shown with the old name, and the rest is read again.
      const others = {
        queryKey: protectedQueryKey(session, []),
        predicate: (query: { readonly queryHash: string }) =>
          query.queryHash !== hashKey(profileKey),
      };
      queryClient.removeQueries({ ...others, type: "inactive" });
      void queryClient.invalidateQueries(others);
      // The header and greeting read the name from the session.
      await gate.refresh();
    },
    onError: (error) => {
      // The save may have happened: what the server holds is read again, not assumed.
      if (error instanceof NetworkError)
        void queryClient.invalidateQueries({ queryKey: profileKey });
    },
    onSettled: () => {
      running.current = false;
    },
  });

  const value = draft ?? profile.name;
  return {
    value,
    setValue: setDraft,
    fieldError,
    submit: () => {
      if (running.current) return true;
      const checked = validateName(value);
      if (!checked.ok) {
        setFieldError(checked.error);
        return false;
      }
      setFieldError(undefined);
      running.current = true;
      sentDraft.current = draft;
      save.mutate(checked.value);
      return true;
    },
    pending: save.isPending,
    saved: save.isSuccess && draft === null,
    error: save.isError ? save.error : null,
  };
}
