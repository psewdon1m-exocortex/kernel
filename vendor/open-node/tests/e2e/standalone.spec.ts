import { expect, test } from "@playwright/test";

test("standalone graph renders and executes", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Open Node Studio");
  await expect(page.getByLabel("Infinite graph canvas")).toBeVisible();
  await expect(page.locator(".on-node")).toHaveCount(4);
  await expect(page.locator(".on-container")).toHaveCount(1);
  await expect(page.locator(".on-minimap")).toBeVisible();
  await expect(page.getByText(/Zoom \d+%/)).toBeVisible();

  await page.getByRole("button", { name: "▶ Run" }).click();
  await expect(page.getByText("Execution completed")).toBeVisible();
  await expect(page.locator(".on-status-dot.is-success")).toBeVisible();
});

test("Library search, theme and Timeline controls are interactive", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Infinite graph canvas").dblclick({ position: { x: 20, y: 20 } });
  await expect(page.locator(".on-library-overlay")).toBeVisible();
  const search = page.getByPlaceholder("Search Nodes and Containers…");
  await search.fill("parse number");
  await expect(page.locator(".on-library-tile-title", { hasText: "Parse Number" })).toBeVisible();
  await page.getByLabel("Toggle theme").click();
  await expect(page.locator(".on-editor")).toHaveAttribute("data-theme", "light");

  const scrubber = page.locator(".on-scrubber");
  await scrubber.fill("4");
  await expect(page.locator(".on-timecode")).toContainText("00:04");
});

test("viewport can return to origin and readonly state is serializable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Origin" }).click();
  const serialized = await page.evaluate(() => window.openNode.serialize());
  expect(serialized.format).toBe("open-node-project");
  expect(serialized.schemaVersion).toBe("1.0.0");
});
