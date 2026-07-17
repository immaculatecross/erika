import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit + integration tests only. Playwright e2e lives in e2e/ and runs via
// `npm run test:e2e`, so it is excluded here.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
  },
});
