import { describe, expect, it } from "vitest";
import { createAnnotation, createContainer, createEmptyProject, createGroup, type ComputationalConnection, type DecorativeConnection, type NodeInstance } from "@open-node/model";
import { createDefaultConfig, importConfig, loadProjectJson, packProject, parseConfig, serializeProject, unpackProject } from "@open-node/io";

describe("project IO", () => {
  it("round-trips canonical JSON", () => {
    const project = createEmptyProject("Round trip");
    project.viewport = { x: 220, y: -80, zoom: 0.75 };
    project.settings.panelLayout = { library: { position: { x: 310, y: 190 }, size: { width: 760, height: 520 } } };
    project.settings.connectionsVisible = false;
    project.settings.grid.snapping = true;
    project.settings.recentLibraryItems = [{ kind: "node", id: "open-node.core.color" }, { kind: "container", id: "empty" }];
    project.annotations.push(createAnnotation("diamond", { x: 90, y: 120 }));
    const report = loadProjectJson(serializeProject(project));
    expect(report.valid).toBe(true);
    expect(report.project?.metadata.name).toBe("Round trip");
    expect(report.project?.viewport).toEqual(project.viewport);
    expect(report.project?.settings.panelLayout).toEqual(project.settings.panelLayout);
    expect(report.project?.settings.connectionsVisible).toBe(false);
    expect(report.project?.settings.grid.snapping).toBe(true);
    expect(report.project?.settings.recentLibraryItems).toEqual(project.settings.recentLibraryItems);
    expect(report.project?.annotations[0]?.annotationType).toBe("diamond");
  });

  it("losslessly round-trips the complete project state through JSON and ZIP", () => {
    const project = createEmptyProject("Complete round trip");
    project.metadata.description = "Every durable project field";
    project.metadata.updatedAt = "2026-07-25T12:00:00.000Z";
    project.metadata.tags = ["round-trip", "layout"];
    project.dependencies.push({ packageId: "acme.nodes", version: "2.1.0", integrity: "sha256-example", required: true });
    project.settings = {
      theme: "light",
      grid: { enabled: false, step: 32, majorEvery: 8, color: "#123456", opacity: 0.42, snapping: true },
      minimapVisible: false,
      timelineVisible: false,
      dashboardVisible: false,
      reducedMotion: true,
      previewQuality: "high",
      connectionRouting: "orthogonal",
      connectionsVisible: false,
      portsVisible: false,
      groupsVisible: false,
      annotationsVisible: false,
      recentLibraryItems: [{ kind: "node", id: "acme.math.source" }, { kind: "container", id: "preset-container" }],
      panelLayout: { library: { position: { x: 345, y: 123 }, size: { width: 812, height: 566 } } },
    };
    project.execution = {
      mode: "timeline",
      concurrency: 7,
      preferredBackend: "worker",
      cacheEnabled: false,
      nodeTimeoutMs: 12_345,
      continuousQueueSize: 19,
      backpressure: "block",
    };
    project.timeline = {
      enabled: true,
      fps: 60,
      durationSeconds: 24,
      startTime: 2,
      endTime: 22,
      loop: true,
      playbackRate: 1.25,
      timeUnit: "frames",
      currentTime: 9.5,
    };
    project.viewport = { x: -420.5, y: 318.25, zoom: 1.375 };
    project.background = { type: "image", assetId: "asset-image", fit: "contain", scale: 1.5, opacity: 0.73, offset: { x: 18, y: -22 }, binding: "world" };

    const source: NodeInstance = {
      id: "node-source",
      kind: "node",
      nodeTypeId: "acme.math.source",
      nodeTypeVersion: "2.1.0",
      position: { x: -300, y: -120 },
      size: { width: 272, height: 184 },
      label: "Configured source",
      color: "#ef8354",
      bypassed: true,
      parameters: { value: 37, nested: { mode: "precise", weights: [1, 0.5, 0.25] } },
      ports: [{ id: "value", label: "Value", direction: "output", kind: "data", typeId: "core.float", dynamic: true }],
      parentContainerId: null,
      parentGroupId: null,
      uiState: { previewEnabled: true, expandedSections: ["parameters"] },
      runtimeHints: { preferredBackend: "worker", priority: 8, cacheEnabled: false },
      tags: ["custom", "source"],
      unresolved: { reason: "Optional plugin unavailable", rawState: { pluginState: { revision: 4 } } },
    };
    const target: NodeInstance = {
      id: "node-target",
      kind: "node",
      nodeTypeId: "acme.output.target",
      nodeTypeVersion: "1.4.0",
      position: { x: 260, y: 40 },
      size: { width: 250, height: 160 },
      label: "Target",
      color: "#49beaa",
      bypassed: false,
      parameters: { format: "fixed", precision: 3 },
      ports: [{ id: "input", label: "Input", direction: "input", kind: "data", typeId: "core.float", required: true, multiple: false }],
      parentContainerId: null,
      parentGroupId: null,
      uiState: { previewEnabled: false },
      runtimeHints: { timeoutMs: 8_000 },
    };
    const contained: NodeInstance = {
      id: "node-contained",
      kind: "node",
      nodeTypeId: "acme.flow.serial-step",
      nodeTypeVersion: "1.0.0",
      position: { x: 40, y: 40 },
      size: { width: 240, height: 148 },
      label: "Serial step",
      bypassed: false,
      parameters: { operation: "normalize" },
      ports: [
        { id: "input", label: "Input", direction: "input", kind: "data", typeId: "core.any" },
        { id: "output", label: "Output", direction: "output", kind: "data", typeId: "core.any" },
      ],
      parentContainerId: "container-main",
      parentGroupId: null,
      uiState: { inlineEditor: "compact" },
      runtimeHints: {},
    };
    const container = createContainer({ x: -60, y: 280 }, "Configured Container");
    container.id = "container-main";
    container.size = { width: 360, height: 290 };
    container.color = "#ffffff";
    container.collapsed = true;
    container.bypassed = true;
    container.nodeIds = [contained.id];
    container.tags = ["serial"];
    const group = createGroup({ x: -380, y: -220, width: 760, height: 620 }, "Configured Group");
    group.id = "group-main";
    group.color = "#7c5cff";
    group.opacity = 0.27;
    group.borderStyle = "dotted";
    group.collapsed = false;
    group.bypassed = true;
    group.memberNodeIds = [source.id];
    group.memberContainerIds = [container.id];
    group.bypassSnapshot = { [source.id]: false, [container.id]: false };
    group.tags = ["layout"];
    source.parentGroupId = group.id;
    container.parentGroupId = group.id;

    const shape = createAnnotation("diamond", { x: 510, y: -190 });
    shape.id = "annotation-shape";
    shape.size = { width: 230, height: 170 };
    shape.rotation = 31;
    shape.color = "#f7f7ff";
    shape.fillColor = "#4455aa";
    shape.strokeWidth = 6;
    shape.opacity = 0.38;
    const dataConnection: ComputationalConnection = {
      id: "connection-data",
      kind: "data",
      label: "Configured data edge",
      color: "#abcdef",
      source: { elementId: source.id, portId: "value" },
      target: { elementId: target.id, portId: "input" },
      thickness: 4,
      opacity: 0.66,
      dash: [7, 3],
      arrowhead: "both",
      routing: "smooth-step",
      routingOverride: true,
      reroutePoints: [{ x: -20, y: 40 }, { x: 120, y: 70 }],
    };
    const decorativeConnection: DecorativeConnection = {
      id: "connection-decorative",
      kind: "decorative",
      source: { elementId: group.id, normalizedAnchor: { x: 0.1, y: 0.2 } },
      target: { elementId: shape.id, normalizedAnchor: { x: 0.8, y: 0.6 } },
      thickness: 1.5,
      opacity: 0.45,
      arrowhead: "none",
      routing: "straight",
      reroutePoints: [{ x: 400, y: -40 }],
    };

    project.nodes.push(source, target, contained);
    project.containers.push(container);
    project.groups.push(group);
    project.annotations.push(shape);
    project.connections.push(dataConnection, decorativeConnection);
    project.presets.push(
      { id: "preset-node", kind: "node", name: "Saved source", nodeTypeId: source.nodeTypeId, nodeTypeVersion: source.nodeTypeVersion, color: source.color, parameters: structuredClone(source.parameters), uiState: structuredClone(source.uiState) },
      { id: "preset-container", kind: "container", name: "Saved serial flow", color: container.color, nodes: [{ nodeTypeId: contained.nodeTypeId, nodeTypeVersion: contained.nodeTypeVersion, label: contained.label, parameters: structuredClone(contained.parameters), bypassed: contained.bypassed }], errorPolicy: "stop-on-error" },
    );
    project.assets.push({
      id: "asset-image",
      name: "Backdrop",
      storage: "external",
      uri: "https://example.invalid/backdrop.png",
      path: "assets/backdrop.png",
      mimeType: "image/png",
      mediaType: "image",
      size: 4096,
      checksum: "sha256-image",
      metadata: { width: 1920, height: 1080, colorProfile: "display-p3" },
      missing: false,
      embeddedPath: "assets/backdrop.png",
    });

    const jsonReport = loadProjectJson(serializeProject(project));
    expect(jsonReport.valid).toBe(true);
    expect(jsonReport.project).toEqual(project);

    const unpacked = unpackProject(packProject({ project, assets: new Map([["assets/backdrop.png", new Uint8Array([1, 2, 3])]]), dependenciesLock: { packages: { "acme.nodes": "2.1.0" } } }));
    expect(unpacked.project).toEqual(project);
    expect(unpacked.dependenciesLock).toEqual({ packages: { "acme.nodes": "2.1.0" } });
    expect(unpacked.assets.get("assets/backdrop.png")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects non-JSON Node state instead of silently changing it during export", () => {
    const project = createEmptyProject();
    project.assets.push({
      id: "asset-invalid",
      name: "Invalid metadata",
      storage: "external",
      mimeType: "application/octet-stream",
      mediaType: "binary",
      size: 0,
      metadata: { invalidNumber: Number.NaN },
    });
    expect(() => serializeProject(project)).toThrow(/non-finite number.*assets\[0\]\.metadata\.invalidNumber/);
  });

  it("loads pre-annotation project files with safe visibility defaults", () => {
    const legacy = createEmptyProject() as unknown as Record<string, unknown>;
    delete legacy["annotations"];
    const settings = legacy["settings"] as Record<string, unknown>;
    delete settings["connectionsVisible"];
    delete settings["portsVisible"];
    delete settings["groupsVisible"];
    delete settings["annotationsVisible"];
    delete settings["recentLibraryItems"];
    const report = loadProjectJson(legacy);
    expect(report.valid).toBe(true);
    expect(report.project?.annotations).toEqual([]);
    expect(report.project?.settings.portsVisible).toBe(true);
    expect(report.project?.settings.groupsVisible).toBe(true);
    expect(report.project?.settings.annotationsVisible).toBe(true);
    expect(report.project?.settings.recentLibraryItems).toEqual([]);
  });

  it("migrates an older schema without mutating the original", () => {
    const old = { ...createEmptyProject("Old"), schemaVersion: "0.1.0" };
    const report = loadProjectJson(old);
    expect(report.valid).toBe(true);
    expect(report.migrationPath).toEqual(["0.1.0", "1.0.0"]);
    expect(old.schemaVersion).toBe("0.1.0");
  });

  it("packages and unpacks embedded assets safely", () => {
    const project = createEmptyProject();
    project.settings.grid.snapping = true;
    project.settings.recentLibraryItems = [{ kind: "container", id: "empty" }];
    const packed = packProject({ project, assets: new Map([["assets/data.txt", new TextEncoder().encode("hello")]]) });
    const unpacked = unpackProject(packed);
    expect(new TextDecoder().decode(unpacked.assets.get("assets/data.txt"))).toBe("hello");
    expect(unpacked.project.settings.grid.snapping).toBe(true);
    expect(unpacked.project.settings.recentLibraryItems).toEqual([{ kind: "container", id: "empty" }]);
  });

  it("detects hotkey conflicts and supports merge imports", () => {
    const config = createDefaultConfig();
    expect(importConfig(config, { ...config, settings: { ...config.settings, theme: "light" } }).settings.theme).toBe("light");
    expect(() => parseConfig({ ...config, hotkeys: [{ command: "one", keys: "Ctrl+K" }, { command: "two", keys: "K+Ctrl" }] })).toThrow(/Hotkey conflict/);
  });

  it("rejects invalid JSON without throwing", () => {
    const report = loadProjectJson("{not json");
    expect(report.valid).toBe(false);
    expect(report.issues[0]?.code).toBe("invalid-json");
  });
});
