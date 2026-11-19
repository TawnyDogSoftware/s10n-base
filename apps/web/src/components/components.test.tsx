import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { createReactI18n } from "@s10n-base/i18n/react";

import { useServices } from "../services";
import { ActionOutcome } from "./UnknownOutcome";
import { Button, Notice } from "./ui";

const i18n = createReactI18n(["en"]);

function withI18n(children: ReactNode) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe("Button", () => {
  it("keeps its own label while pending when it has no pending label, and is disabled", () => {
    render(<Button pending>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("Notice", () => {
  it("is a polite status by default, and may have a title alone", () => {
    render(<Notice title="Saved" />);

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("ActionOutcome", () => {
  it("shows nothing for an action the server accepted when there is nothing to confirm", () => {
    const { container } = render(
      withI18n(
        <ActionOutcome
          outcome={{ kind: "done", value: { ok: true, data: null }, session: null }}
          signedInText="Signed in."
        />,
      ),
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("useServices", () => {
  it("needs a ServicesProvider above it", () => {
    expect(() => renderHook(() => useServices())).toThrow(
      "useServices needs a ServicesProvider above it.",
    );
  });
});
