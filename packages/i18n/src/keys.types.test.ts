/**
 * A type-level test: `bun run typecheck` fails if keys stop being typed. Each `@ts-expect-error`
 * line must be an error; if a mistyped key were accepted, the directive would be unused and
 * TypeScript would report that instead.
 */
import { describe, expect, it } from "vitest";

import { createTranslator } from "./index";

describe("typed keys", () => {
  it("accept real keys and reject mistyped ones at compile time", () => {
    const auth = createTranslator("auth");
    const email = createTranslator("email");

    expect(auth("signIn.title")).toBe("Sign in");
    // @ts-expect-error "signIn.titel" is not a key of the auth namespace.
    expect(auth("signIn.titel")).toBe("signIn.titel");
    // @ts-expect-error A key from another namespace is refused.
    expect(email("signIn.title")).toBe("signIn.title");
  });
});
