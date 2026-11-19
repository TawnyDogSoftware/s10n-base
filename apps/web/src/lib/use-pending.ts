import { useCallback, useRef, useState } from "react";

/**
 * Pending state for one action, with a guard against running it twice: a second call while the
 * first is running is ignored, even before React has re-rendered the disabled button.
 */
export function usePending(): readonly [boolean, (action: () => Promise<void>) => Promise<void>] {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run] as const;
}
