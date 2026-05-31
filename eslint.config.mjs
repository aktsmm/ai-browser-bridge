import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      ".output/**",
      ".wxt/**",
      "node_modules/**",
      "public/**",
      "standalone-bridge/out/**",
      "store-assets/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["entrypoints/**/*.{ts,tsx}", "wxt.config.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        browser: "readonly",
        btoa: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        defineBackground: "readonly",
        defineContentScript: "readonly",
        document: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        navigator: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
