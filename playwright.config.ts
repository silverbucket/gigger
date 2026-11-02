import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./web/e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  timeout: 45000,
  use: {
    locale: "en-US",
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
