import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const AUTH_DIR = path.join(__dirname, ".auth");

setup.beforeAll(() => {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
});

const ROLES = [
  { email: "admin@renegade.com",   password: "Test1234!", file: "admin" },
  { email: "manager@renegade.com", password: "Test1234!", file: "manager" },
  { email: "staff@renegade.com",   password: "Test1234!", file: "staff" },
];

for (const { email, password, file } of ROLES) {
  setup(`authenticate as ${file}`, async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await page.context().storageState({ path: path.join(AUTH_DIR, `${file}.json`) });
  });
}
