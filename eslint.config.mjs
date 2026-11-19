// ESLint: the type-aware rules and the size limits oxlint does not have. oxlint runs first
// (.oxlintrc.json); this config adds typescript-eslint's strict and type-checked rules, sonarjs,
// the size limits, and the rule against hard-coded text in the apps' components.
//
// Inline configuration is off: a comment cannot switch a rule off. An allowance a framework
// needs goes here, with its reason. See docs/quality.md.
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

/** First-party code that belongs to a TypeScript project, so the type-checked rules can run. */
const TYPED_SOURCE = [
  "apps/*/src/**/*.{ts,tsx}",
  "packages/*/src/**/*.{ts,tsx}",
  "scripts/**/*.ts",
  "e2e/**/*.ts",
];

const TESTS = ["**/*.test.{ts,tsx}", "**/src/test/**", "e2e/**"];

export default tseslint.config(
  {
    // Generated output, third-party fixtures and build products only.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "apps/mobile/.expo/**",
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      "apps/mobile/expo-env.d.ts",
      "apps/mobile/src/uniwind-types.d.ts",
      "apps/server/src/infra/postgres/generated/**",
      "e2e/test-results/**",
      "e2e/report/**",
    ],
  },
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },
  js.configs.recommended,
  tseslint.configs.strict,
  sonarjs.configs.recommended,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { __dirname: "readonly", module: "writable", require: "readonly" },
    },
    // CommonJS config files (Metro's) can load their dependencies only with require().
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The size limits. Raise one only for the whole repo, by the smallest step, and record the
    // function that needed it in docs/quality.md.
    rules: {
      complexity: ["error", { max: 10 }],
      "sonarjs/cognitive-complexity": ["error", 15],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "no-nested-ternary": "error",
    },
  },
  {
    // TypeScript checks undefined names itself, and knows the globals of each environment.
    files: ["**/*.{ts,tsx}"],
    rules: { "no-undef": "off" },
  },
  {
    files: TYPED_SOURCE,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir },
    },
  },
  {
    // TanStack Router's guards throw the result of its redirect(): the router's documented way to
    // redirect from beforeLoad, and the only non-Error value the web app throws.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "package", package: "@tanstack/router-core", name: "Redirect" }] },
      ],
    },
  },
  {
    // Development tools and tests run git, bun, node and docker from PATH, as the developer's own
    // shell does; nothing that ships runs a command. Plan 007, section 11.
    files: ["scripts/**", "e2e/**", ...TESTS],
    rules: { "sonarjs/no-os-command-from-path": "off" },
  },
  {
    // Every word a user reads comes from packages/i18n.
    files: ["apps/web/src/**/*.tsx", "apps/mobile/src/**/*.tsx"],
    ignores: TESTS,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // Attributes that hold identifiers, routes, class names or roles, never visible text.
          "jsx-attributes": {
            exclude: [
              "className",
              "contentContainerClassName",
              "style",
              "type",
              "key",
              "id",
              "name",
              "to",
              "href",
              "testID",
              "role",
              "autoComplete",
              "autoCapitalize",
              "inputMode",
              "keyboardType",
              "textContentType",
              "method",
              "rel",
              "target",
            ],
          },
        },
      ],
    },
  },
);
