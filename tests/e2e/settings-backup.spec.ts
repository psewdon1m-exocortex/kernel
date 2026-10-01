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
  await expect(card.locator(".backup-content > .settings-group > h3")).toHaveText(["Manual snapshot", "Automatic backup to Saturn", "Restore snapshot"]);
  await expect(card.locator(".exo-policy-status:visible")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Link Neptune agent", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Unlink Neptune agent", exact: true })).toHaveCount(0);
  await expect(card.getByRole("checkbox", { name: "Enable automatic backups" })).toBeDisabled();
  await expect(card.getByRole("spinbutton", { name: "Interval in hours" })).toHaveValue("24");
  const metrics = await card.evaluate(root => {
    const groups = [...root.querySelector(".backup-content")!.children].map(node => node.getBoundingClientRect());
    return { groups: groups.slice(1).map((group, index) => group.y - groups[index].bottom) };
  });
  for (const gap of metrics.groups) expect(gap).toBeCloseTo(54, 0);
  for (const name of ["Create and download snapshot", "Browse local snapshot archive"]) {
    const action = card.getByRole("button", { name, exact: true });
    await expect(action).toHaveCSS("width", "742px");
    await expect(action).toHaveCSS("height", "40px");
  }
  await expect(card.getByRole("button", { name: "Link Neptune agent", exact: true })).toHaveCSS("width", "280px");
});

test("a linked single pipeline has compact controls; an outage exposes a bounded retry action", async ({ page }) => {
  let offline = false;
  await page.route("**/api/neptune/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { installed: true, linked: true, state: offline ? "unavailable" : "linked", version: "0.1.9", policy_protocol: 1, policy_supported: true } });
    if (path.endsWith("/policy/runs")) return route.fulfill({ json: { jobs: [] } });
    if (path.endsWith("/policy")) return offline
      ? route.fulfill({ status: 503, json: { code: "NEPTUNE_UNAVAILABLE", error: "Neptune is unavailable. Check the connection and retry." } })
      : route.fulfill({ json: { schema: "exocortex.backup.policy.v1", revision: 4, appliedRevision: 4, paused: false, archive: { enabled: false, intervalHours: 24 }, mirror: null, observed: {} } });
    await route.continue();
  });
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await expect(card.getByRole("button", { name: "Back up to Saturn now", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Initialize", exact: true })).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "Automatic recovery archive", exact: true })).toBeHidden();
  const input = card.getByRole("spinbutton", { name: "Interval in hours · archive", exact: true });
  await expect(input).toHaveValue("24");
  const unlink = card.getByRole("button", { name: "Unlink Neptune agent", exact: true });
  await expect(unlink).toBeVisible();
  await expect(unlink).toBeEnabled();
  await expect(unlink).toHaveCSS("color", "rgb(248, 61, 61)");
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

test("unlink confirms scope and follows the durable job", async ({ page }) => {
  let linked = true;
  let submissions = 0;
  await page.route("**/api/neptune/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { installed: true, linked, state: linked ? "linked" : "unlinked", version: "0.1.9", policy_protocol: 1, policy_supported: true } });
    if (path.endsWith("/policy/runs")) return route.fulfill({ json: { jobs: [] } });
    if (path.endsWith("/policy")) return route.fulfill({ json: { schema: "exocortex.backup.policy.v1", revision: 4, appliedRevision: 4, paused: false, archive: { enabled: false, intervalHours: 24 }, mirror: null, observed: {} } });
    if (path.endsWith("/unlink")) { submissions += 1; linked = false; return route.fulfill({ status: 202, json: { id: "neptune-unlink-test", state: "REQUESTED" } }); }
    await route.continue();
  });
  await page.route("**/api/updater/jobs/neptune-unlink-test", route => route.fulfill({ json: { id: "neptune-unlink-test", state: "COMPLETED" } }));
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await card.getByRole("button", { name: "Unlink Neptune agent" }).click();
  await expect(page.getByRole("dialog")).toContainText("Other services and the shared Neptune agent stay connected.");
  expect(submissions).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Unlink agent" }).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(card.getByRole("button", { name: "Link Neptune agent" })).toBeVisible();
});

test("an outdated local agent is identified before policy requests are sent", async ({ page }) => {
  let policyRequests = 0;
  await page.route("**/api/neptune/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { installed: true, linked: true,
      state: "upgrade_required", version: "0.1.8", policy_protocol: 0, policy_supported: false, required_policy_protocol: 1 } });
    if (path.includes("/policy")) policyRequests++;
    await route.continue();
  });
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await expect(card.locator(".reachability-row")).toContainText("Upgrade required · policy protocol unavailable");
  await expect(card.getByText("Update Saturn and Neptune to enable service-owned backup policy controls.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Retry policy status", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Back up to Saturn now", exact: true })).toHaveCount(0);
  expect(policyRequests).toBe(0);
});

test("an outdated Saturn backend is terminal until the operator updates and reloads", async ({ page }) => {
  let policyRequests = 0;
  await page.route("**/api/neptune/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { installed: true, linked: true,
      state: "linked", version: "0.1.9", policy_protocol: 1, policy_supported: true, required_policy_protocol: 1 } });
    if (path.endsWith("/policy")) {
      policyRequests++;
      return route.fulfill({ status: 426, json: { code: "NEPTUNE_POLICY_UPGRADE_REQUIRED",
        error: "Saturn does not provide the service-owned backup policy protocol. Update Saturn before Neptune, then retry." } });
    }
    await route.continue();
  });
  await openSettings(page);
  const card = page.locator("[data-settings-section='backup']");
  await expect(card.getByText("Saturn does not provide the service-owned backup policy protocol. Update Saturn before Neptune, then retry.", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Retry policy status", exact: true })).toHaveCount(0);
  await page.waitForTimeout(5_500);
  expect(policyRequests).toBe(1);
});
