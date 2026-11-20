import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("ends pending and reports an action that throws, and clears the report on the next run", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => usePending());
    const failure = new Error("storage failed");

    await act(() => result.current[1](() => Promise.reject(failure)));

    expect(result.current[0]).toBe(false);
    expect(result.current[2]).toBe(true);
    expect(report).toHaveBeenCalledWith(failure);
    await act(() => result.current[1](() => Promise.resolve()));
    expect(result.current[2]).toBe(false);
    report.mockRestore();
  });
});
