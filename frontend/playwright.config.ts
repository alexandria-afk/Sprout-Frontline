import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "admin",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      testMatch: /.*\.(admin|shared)\.spec\.ts/,
    },
    {
      name: "manager",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/manager.json" },
      dependencies: ["setup"],
      testMatch: /.*\.(manager|shared)\.spec\.ts/,
    },
    {
      name: "staff",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/staff.json" },
      dependencies: ["setup"],
      testMatch: /.*\.staff\.spec\.ts/,
    },
  ],
});
