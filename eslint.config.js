// One lint toolchain for the whole monorepo: ESLint (flat config) with typescript-eslint for
// TypeScript and eslint-plugin-svelte for `.svelte` files. Prettier owns formatting, so the
// `eslint-config-prettier` layer is last and the two never disagree on a style rule.
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.worktrees/**",
      "docs/**",
      ".scratch/**",
      ".agents/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    // The Svelte layer above switches these files to the Svelte parser; this points the script
    // block back at typescript-eslint so template expressions type-check as TypeScript.
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    // A `.svelte.ts` file is a rune module, not a component: it has no markup for the component
    // rules to read, and re-parsing it as a component makes the Svelte parser fail on its first
    // import statement.
    files: ["**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  eslintConfigPrettier,
);
