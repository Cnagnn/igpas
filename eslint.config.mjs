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
        // Tampermonkey / Greasemonkey grants
        GM_getValue: "readonly",
        GM_setValue: "readonly",
        GM_deleteValue: "readonly",
        GM_listValues: "readonly",
        GM_setClipboard: "readonly",
        GM_registerMenuCommand: "readonly",
        GM_notification: "readonly",
        GM_xmlhttpRequest: "readonly",
        unsafeWindow: "readonly",
        // Blok ekspor untuk tes Node (tidak aktif di browser — module undefined).
        module: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
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
        GM_getValue: "readonly",
        GM_setValue: "readonly",
        GM_deleteValue: "readonly",
        GM_listValues: "readonly",
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
    // Skrip Node (ESM): check-versions.mjs — butuh global console/process.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
