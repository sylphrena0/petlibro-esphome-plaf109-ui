import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["build/**", "node_modules/**"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        EventSource: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLSelectElement: "readonly",
        MessageEvent: "readonly",
        Event: "readonly",
        Response: "readonly",
        console: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        customElements: "readonly",
      },
    },
  },
);
