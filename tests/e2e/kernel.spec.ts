import { expect, test } from "@playwright/test";

async function navigate(page: import("@playwright/test").Page, name: string) {
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible()) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  } else {
    await page.mouse.move(1, 200);
  }
  await page.getByRole("button", { name }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "KERNEL", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Service Reachability");
  const accessKey = page.getByLabel("Access Key", { exact: true });
  await accessKey.focus();
  await expect(accessKey).toHaveCSS("outline-color", "rgb(0, 168, 255)");
  await accessKey.fill("browser-test-access-key");
  await accessKey.press("Enter");
  await expect(page.locator(".page-title h1")).toHaveText("dashboard");
});

test("operator can navigate every Kernel section", async ({ page }) => {
  await page.setViewportSize({ width: 1919, height: 1034 });
  await expect(page).toHaveTitle("KERNEL");
  await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", "/kernel-icon.png");
  await expect(page.getByText("PASSIVE REGISTRY · ONE VPS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("EXOCORTEX / VPS", { exact: true })).toHaveCount(0);
  await expect(page.locator(".system-line .status-indicator")).toHaveCount(0);
  await expect(page.locator("[data-dashboard-node]")).toHaveCount(7);
  await expect(page.getByLabel("CPU Usage telemetry")).toBeVisible();
  await expect(page.getByLabel("RAM Usage telemetry")).toBeVisible();
  await expect(page.getByLabel("Disk Usage telemetry")).toBeVisible();
  await expect(page.getByLabel("Uptime telemetry")).toBeVisible();
  for (const service of ["KERNEL", "Saturn", "Volt"]) {
    await expect(page.getByLabel(new RegExp(`^${service} availability:`))).toBeVisible();
  }
  for (const service of ["chronos", "perimetr", "laboratory"]) {
    await expect(page.locator(`[data-service-id='${service}']`)).toHaveCount(0);
  }
  await expect(page.locator("[data-service-id='neptune']")).toHaveCount(0);
  await expect(page.locator("[data-service-id='updater']")).toHaveCount(0);
  const sidebarGeometry = await page.locator(".sidebar").boundingBox();
  const headerGeometry = await page.locator(".page-title").boundingBox();
  const titleGeometry = await page.locator(".page-title h1").boundingBox();
  expect(sidebarGeometry).toMatchObject({ x: 0, y: 0, width: 250 });
  expect(headerGeometry).toMatchObject({ x: 250, y: 0, height: 123 });
  expect(titleGeometry?.x).toBeCloseTo(280, 0);
  await expect(page.locator(".page-title h1")).toHaveCSS("font-size", "80px");
  const originalOrder = await page.locator("[data-dashboard-node]").evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-dashboard-node")),
  );
  await page.getByLabel("Reorder CPU Usage").dragTo(page.getByLabel("Reorder Uptime"));
  const movedOrder = await page.locator("[data-dashboard-node]").evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-dashboard-node")),
  );
  const expectedOrder = [...originalOrder];
  const cpuIndex = expectedOrder.indexOf("cpu");
  const uptimeIndex = expectedOrder.indexOf("uptime");
  [expectedOrder[cpuIndex], expectedOrder[uptimeIndex]] = [expectedOrder[uptimeIndex], expectedOrder[cpuIndex]];
  expect(movedOrder).toEqual(expectedOrder);
  await page.reload();
  await expect(page.locator(".page-title h1")).toHaveText("dashboard");
  const restoredOrder = await page.locator("[data-dashboard-node]").evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-dashboard-node")),
  );
  expect(restoredOrder).toEqual(expectedOrder);
  await expect(page.locator(".metric-card").first()).toHaveCSS("height", "166px");
  await expect(page.locator(".page-title")).toHaveCSS("height", "123px");
  const cards = await page.locator(".metric-card").evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(Math.abs(cards[0].x - 280)).toBeLessThanOrEqual(1);
  expect(Math.abs(cards[0].width - 790)).toBeLessThanOrEqual(1);
  expect(cards[0]).toMatchObject({ y: 151, height: 166 });
  expect(Math.abs(cards[1].x - 1100)).toBeLessThanOrEqual(1);
  expect(Math.abs(cards[1].width - 790)).toBeLessThanOrEqual(1);
  expect(cards[1]).toMatchObject({ y: 151, height: 166 });
  const serviceCards = await page.locator(".service-status-card").evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(serviceCards).toHaveLength(3);
  expect(Math.abs(serviceCards[0].x - 280)).toBeLessThanOrEqual(1);
  expect(Math.abs(serviceCards[0].width - 790)).toBeLessThanOrEqual(1);
  expect(serviceCards[0]).toMatchObject({ y: 543, height: 166 });
  expect(Math.abs(serviceCards[1].x - 1100)).toBeLessThanOrEqual(1);
  expect(Math.abs(serviceCards[1].width - 790)).toBeLessThanOrEqual(1);
  expect(serviceCards[1]).toMatchObject({ y: 543, height: 166 });

  await navigate(page, "Overview");
  await expect(page.locator(".page-title h1")).toHaveText("overview");
  await expect(page.getByRole("heading", { name: "EXOCORTEX", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "6. Volt 0.1.5", exact: true })).toBeVisible();

  await navigate(page, "Constitution");
  await expect(page.locator(".page-title h1")).toHaveText("constitution");
  await expect(
    page.getByRole("article").getByRole("heading", { name: "EXOCORTEX CONSTITUTION", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "11.1 Текущий coordinated profile", exact: true })).toBeVisible();

  await navigate(page, "Register");
  await expect(page.locator(".page-title h1")).toHaveText("register");
  await expect(page.locator(".nav-item > span").filter({ hasText: /^Register$/ })).toHaveText("Register");
  const registerSearch = page.getByRole("searchbox", { name: "Search Register" });
  const searchFieldBox = await page.locator(".register-toolbar .search-field").boundingBox();
  const searchInputBox = await registerSearch.boundingBox();
  expect((searchInputBox?.x ?? 0) - (searchFieldBox?.x ?? 0)).toBeCloseTo(1, 0);
  await expect(registerSearch).toHaveCSS("padding-left", "12px");
  await registerSearch.fill("services.kernel.sni");
  const clearRegisterSearch = page.locator(".register-toolbar").getByRole("button", { name: "Clear search" });
  await expect(clearRegisterSearch).toBeVisible();
  await clearRegisterSearch.click();
  await expect(registerSearch).toHaveValue("");
  await expect(registerSearch).toBeFocused();
  await expect(clearRegisterSearch).toHaveCount(0);
  await expect(page.getByText("services.kernel.sni", { exact: true })).toBeVisible();
  await expect(page.getByText("services.kernel.port", { exact: true })).toBeVisible();
  await expect(page.getByText("services.saturn.port", { exact: true })).toBeVisible();

  await navigate(page, "Settings");
  await expect(page.locator(".page-title h1")).toHaveText("settings");
  for (const name of ["Appearance", "Security", "Backup", "Updates", "Logs", "Documents"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Connection with Kernel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Register", exact: true })).toHaveCount(0);
  const logger = page.locator("[data-settings-section='logs']");
  await expect(logger.getByLabel(/Log internal-service revision requests/)).toBeVisible();
  await expect(logger.getByRole("link", { name: "Download archived logs" })).toHaveAttribute(
    "href",
    "/api/logs/download",
  );
  const auditRows = logger.locator(".audit-list > div");
  await expect(auditRows.first()).toContainText("TYPE");
  await expect(auditRows.locator("time").first()).toHaveText(
    /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/,
  );
  const backupSection = page.locator("[data-settings-section='backup']");
  const backupGeometry = await backupSection.boundingBox();
  expect(Math.abs((backupGeometry?.width ?? 0) - 1610)).toBeLessThanOrEqual(1);
  expect(backupGeometry?.height).toBeCloseTo(782, 0);
  await expect(backupSection.getByRole("button", { name: "Create and download snapshot" })).toBeVisible();
  await expect(backupSection.getByRole("button", { name: "Browse local snapshot archive" })).toBeVisible();
  await expect(backupSection.getByText("Local Neptune agent:", { exact: true })).toBeVisible();
  await expect(backupSection.getByRole("heading", { name: "Automatic backup to Saturn" })).toBeVisible();
  await expect(backupSection.getByText(/Schedules, remote runs and Neptune fleet status are managed only from Saturn/)).toBeVisible();
  const updatesSection = page.locator("[data-settings-section='updates']");
  const updatesGeometry = await updatesSection.boundingBox();
  expect(Math.abs((updatesGeometry?.width ?? 0) - 1610)).toBeLessThanOrEqual(1);
  expect(updatesGeometry?.height).toBeCloseTo(606, 0);
  await expect(updatesSection.getByText("Local updater agent:", { exact: true })).toBeVisible();
  await expect(updatesSection.getByText("Kernel Register:", { exact: true })).toBeVisible();
  await expect(updatesSection.getByRole("button", { name: "Check for updates" })).toBeVisible();
  await expect(updatesSection.getByRole("heading", { name: "Updater version", exact: true })).toBeVisible();
  await expect(updatesSection.getByRole("button", { name: "Check Updater for updates" })).toBeVisible();

  await navigate(page, "Documentation");
  await expect(page.locator(".page-title h1")).toHaveText("documentation");
  await expect(page.getByText("Kernel 0.2.10 / Operator Guide", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome To Kernel" })).toBeVisible();
  const documentationSearch = page.getByLabel("Search documentation");
  await documentationSearch.fill("last-known-good");
  await expect(page.getByRole("heading", { name: "Introduction", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Installation", exact: true })).toHaveCount(0);
  await documentationSearch.fill("no-such-kernel-topic");
  await expect(page.getByText("No documentation sections match this search.")).toBeVisible();
  const clearDocumentationSearch = page.locator(".documentation-nav").getByRole("button", { name: "Clear search" });
  await clearDocumentationSearch.click();
  await expect(documentationSearch).toHaveValue("");
  await expect(documentationSearch).toBeFocused();
});

test("Documentation follows the bounded two-scroll-region contract", async ({ page }) => {
  await page.setViewportSize({ width: 1919, height: 1034 });
  await navigate(page, "Documentation");

  const workspace = page.locator(".documentation-page");
  const navigation = page.getByLabel("Documentation navigation");
  const article = page.getByRole("region", { name: "Kernel operator guide" });
  const workspaceBox = await workspace.boundingBox();
  const navigationBox = await navigation.boundingBox();
  const articleBox = await article.boundingBox();

  expect(workspaceBox).toMatchObject({ x: 280, y: 151, height: 843 });
  expect(Math.abs((workspaceBox?.width ?? 0) - 1610)).toBeLessThanOrEqual(1);
  expect(navigationBox?.width).toBeCloseTo(220, 0);
  expect(navigationBox?.height).toBeCloseTo(843, 0);
  expect(articleBox?.width).toBeCloseTo(1120, 0);
  expect(articleBox?.height).toBeCloseTo(843, 0);
  await expect(navigation).toHaveCSS("overflow-y", "auto");
  await expect(article).toHaveCSS("overflow-y", "auto");
  await expect(navigation).toHaveCSS("overscroll-behavior-y", "contain");
  await expect(article).toHaveCSS("overscroll-behavior-y", "contain");

  const initialOffsets = await page.evaluate(() => ({
    page: window.scrollY,
    navigation: document.querySelector<HTMLElement>(".documentation-nav")?.scrollTop ?? -1,
  }));
  await page.getByRole("button", { name: "Topology Map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Topology Map", exact: true })).toHaveAttribute("aria-current", "location");
  await expect.poll(async () => article.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => {
    const owner = document.querySelector<HTMLElement>(".documentation-content");
    const target = document.getElementById("docs-topology");
    if (!owner || !target) return Number.POSITIVE_INFINITY;
    return Math.abs(target.getBoundingClientRect().top - owner.getBoundingClientRect().top - 30);
  })).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialOffsets.page);
  expect(await navigation.evaluate((owner) => owner.scrollTop)).toBe(initialOffsets.navigation);

  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await search.fill("access key");
  expect(await article.evaluate((owner) => owner.scrollTop)).toBe(0);
  await expect(page.getByRole("heading", { name: "Installation", exact: true })).toBeVisible();
  await search.fill("no-such-kernel-topic");
  await expect(page.locator(".documentation-nav-group")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("No documentation sections match this search.");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".documentation-nav-group")).toHaveCount(3);
  await expect(search).toBeFocused();

  const desktopOverflow = await page.evaluate(() => ({
    pageScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    pageClientHeight: document.scrollingElement?.clientHeight ?? 0,
  }));
  expect(desktopOverflow.pageScrollHeight).toBeLessThanOrEqual(desktopOverflow.pageClientHeight + 1);

  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(250);
  const compactWorkspaceBox = await workspace.boundingBox();
  const compactNavigationBox = await navigation.boundingBox();
  const compactArticleBox = await article.boundingBox();
  expect(compactWorkspaceBox).toMatchObject({ x: 20, y: 116, height: 764 });
  expect(compactNavigationBox?.height).toBeGreaterThanOrEqual(150);
  expect((compactArticleBox?.y ?? 0)).toBeGreaterThan((compactNavigationBox?.y ?? 0) + (compactNavigationBox?.height ?? 0));

  const articleOffsetBeforeNavigationScroll = await article.evaluate((owner) => owner.scrollTop);
  const navigationOffset = await navigation.evaluate((owner) => {
    owner.scrollTop = owner.scrollHeight;
    return owner.scrollTop;
  });
  expect(navigationOffset).toBeGreaterThan(0);
  expect(await article.evaluate((owner) => owner.scrollTop)).toBe(articleOffsetBeforeNavigationScroll);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const compactWidth = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
  expect(compactWidth.body).toBeLessThanOrEqual(compactWidth.viewport + 1);
});

test("Register can add, remove and restore an immutable revision", async ({ page }) => {
  const testKey = `test.endpoint.${Date.now()}`;
  const testReference = "volt://11111111-1111-4111-8111-111111111111/1";
  await navigate(page, "Register");
  await page.getByRole("button", { name: "Add mapping" }).click();
  const entryDialog = page.getByRole("dialog", { name: "Add Register mapping" });
  await entryDialog.getByRole("textbox", { name: "Key", exact: true }).fill(testKey);
  await entryDialog.getByRole("textbox", { name: "Volt reference", exact: true }).fill(testReference);
  await entryDialog.getByRole("textbox", { name: "Description", exact: true }).fill("E2E value");
  await entryDialog.getByRole("button", { name: "Save" }).click();

  const card = page.locator(".register-card").filter({ hasText: testKey });
  await expect(card).toContainText(testReference);
  const addedRevision = await page.locator(".revision-box strong").innerText();
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete Register mapping" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: "Versions" }).click();
  const history = page.getByRole("dialog", { name: "Register versions" });
  const source = history.locator(".version-list > div").filter({ hasText: addedRevision });
  await source.getByRole("button", { name: "Restore" }).click();
  const confirm = page.getByRole("dialog", { name: "Restore Register" });
  await confirm.getByRole("button", { name: "Restore" }).click();
  await expect(card).toHaveCount(1);
});

test("Topology embeds Excalidraw across the requested viewport and persists drawings", async ({ page }) => {
  await page.setViewportSize({ width: 1919, height: 1034 });
  await navigate(page, "Topology Map");
  const topology = page.getByLabel("Topology Map editor");
  const editor = topology.locator(".excalidraw");
  const canvas = editor.locator("canvas.excalidraw__canvas.interactive");
  await expect(editor).toBeVisible();
  await expect(canvas).toBeVisible();
  expect(await editor.evaluate((element) => (
    getComputedStyle(element).getPropertyValue("--color-primary").trim()
  ))).toBe("#00a8ff");
  await expect(editor.getByRole("radio", { name: /Rectangle/ })).toBeVisible();
  await expect(editor.getByRole("radio", { name: /Draw/ })).toBeVisible();
  await expect(editor.getByRole("radio", { name: /Text/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Versions", exact: true })).toBeVisible();

  const geometry = await topology.boundingBox();
  expect(geometry?.x).toBeCloseTo(257, 0);
  expect(geometry?.y).toBeCloseTo(129, 0);
  expect(geometry?.width).toBeCloseTo(1654, 0);
  expect(geometry?.height).toBeCloseTo(898, 0);

  const before = await page.evaluate(async () => {
    const response = await fetch("/api/topology");
    return (await response.json()).project.elements.length as number;
  });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Excalidraw canvas geometry is unavailable");
  await page.keyboard.press("r");
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 560, canvasBox.y + 400, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".topology-host-status")).toHaveText("Saved", { timeout: 10_000 });
  const saved = await page.evaluate(async () => {
    const response = await fetch("/api/topology");
    return (await response.json()).project;
  });
  expect(saved.type).toBe("excalidraw");
  expect(saved.elements.length).toBe(before + 1);
  expect(saved.elements.at(-1).type).toBe("rectangle");

  await page.reload();
  await expect(page.getByLabel("Topology Map editor").locator(".excalidraw")).toBeVisible();
  const restoredCount = await page.evaluate(async () => {
    const response = await fetch("/api/topology");
    return (await response.json()).project.elements.length as number;
  });
  expect(restoredCount).toBe(saved.elements.length);
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Topology versions" })).toContainText("ACTIVE");
});

test("fixed sidebar stays visible and scrollbars stay hidden", async ({ page }) => {
  await navigate(page, "Settings");
  const fixed = page.locator("[data-settings-section='appearance']").getByLabel("Keep sidebar fixed on screen");
  if (!(await fixed.isChecked())) await fixed.check();
  await expect(page.locator(".kernel-shell")).toHaveClass(/sidebar-fixed/);
  await page.mouse.move(1200, 500);
  await page.waitForTimeout(250);
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(sidebarBox?.x).toBeGreaterThanOrEqual(0);
  expect(sidebarBox?.width).toBeCloseTo(250, 0);

  const visibleScrollbars = await page.evaluate(() => {
    const elements = [document.documentElement, document.body, ...document.querySelectorAll("*")];
    return elements
      .filter((element) => getComputedStyle(element).scrollbarWidth !== "none")
      .map((element) => element.tagName);
  });
  expect(visibleScrollbars).toEqual([]);
});

test("narrow viewport keeps pages usable without horizontal document overlap", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await navigate(page, "Register");
  await expect(page.getByRole("button", { name: "Add mapping" })).toBeVisible();
  const width = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.body).toBeLessThanOrEqual(width.viewport + 1);
});
