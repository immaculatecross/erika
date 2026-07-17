import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

// Screenshot any route to a PNG under artifacts/ (gitignored).
//   npm run screenshot -- /            → artifacts/root.png
//   npm run screenshot -- /settings    → artifacts/settings.png
// Boots its own dev server unless SCREENSHOT_BASE_URL points at a running one,
// against a throwaway DB so it never touches data/erika.db.

const route = process.argv[2] ?? "/";
const port = Number(process.env.PORT ?? 3200);
const external = process.env.SCREENSHOT_BASE_URL;
const baseUrl = external ?? `http://127.0.0.1:${port}`;
const outDir = path.join(process.cwd(), "artifacts");

function slug(r: string): string {
  const s = r.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return s === "" ? "root" : s;
}

async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready in time.`);
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  if (!external) {
    server = spawn("npx", ["next", "dev", "-p", String(port)], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, ERIKA_DB_PATH: ".playwright/screenshot.db" },
    });
  }
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${slug(route)}.png`);
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    console.error(`wrote ${out}`);
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
