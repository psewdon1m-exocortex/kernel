import { expect, test } from "@playwright/test";

test("creates, rotates and confirms revoke of an Outdoor token without exposing it in the list", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Access Key", { exact: true }).fill("browser-test-access-key");
  await page.getByLabel("Access Key", { exact: true }).press("Enter");
  await expect(page.locator(".page-title h1")).toHaveText("dashboard");
  await page.mouse.move(1, 200);
  await page.getByRole("button", { name: /^Settings/ }).click();
  const panel = page.locator(".outdoor-tokens");
  await expect(panel.getByRole("heading", { name: "Outdoor service tokens" })).toBeVisible();
  const name = `Linux files ${Date.now()}`;
  await panel.getByLabel("Token name", { exact: true }).fill(name);
  await panel.getByRole("button", { name: "Create token", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Outdoor service token", exact: true });
  await expect(dialog).toBeVisible();
  const original = await dialog.getByLabel("Outdoor service token", { exact: true }).inputValue();
  expect(original).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const item = panel.locator(".outdoor-token").filter({ hasText: name });
  await expect(item).toContainText("Active");
  await expect(panel).not.toContainText(original);
  await item.getByRole("button", { name: "Rotate token", exact: true }).click();
  await expect(dialog).toBeVisible();
  const rotated = await dialog.getByLabel("Outdoor service token", { exact: true }).inputValue();
  expect(rotated).not.toBe(original);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await item.getByRole("button", { name: "Revoke", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `Revoke ${name}?`, exact: true });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(item).toContainText("Active");
  await item.getByRole("button", { name: "Revoke", exact: true }).click();
  await confirmation.getByRole("button", { name: "Revoke token", exact: true }).click();
  await expect(item).toContainText("Revoked");
  await expect(item.getByRole("button", { name: "Rotate token", exact: true })).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});
