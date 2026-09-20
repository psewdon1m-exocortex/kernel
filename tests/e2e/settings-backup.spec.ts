import { expect, test, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/#/settings");
  await page.getByLabel("Access Key", { exact: true }).fill("browser-test-access-key");
  await page.getByRole("button", { name: "Enter service", exact: true }).click();
  await expect(page.locator("[data-settings-section='backup']")).toBeVisible();
}

test("an unenrolled Backup card preserves template spacing and does not report an internal fault", async ({ page }) => {
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await expect(card.getByText("Initialize Neptune to enable automatic backups.", { exact: true })).toBeVisible();
  await expect(card.getByText("Internal server error", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Retry policy status", exact: true })).toBeHidden();
  await expect(card.locator(".reachability-row")).toContainText("Not configured");
  const metrics = await card.evaluate(root => {
    const groups = [...root.querySelector(".backup-content")!.children].map(node => node.getBoundingClientRect());
    const status = root.querySelector(".reachability-row")!.getBoundingClientRect();
    const initialize = root.querySelector(".backup-neptune-actions button")!.getBoundingClientRect();
    return { gap: initialize.y - status.bottom, groups: groups.slice(1).map((group, index) => group.y - groups[index].bottom) };
  });
  expect(metrics.gap).toBeCloseTo(20, 0);
  for (const gap of metrics.groups) expect(gap).toBeCloseTo(40, 0);
  for (const name of ["Create and download snapshot", "Browse local snapshot archive", "Initialize", "Check Neptune for updates"]) {
    const action = card.getByRole("button", { name, exact: true });
    await expect(action).toHaveCSS("width", "326px");
    await expect(action).toHaveCSS("height", "40px");
  }
});

test("a linked single pipeline has compact controls; an outage exposes a bounded retry action", async ({ page }) => {
  let offline = false;
  await page.route("**/api/neptune/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { installed: true, linked: true, state: offline ? "unavailable" : "linked", version: "0.1.8" } });
    if (path.endsWith("/policy/runs")) return route.fulfill({ json: { jobs: [] } });
    if (path.endsWith("/policy")) return offline
      ? route.fulfill({ status: 503, json: { code: "NEPTUNE_UNAVAILABLE", error: "Neptune is unavailable. Check the connection and retry." } })
      : route.fulfill({ json: { schema: "exocortex.backup.policy.v1", revision: 4, appliedRevision: 4, paused: false, archive: { enabled: false, intervalHours: 24 }, mirror: null, observed: {} } });
    await route.continue();
  });
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await expect(card.getByRole("button", { name: "Back up to Saturn now", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Initialize", exact: true })).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "Automatic recovery archive", exact: true })).toBeHidden();
  const input = card.getByRole("spinbutton", { name: "Interval in hours · archive", exact: true });
  await expect(input).toHaveValue("24");
  offline = true;
  await page.reload();
  const retry = card.getByRole("button", { name: "Retry policy status", exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toHaveCSS("width", "326px");
  await expect(retry).toHaveCSS("height", "40px");
  await expect(card.getByRole("button", { name: "Initialize", exact: true })).toHaveCount(0);
  for (const width of [720, 420, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await card.evaluate(root => root.scrollWidth - root.clientWidth)).toBeLessThanOrEqual(1);
  }
});
