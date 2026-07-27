// The repo's single ESLint setup, shared by every workspace. Flat config,
// resolved from the root: running `eslint .` inside a package finds this
// file by walking up, so `packages/*` never carries its own copy and the
// rules cannot drift between them.
//
// Type-checked rules are on (`projectService` resolves each package's
// tsconfig), which is what lets the linter see the unnecessary type
// assertions and floating promises that a syntax-only pass misses. The
// two build-config files sit outside their package's `include`, so they
// are linted without type information rather than being skipped.

const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/extension/assets/**",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // TypeScript already resolves identifiers; `no-undef` on typed code
      // only produces false positives on ambient globals.
      "no-undef": "off",
      // CLAUDE.md: "No `any` types — ever."
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md: "No `console.log` in committed code." The api logs
      // through the Azure Functions invocation context and the extension
      // bundle logs nothing at all, so neither package needs an escape.
      "no-console": "error",
      // A leading `_` is this repo's way of saying "bound on purpose,
      // used on purpose never": the trailing `context` an Azure Functions
      // handler must declare to reach `request`, a key destructured only
      // to drop it from the rest, a caught error the handler ignores.
      // Teaching the rule the convention keeps it biting for every
      // binding left unused by accident, which renaming the sites one by
      // one would not. Lives here rather than in a package so the two
      // workspaces answer alike — the whole point of one shared config.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    // Rules of Hooks is only meaningful where there are components and
    // hooks — the panel package.
    files: ["packages/extension/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  {
    // Outside every package's `include: ["src"]`, so there is no program
    // to type-check them against.
    files: ["**/*.config.ts", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  }
);
