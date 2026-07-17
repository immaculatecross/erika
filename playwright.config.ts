import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// e2e boots a real dev server against a throwaway DB so runs never touch the
// developer's data/erika.db.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // A fake audio input so the mic recorder e2e can capture without hardware,
        // and auto-accept the getUserMedia prompt. Harmless for the other specs.
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ERIKA_DB_PATH: ".playwright/e2e.db", ERIKA_DATA_DIR: ".playwright/e2e-data" },
  },
});
