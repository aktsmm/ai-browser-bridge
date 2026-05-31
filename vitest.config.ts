import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/standalone-bridge/out/**",
    ],
  },
});
