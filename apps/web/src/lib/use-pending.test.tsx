import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePending } from "./use-pending";

describe("usePending", () => {
  it("runs one action at a time and reports pending while it runs", async () => {
    const { result } = renderHook(() => usePending());
    let release!: () => void;
    let calls = 0;
    const action = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    let first!: Promise<void>;
    act(() => {
      first = result.current[1](action);
      void result.current[1](action);
    });
    expect(result.current[0]).toBe(true);
    expect(calls).toBe(1);

    await act(async () => {
      release();
      await first;
    });
    expect(result.current[0]).toBe(false);
  });
});
