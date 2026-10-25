import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/**", "docs/**", "test/fixtures/**"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Tampermonkey / Greasemonkey grants (v0.9.0: no GM storage)
        GM_setClipboard: "readonly",
        GM_registerMenuCommand: "readonly",
        GM_notification: "readonly",
        GM_xmlhttpRequest: "readonly",
        unsafeWindow: "readonly",
        // Export block for the Node tests (inactive in the browser — module is undefined).
        module: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      // Empty catch blocks are deliberate: a failed restore must never break the game page.
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["warn", "smart"],
      curly: ["warn", "multi-line"],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: { sourceType: "module" },
  },
  {
    // Node script (ESM): check-versions.mjs — needs the console/process globals.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
