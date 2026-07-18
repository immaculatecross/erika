import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit + integration tests only. Playwright e2e lives in e2e/ and runs via
// `npm run test:e2e`, so it is excluded here. `.tsx` is included for the
// render-level tests (E-17), which use react-dom/server and need no DOM.
export default defineConfig({
  // tsconfig sets jsx "preserve" for Next's own compiler; vitest transforms the
  // render-level tests itself, so it needs the automatic runtime spelled out.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "e2e"],
  },
});
