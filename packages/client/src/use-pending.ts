import { useCallback, useRef, useState } from "react";

/**
 * Pending state for one action, with a guard against running it twice: a second call while the
 * first is running is ignored, even before React has re-rendered the disabled button.
 *
 * The third value is true when the last run threw something its screen did not handle (a failing
 * storage adapter, a plugin's exception): pending ends, the error is reported to the console,
 * and the screen says something went wrong, so the user can try again rather than wait forever.
 */
export function usePending(): readonly [
  boolean,
  (action: () => Promise<void>) => Promise<void>,
  boolean,
] {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setFailed(false);
    try {
      await action();
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run, failed] as const;
}
