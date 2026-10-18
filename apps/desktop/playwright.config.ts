import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5286", browserName: "chromium", viewport: { width: 720, height: 480 } },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 5286", url: "http://127.0.0.1:5286/e2e/picker.html", reuseExistingServer: false },
});
