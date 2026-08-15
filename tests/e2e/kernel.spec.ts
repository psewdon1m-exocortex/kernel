import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
  await expect(page.getByRole("status")).toHaveText("AVAILABLE");
  const login = page.getByLabel("Login", { exact: true });
  await login.focus();
  await expect(login).toHaveCSS("outline-style", "none");
  await expect(login).toHaveCSS("border-top-color", "rgb(0, 168, 255)");
  await login.fill("browser-operator");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("browser-test-password");
  await password.press("Enter");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("operator can navigate every Kernel section", async ({ page }) => {
  await expect(page).toHaveTitle("kernel");
  await expect(page.getByText("PASSIVE REGISTRY · ONE VPS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("EXOCORTEX / VPS", { exact: true })).toHaveCount(0);
  await expect(page.locator(".system-line .status-indicator")).toHaveCount(0);
  await expect(page.locator("[data-dashboard-node]")).toHaveCount(4);
  await expect(page.getByLabel("CPU telemetry")).toBeVisible();
  await expect(page.getByLabel("RAM telemetry")).toBeVisible();
  await expect(page.getByLabel("DISK telemetry")).toBeVisible();
  await expect(page.getByLabel("UPTIME telemetry")).toBeVisible();
  await page.getByLabel("CPU telemetry").dragTo(page.getByLabel("UPTIME telemetry"));
  const movedOrder = await page.locator("[data-dashboard-node]").evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-dashboard-node")),
  );
  expect(movedOrder).toEqual(["uptime", "ram", "disk", "cpu"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const restoredOrder = await page.locator("[data-dashboard-node]").evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute("data-dashboard-node")),
  );
  expect(restoredOrder).toEqual(["uptime", "ram", "disk", "cpu"]);

  await navigate(page, "Overview");
  await expect(page.getByRole("heading", { name: "EXOCORTEX", exact: true })).toBeVisible();

  await navigate(page, "Constitution");
  await expect(
    page.getByRole("article").getByRole("heading", { name: "EXOCORTEX CONSTITUTION", exact: true }),
  ).toBeVisible();

  await navigate(page, "Register");
  await expect(page.getByText("services.kernel.sni", { exact: true })).toBeVisible();
  await expect(page.getByText("services.kernel.port", { exact: true })).toBeVisible();
  await expect(page.getByText("services.perimetr.port", { exact: true })).toBeVisible();

  await navigate(page, "Settings");
  await expect(page.getByRole("heading", { name: "APPEARANCE" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DOCUMENTS" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "UPDATER" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible();
  await expect(page.getByText(/Retention is capped at 10,000 events/)).toBeVisible();
  await expect(page.getByText("Restore backup", { exact: true })).toBeVisible();
  const logger = page.locator(".settings-section").filter({
    has: page.getByRole("heading", { name: "LOGGER" }),
  });
  await expect(logger.getByLabel(/Log every internal-service revision request/)).toBeVisible();
  await expect(logger.getByRole("link", { name: "Download Logs Zip" })).toHaveAttribute(
    "href",
    "/api/logs/download",
  );
  await expect(logger.getByText(/64 MB on disk/)).toBeVisible();
  const auditRows = logger.locator(".audit-list > div");
  await expect(auditRows.first()).toHaveCSS("border-bottom-width", "0px");
  await expect(auditRows.locator("time").first()).toHaveText(
    /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/,
  );
  const appearance = page.locator(".settings-section").filter({
    has: page.getByRole("heading", { name: "APPEARANCE" }),
  });
  await expect(appearance.getByLabel(/Log every internal-service revision request/)).toHaveCount(0);

  await navigate(page, "Documentation");
  await expect(page.getByText("Kernel / Operator Guide", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome To Kernel" })).toBeVisible();
  const documentationSearch = page.getByLabel("Search documentation");
  await documentationSearch.fill("last-known-good");
  await expect(page.getByRole("heading", { name: "Introduction", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Installation", exact: true })).toHaveCount(0);
  await documentationSearch.fill("no-such-kernel-topic");
  await expect(page.getByText("No documentation sections match this search.")).toBeVisible();
});

test("Register can add, remove and restore an immutable revision", async ({ page }) => {
  await navigate(page, "Register");
  await page.getByRole("button", { name: "Add value" }).click();
  await page.getByLabel("Key").fill("test.endpoint");
  await page.getByLabel("Value", { exact: true }).fill("https://test.internal");
  await page.getByLabel("Description").fill("E2E value");
  await page.getByRole("button", { name: "Save" }).click();

  const card = page.locator(".register-card").filter({ hasText: "test.endpoint" });
  await expect(card).toContainText("https://test.internal");
  const addedRevision = await page.locator(".revision-box strong").innerText();
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "DELETE REGISTER VALUE" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: "Versions" }).click();
  const history = page.getByRole("dialog", { name: "REGISTER VERSIONS" });
  const source = history.locator(".version-list > div").filter({ hasText: addedRevision });
  await source.getByRole("button", { name: "Restore" }).click();
  const confirm = page.getByRole("dialog", { name: "RESTORE REGISTER" });
  await confirm.getByRole("button", { name: "Restore" }).click();
  await expect(card).toHaveCount(1);
});

test("Topology uses visual-only Open Node", async ({ page }) => {
  await navigate(page, "Topology Map");
  await expect(page.locator(".on-editor")).toBeVisible();
  await expect(page.getByText("OPEN NODE", { exact: true })).toBeVisible();
  await expect(page.locator(".on-run-controls")).toHaveCount(0);
  await expect(page.locator(".on-timeline")).toHaveCount(0);
  await expect(page.locator(".on-dashboard")).toHaveCount(0);
  await expect(page.getByText("Visual architecture map", { exact: true })).toBeVisible();
  const canvas = page.getByLabel("Infinite graph canvas");
  await canvas.dblclick({ position: { x: 520, y: 280 } });
  await page.getByRole("button", { name: /Nodes/ }).click();
  await expect(page.locator(".on-library-tile", { hasText: "module" })).toHaveCount(1);
  await expect(page.locator(".on-library-tile", { hasText: "document" })).toHaveCount(1);
  await expect(page.locator(".on-library-grid .on-library-tile")).toHaveCount(2);
  await page.getByRole("button", { name: "Close Library" }).click();
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByRole("dialog", { name: "TOPOLOGY VERSIONS" })).toContainText("ACTIVE");
});

test("document Node exposes browser open and persists downloaded bytes", async ({ page }) => {
  test.setTimeout(45_000);
  await navigate(page, "Topology Map");
  const canvas = page.getByLabel("Infinite graph canvas");
  await canvas.dblclick({ position: { x: 520, y: 280 } });
  await page.getByRole("button", { name: /Nodes/ }).click();
  const documents = page.locator(".on-world > .on-node[data-node-type-id='exocortex.architecture.document']");
  const before = await documents.count();
  await page.locator(".on-library-tile", { hasText: "document" }).dblclick();
  await expect(documents).toHaveCount(before + 1);

  const documentNode = documents.last();
  const contents = "# Browser-backed document\n\nPersistent attachment content.\n";
  await documentNode.getByLabel("Upload document").setInputFiles({
    name: "architecture-guide.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(contents),
  });
  await expect(page.locator(".on-statusbar")).toContainText("Attached architecture-guide.md");
  await expect(documentNode).toContainText("architecture-guide.md");
  await expect(documentNode.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(documentNode.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(page.locator(".topology-meta")).toContainText("Saved");

  const documentId = await documentNode.getAttribute("data-node-id");
  if (!documentId) throw new Error("Document Node id is unavailable");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Topology canvas geometry is unavailable");
  await canvas.dispatchEvent("dblclick", {
    bubbles: true,
    button: 0,
    clientX: canvasBox.x + 120,
    clientY: canvasBox.y + 120,
  });
  await page.getByRole("button", { name: /Containers/ }).click();
  await page.locator(".on-library-tile", { hasText: "Empty Container" }).dblclick();
  const container = page.locator(".on-container").last();
  const containerHeader = container.locator("> header");
  const initialContainerBox = await containerHeader.boundingBox();
  if (!initialContainerBox) throw new Error("Topology geometry is unavailable");
  await page.mouse.move(initialContainerBox.x + initialContainerBox.width / 2, initialContainerBox.y + initialContainerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.74, canvasBox.y + 290, { steps: 8 });
  await page.mouse.up();

  const nodeHeader = documentNode.locator("> header");
  const nodeBox = await nodeHeader.boundingBox();
  const targetBox = await container.boundingBox();
  if (!nodeBox || !targetBox) throw new Error("Document container drop geometry is unavailable");
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator(`.on-world > .on-node[data-node-id='${documentId}']`)).toHaveCount(0);
  const containedDocument = container.locator(`.on-contained-node.is-browser-document[data-node-id='${documentId}']`);
  await expect(containedDocument).toContainText("architecture-guide.md");
  await expect(containedDocument.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(containedDocument.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(containedDocument.getByText("Replace", { exact: true })).toBeVisible();
  await canvas.focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".topology-meta")).toContainText("Saved");

  const downloadPromise = page.waitForEvent("download");
  await containedDocument.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("architecture-guide.md");
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Downloaded document path is unavailable");
  expect(await readFile(downloadPath, "utf8")).toBe(contents);

  await page.reload();
  const restored = page.locator(`.on-contained-node.is-browser-document[data-node-id='${documentId}']`);
  await expect(restored).toContainText("architecture-guide.md");
  await expect(restored.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(restored.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(restored.getByText("Replace", { exact: true })).toBeVisible();
});

test("compatible architecture Nodes can be dropped into Containers", async ({ page }) => {
  await navigate(page, "Topology Map");
  const canvas = page.getByLabel("Infinite graph canvas");
  await expect(canvas).toBeVisible();

  await canvas.dblclick({ position: { x: 520, y: 280 } });
  await page.getByRole("button", { name: /Containers/ }).click();
  await page.locator(".on-library-tile", { hasText: "Empty Container" }).dblclick();
  const container = page.locator(".on-container").last();
  await expect(container).toBeVisible();

  const containerHeader = container.locator("> header");
  const initialContainerBox = await containerHeader.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!initialContainerBox || !canvasBox) throw new Error("Topology geometry is unavailable");
  await page.mouse.move(
    initialContainerBox.x + initialContainerBox.width / 2,
    initialContainerBox.y + initialContainerBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.72, canvasBox.y + 260, { steps: 8 });
  await page.mouse.up();

  await canvas.dblclick({ position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: /Nodes/ }).click();
  await page.locator(".on-library-tile", { hasText: "module" }).dblclick();
  const topLevelNode = page.locator(".on-world > .on-node[data-node-type-id='exocortex.architecture.module']").last();
  await expect(topLevelNode).toBeVisible();
  const topLevelText = topLevelNode.locator("textarea.on-notebook-input");
  const nodeHeader = topLevelNode.locator("> header");
  const nodeBox = await nodeHeader.boundingBox();
  const topLevelNodeBox = await topLevelNode.boundingBox();
  const topLevelTextBox = await topLevelText.boundingBox();
  const targetBox = await container.boundingBox();
  if (!nodeBox || !topLevelNodeBox || !topLevelTextBox || !targetBox) throw new Error("Topology drop geometry is unavailable");
  const containedBefore = await container.locator(".on-contained-node").count();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 12 });
  await page.mouse.up();

  await expect(container.locator(".on-contained-node")).toHaveCount(containedBefore + 1);
  const containedNode = container.locator(".on-contained-node[data-node-type-id='exocortex.architecture.module']").last();
  const containedText = containedNode.locator("textarea.on-notebook-input");
  await expect(containedText).toBeVisible();
  const containedNodeBox = await containedNode.boundingBox();
  const containedTextBox = await containedText.boundingBox();
  if (!containedNodeBox || !containedTextBox) throw new Error("Contained Node text geometry is unavailable");
  const topLevelWidthRatio = topLevelTextBox.width / topLevelNodeBox.width;
  const containedWidthRatio = containedTextBox.width / containedNodeBox.width;
  expect(Math.abs(containedWidthRatio - topLevelWidthRatio)).toBeLessThan(0.12);
});

test("Topology keeps annotations and module text after save and reload", async ({ page }) => {
  await navigate(page, "Topology Map");
  const canvas = page.getByLabel("Infinite graph canvas");
  const annotations = page.locator(".on-annotation.is-rectangle");
  const annotationsBefore = await annotations.count();

  await canvas.dblclick({ position: { x: 520, y: 280 } });
  await page.locator("button[title='Rectangle']").click();
  await canvas.click({ position: { x: 240, y: 220 } });
  await expect(annotations).toHaveCount(annotationsBefore + 1);

  await canvas.dblclick({ position: { x: 520, y: 280 } });
  await page.getByRole("button", { name: /Nodes/ }).click();
  const modules = page.locator(".on-world > .on-node[data-node-type-id='exocortex.architecture.module']");
  const modulesBefore = await modules.count();
  await page.locator(".on-library-tile", { hasText: "module" }).dblclick();
  await expect(modules).toHaveCount(modulesBefore + 1);
  const module = modules.last();
  const text = module.locator("textarea.on-notebook-input");
  await expect(text).toHaveValue("");
  await expect(text).toHaveCSS("background-image", "none");
  await expect(text).toHaveCSS("color", "rgb(238, 241, 247)");
  expect(await module.evaluate((element) => getComputedStyle(element).getPropertyValue("--element-color").trim())).toBe("#ffffff");
  const nodeBeforeResize = await module.boundingBox();
  const textBeforeResize = await text.boundingBox();
  const resizeHandle = module.locator(".on-resize-handle.is-se");
  const resizeBox = await resizeHandle.boundingBox();
  if (!nodeBeforeResize || !textBeforeResize || !resizeBox) throw new Error("Module resize geometry is unavailable");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 140, resizeBox.y + 90, { steps: 8 });
  await page.mouse.up();
  const nodeAfterResize = await module.boundingBox();
  const textAfterResize = await text.boundingBox();
  expect(nodeAfterResize?.width).toBeGreaterThan(nodeBeforeResize.width);
  expect(nodeAfterResize?.height).toBeGreaterThan(nodeBeforeResize.height);
  expect(textAfterResize?.width).toBeGreaterThan(textBeforeResize.width);
  expect(textAfterResize?.height).toBeGreaterThan(textBeforeResize.height);
  await text.fill("Persistent architecture note");
  await text.blur();
  await expect(page.locator(".topology-meta")).toContainText("Saved");

  await page.reload();
  await expect(annotations).toHaveCount(annotationsBefore + 1);
  await expect(modules.last().locator("textarea.on-notebook-input")).toHaveValue("Persistent architecture note");
});

test("fixed sidebar stays visible and scrollbars stay hidden", async ({ page }) => {
  await navigate(page, "Settings");
  const fixed = page.getByLabel("Keep sidebar fixed on screen");
  if (!(await fixed.isChecked())) await fixed.check();
  await expect(page.locator(".kernel-shell")).toHaveClass(/sidebar-fixed/);
  await page.mouse.move(1200, 500);
  await page.waitForTimeout(250);
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(sidebarBox?.x).toBeGreaterThanOrEqual(0);
  expect(sidebarBox?.width).toBeCloseTo(242, 0);

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
  await expect(page.getByRole("button", { name: "Add value" })).toBeVisible();
  const width = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.body).toBeLessThanOrEqual(width.viewport + 1);
});
