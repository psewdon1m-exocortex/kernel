// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AssetRegistry } from "@open-node/assets";
import { CommandHistory } from "@open-node/commands";
import { registerCoreNodes } from "@open-node/core-nodes";
import { ExecutionRuntime } from "@open-node/engine";
import { createAnnotation, createContainer, createEmptyProject, createId, ProjectStore, type ComputationalConnection, type OpenNodeProject } from "@open-node/model";
import { createNodeFromDefinition, NodeRegistry } from "@open-node/sdk";
import { TimelineRuntime } from "@open-node/timeline";
import { createCoreTypeRegistry } from "@open-node/type-system";
import { OpenNodeEditor, type OpenNodeEditorController } from "@open-node/ui";

let mount: HTMLDivElement;
let root: Root;

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", { value: class { observe() {} disconnect() {} }, configurable: true });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mount?.remove();
});

describe("OpenNodeEditor interactions", () => {
  it("opens the movable Library with Left Alt and closes it on an outside pointer", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    });
    expect(mount.querySelector(".on-library-overlay")).not.toBeNull();
    const search = mount.querySelector<HTMLInputElement>(".on-library-overlay .on-search input");
    await act(async () => { if (search) { search.value = "color"; search.dispatchEvent(new Event("input", { bubbles: true })); } });
    await act(async () => mount.querySelector(".on-alt-hint")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(mount.querySelector(".on-library-overlay")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    });
    expect(mount.querySelector<HTMLInputElement>(".on-library-overlay .on-search input")?.value).toBe("");
  });

  it("places the eleven Alt actions in one row above the Library and tracks recent items", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    });
    const overlay = mount.querySelector<HTMLElement>(".on-library-overlay");
    const toolbar = mount.querySelector<HTMLElement>(".on-alt-toolbar");
    expect(toolbar?.querySelectorAll("button")).toHaveLength(11);
    expect(toolbar?.style.left).toBe(overlay?.style.left);
    expect(Number.parseFloat(overlay?.style.top ?? "0") - Number.parseFloat(toolbar?.style.top ?? "0")).toBe(46);
    const gridButton = toolbar?.querySelector<HTMLButtonElement>('button[title="Show or hide Canvas grid"]');
    expect(gridButton?.classList.contains("is-active")).toBe(true);
    await act(async () => gridButton?.click());
    expect(controller.store.project.settings.grid.enabled).toBe(false);
    expect(mount.querySelector(".on-grid")).toBeNull();
    const firstNode = mount.querySelector<HTMLButtonElement>(".on-library-grid .on-library-tile");
    await act(async () => firstNode?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 })));
    expect(controller.store.project.settings.recentLibraryItems).toEqual([{ kind: "node", id: controller.store.project.nodes[0]?.nodeTypeId }]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    });
    expect(mount.querySelector(".on-library-tabs button.is-active")?.textContent).toContain("Recently");
    expect(mount.querySelectorAll(".on-library-grid.is-recent .on-library-tile")).toHaveLength(1);
  });

  it("opens the unified Library search on a Canvas double-click", async () => {
    const { controller } = makeController();
    await render(controller);
    const canvas = mount.querySelector<HTMLElement>(".on-canvas");
    await act(async () => canvas?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, clientX: 240, clientY: 180 })));
    const search = mount.querySelector<HTMLInputElement>(".on-library-overlay .on-search input");
    expect(search).not.toBeNull();
    await act(async () => { if (search) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "container"); search.dispatchEvent(new Event("input", { bubbles: true })); } });
    expect(mount.querySelector(".on-library-overlay.is-searching")).not.toBeNull();
    expect(mount.querySelector(".on-library-tabs")).toBeNull();
    expect(mount.querySelector(".on-library-tile-title")?.textContent).toContain("Container");
  });

  it("creates a text annotation from the Alt tool palette", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
    });
    await act(async () => mount.querySelector<HTMLButtonElement>('.on-alt-toolbar button[title="Text"]')?.click());
    await act(async () => {
      mount.querySelector<HTMLElement>(".on-canvas")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 320, clientY: 240 }));
      await Promise.resolve();
    });
    expect(controller.store.project.annotations).toHaveLength(1);
    expect(controller.store.project.annotations[0]?.annotationType).toBe("text");
    expect(mount.querySelector(".on-annotation.is-text")).not.toBeNull();
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
  });

  it("applies geometric annotation opacity only to the fill", async () => {
    const { controller } = makeController();
    const shapes = (["rectangle", "ellipse", "diamond"] as const).map((type, index) => {
      const shape = createAnnotation(type, { x: index * 220, y: 0 });
      shape.opacity = 0.35;
      return shape;
    });
    controller.store.mutate((draft) => { draft.annotations.push(...shapes); }, "test");
    await render(controller);
    for (const shape of shapes) {
      const annotation = mount.querySelector<HTMLElement>(`[data-annotation-id="${shape.id}"]`);
      const svg = annotation?.querySelector<SVGSVGElement>("svg");
      const geometry = svg?.querySelector<SVGElement>("rect,ellipse,polygon");
      expect(svg?.style.opacity).toBe("");
      expect(geometry?.getAttribute("fill-opacity")).toBe("0.35");
      expect(geometry?.getAttribute("stroke-opacity")).toBeNull();
    }
  });

  it("exports the current complete project snapshot from the project menu", async () => {
    const { controller, nodeId } = makeController(true);
    controller.store.mutate((draft) => {
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (node) {
        node.parameters["value"] = 99;
        node.uiState["previewEnabled"] = true;
        node.runtimeHints["preferredBackend"] = "worker";
      }
      const connection = draft.connections[0];
      if (connection) {
        connection.routing = "orthogonal";
        connection.routingOverride = true;
        connection.reroutePoints = [{ x: 10, y: 20 }];
      }
      draft.viewport = { x: 321, y: -123, zoom: 1.4 };
      draft.settings.grid.snapping = true;
      draft.settings.panelLayout = { library: { position: { x: 180, y: 90 }, size: { width: 740, height: 510 } } };
    }, "test");
    let exported: OpenNodeProject | undefined;
    await render(controller, (project) => { exported = structuredClone(project); });
    await act(async () => mount.querySelector<HTMLButtonElement>(".on-chevron-button")?.click());
    const save = [...mount.querySelectorAll<HTMLButtonElement>(".on-app-menu button")].find((button) => button.textContent?.includes("Save project"));
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });
    expect(exported).toEqual(controller.store.project);
  });

  it("runs the workflow with Enter outside form controls", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(mount.querySelector(".on-statusbar")?.textContent).toMatch(/Execution (started|completed)/);
  });

  it("edits and persists Text annotation content directly on the Canvas", async () => {
    const { controller } = makeController();
    const annotation = createAnnotation("text", { x: 10, y: 20 });
    controller.store.mutate((draft) => { draft.annotations.push(annotation); }, "test");
    await render(controller);
    const text = mount.querySelector<HTMLElement>(".on-annotation-text");
    await act(async () => text?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 })));
    expect(mount.querySelector(".on-library-overlay")).toBeNull();
    const editor = mount.querySelector<HTMLTextAreaElement>(".on-annotation-text-input");
    expect(editor).not.toBeNull();
    await act(async () => {
      if (!editor) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, "Saved on canvas");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      editor?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.annotations[0]?.text).toBe("Saved on canvas");
  });

  it("persists Text annotation Content from the Inspector", async () => {
    const { controller } = makeController();
    const annotation = createAnnotation("text", { x: 10, y: 20 });
    controller.store.mutate((draft) => { draft.annotations.push(annotation); }, "test");
    await render(controller);
    await act(async () => mount.querySelector<HTMLElement>(".on-annotation-text")?.click());
    const content = mount.querySelector<HTMLTextAreaElement>(".on-inspector .on-field textarea");
    expect(content).not.toBeNull();
    await act(async () => {
      if (!content) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(content, "Saved from Inspector");
      content.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      content?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.annotations[0]?.text).toBe("Saved from Inspector");
  });

  it("keeps Node parameters interactive inside a Container", async () => {
    const { controller } = makeController();
    const container = createContainer({ x: 0, y: 0 });
    const node = createNodeFromDefinition(controller.nodes.require("open-node.core.integer"), { x: 0, y: 0 });
    node.parentContainerId = container.id;
    container.nodeIds.push(node.id);
    controller.store.mutate((draft) => { draft.containers.push(container); draft.nodes.push(node); }, "test");
    await render(controller);
    const input = mount.querySelector<HTMLInputElement>(".on-contained-node-parameters input[type=number]");
    expect(input).not.toBeNull();
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "42");
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes[0]?.parameters["value"]).toBe(42);
  });

  it("uses physical copy/cut/paste shortcuts and pastes at the mouse", async () => {
    const { controller, nodeId } = makeController(true);
    await render(controller);
    await act(async () => mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "с", code: "KeyC", ctrlKey: true, bubbles: true })));
    const canvas = mount.querySelector<HTMLElement>(".on-canvas");
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 420, clientY: 260 })));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "м", code: "KeyV", ctrlKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes).toHaveLength(4);
    const pasted = controller.store.project.nodes.at(-1)!;
    expect(pasted.position.x + pasted.size.width / 2).toBe(420);
    expect(pasted.position.y + pasted.size.height / 2).toBe(260);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ч", code: "KeyX", ctrlKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes).toHaveLength(3);
  });

  it("moves, copies and pastes a multi-selection with its internal connections", async () => {
    const { controller } = makeController(true);
    await render(controller);
    const nodes = [...mount.querySelectorAll<HTMLElement>(".on-node")];
    for (const node of nodes) await act(async () => node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true })));
    expect(mount.querySelectorAll(".on-node.is-selected")).toHaveLength(3);
    const before = controller.store.project.nodes.map((node) => ({ ...node.position }));
    const canvas = mount.querySelector<HTMLElement>(".on-canvas");
    await act(async () => nodes[0]?.querySelector("header")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 48, clientY: 24 })));
    await act(async () => {
      canvas?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 48, clientY: 24 }));
      await Promise.resolve();
    });
    controller.store.project.nodes.forEach((node, index) => {
      expect(node.position).toEqual({ x: before[index]!.x + 48, y: before[index]!.y + 24 });
    });
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", ctrlKey: true, bubbles: true })));
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 520, clientY: 360 })));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", ctrlKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes).toHaveLength(6);
    expect(controller.store.project.connections).toHaveLength(2);
    const pastedIds = new Set(controller.store.project.nodes.slice(3).map((node) => node.id));
    const pastedConnection = controller.store.project.connections[1]!;
    expect(pastedIds.has(pastedConnection.source.elementId)).toBe(true);
    expect(pastedIds.has(pastedConnection.target.elementId)).toBe(true);
  });

  it("snaps graph entities while annotations remain freeform", async () => {
    const { controller, nodeId } = makeController(true);
    const annotation = createAnnotation("rectangle", { x: 5, y: 5 });
    controller.store.mutate((draft) => {
      draft.settings.grid.snapping = true;
      draft.settings.grid.step = 24;
      draft.annotations.push(annotation);
    }, "test");
    await render(controller);
    const canvas = mount.querySelector<HTMLElement>(".on-canvas");
    const header = mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] > header`);
    await act(async () => header?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 13, clientY: 13 })));
    await act(async () => {
      canvas?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 13, clientY: 13 }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes.find((node) => node.id === nodeId)?.position).toEqual({ x: -192, y: 24 });
    const annotationElement = mount.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`);
    await act(async () => annotationElement?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 13, clientY: 13 })));
    await act(async () => {
      canvas?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 13, clientY: 13 }));
      await Promise.resolve();
    });
    expect(controller.store.project.annotations.find((item) => item.id === annotation.id)?.position).toEqual({ x: 18, y: 18 });
  });

  it("drops a Canvas Node at the intended Container order and clears the preview line", async () => {
    const { controller } = makeController();
    const source = createNodeFromDefinition(controller.nodes.require("open-node.output.display"), { x: 0, y: 0 });
    const first = createNodeFromDefinition(controller.nodes.require("open-node.core.integer"), { x: 200, y: 0 });
    const second = createNodeFromDefinition(controller.nodes.require("open-node.core.float"), { x: 200, y: 0 });
    const container = createContainer({ x: 200, y: 0 });
    first.parentContainerId = container.id;
    second.parentContainerId = container.id;
    container.nodeIds.push(first.id, second.id);
    controller.store.mutate((draft) => { draft.nodes.push(source, first, second); draft.containers.push(container); }, "test");
    await render(controller);
    const header = mount.querySelector<HTMLElement>(`[data-node-id="${source.id}"] > header`);
    const canvas = mount.querySelector<HTMLElement>(".on-canvas");
    await act(async () => header?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
    await act(async () => canvas?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 250, clientY: 310 })));
    expect(mount.querySelector(".on-container-drop-line")).not.toBeNull();
    await act(async () => {
      canvas?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 250, clientY: 310 }));
      await Promise.resolve();
    });
    expect(controller.store.project.containers[0]?.nodeIds).toEqual([first.id, second.id, source.id]);
    expect(controller.store.project.nodes.find((node) => node.id === source.id)?.parentContainerId).toBe(container.id);
    expect(mount.querySelector(".on-container-drop-line")).toBeNull();
  });

  it("deletes a selected Node and its connection with Backspace", async () => {
    const { controller, nodeId } = makeController(true);
    await render(controller);
    const node = mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    expect(node).not.toBeNull();
    await act(async () => node?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true }));
      await Promise.resolve();
    });
    expect(controller.store.project.nodes.some((candidate) => candidate.id === nodeId)).toBe(false);
    expect(controller.store.project.connections).toHaveLength(0);
  });

  it("keeps Canvas controls interactive and exposes object actions", async () => {
    const { controller, nodeId } = makeController(true);
    controller.store.mutate((draft) => { draft.viewport = { x: 240, y: 180, zoom: 1.5 }; }, "test");
    await render(controller);
    const origin = [...mount.querySelectorAll<HTMLButtonElement>(".on-canvas-controls button")].find((button) => button.textContent === "Origin");
    await act(async () => origin?.click());
    expect(controller.store.project.viewport.x).toBe(0);
    expect(controller.store.project.viewport.y).toBe(0);
    const node = mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    await act(async () => node?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 40, clientY: 50 })));
    expect(mount.querySelector(".on-context-menu")?.textContent).toContain("Bypass");
    const closeMap = mount.querySelector<HTMLButtonElement>(".on-minimap .on-overlay-title button");
    await act(async () => closeMap?.click());
    expect(mount.querySelector(".on-minimap")).toBeNull();
    expect(controller.store.project.settings.minimapVisible).toBe(false);
    const closeResources = mount.querySelector<HTMLButtonElement>(".on-dashboard .on-overlay-title button");
    await act(async () => closeResources?.click());
    expect(controller.store.project.settings.dashboardVisible).toBe(false);
  });

  it("opens the Inspector only from an intentional Canvas click and closes it outside", async () => {
    const { controller, nodeId, targetNodeId } = makeController(true);
    await render(controller);
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
    const node = mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    await act(async () => node?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
    await act(async () => node?.click());
    expect(mount.querySelector(".on-inspector.is-open")).not.toBeNull();
    await act(async () => node?.click());
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
    await act(async () => node?.click());
    const inspector = mount.querySelector(".on-inspector.is-open");
    const target = mount.querySelector<HTMLElement>(`[data-node-id="${targetNodeId}"]`);
    await act(async () => target?.click());
    expect(mount.querySelector(".on-inspector.is-open")).toBe(inspector);
    expect(mount.querySelector(".on-inspector-title strong")?.textContent).toBe("Display");
    await act(async () => mount.querySelector<HTMLElement>(".on-canvas")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
  });

  it("does not lose the first intentional Inspector click after a drag", async () => {
    const { controller, nodeId } = makeController(true);
    await render(controller);
    const node = mount.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)!;
    const header = node.querySelector<HTMLElement>("header")!;
    const canvas = mount.querySelector<HTMLElement>(".on-canvas")!;
    await act(async () => header.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })));
    await act(async () => canvas.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 24, clientY: 0 })));
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 24, clientY: 0 }));
      node.click();
      await Promise.resolve();
    });
    expect(mount.querySelector(".on-inspector.is-open")).toBeNull();
    await act(async () => header.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 24, clientY: 0 })));
    await act(async () => canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 24, clientY: 0 })));
    expect(mount.querySelector(".on-inspector.is-open")).not.toBeNull();
    await act(async () => node.click());
    expect(mount.querySelector(".on-inspector.is-open")).not.toBeNull();
  });

  it("asks before closing a project tab", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => mount.querySelector<HTMLButtonElement>(".on-tab-close")?.click());
    expect(mount.querySelector(".on-close-project")?.textContent).toContain("Save and download");
    const discard = [...mount.querySelectorAll<HTMLButtonElement>(".on-close-project button")].find((button) => button.textContent?.includes("without saving"));
    await act(async () => discard?.click());
    expect(controller.store.project.metadata.name).toBe("Untitled");
  });

  it("opens at most four project tabs", async () => {
    const { controller } = makeController();
    await render(controller);
    for (let index = 0; index < 3; index += 1) await act(async () => mount.querySelector<HTMLButtonElement>(".on-new-project")?.click());
    expect(mount.querySelectorAll(".on-project-tab")).toHaveLength(4);
    expect(mount.querySelector(".on-new-project")).toBeNull();
  });

  it("replaces an occupied single-input connection", async () => {
    const { controller, replacementNodeId, targetNodeId } = makeController(true);
    await render(controller);
    const output = mount.querySelector<HTMLElement>(`[data-node-id="${replacementNodeId}"] [data-port-id="value"]`);
    const input = mount.querySelector<HTMLElement>(`[data-node-id="${targetNodeId}"] [data-port-id="value"]`);
    expect(output).not.toBeNull();
    expect(input).not.toBeNull();
    await act(async () => output?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await act(async () => {
      input?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(controller.store.project.connections).toHaveLength(1);
    expect(controller.store.project.connections[0]?.source.elementId).toBe(replacementNodeId);
  });

  it("applies the project routing only to connections without an override", async () => {
    const { controller } = makeController(true);
    await render(controller);
    await act(async () => mount.querySelector<HTMLButtonElement>(".on-chevron-button")?.click());
    const settingsButton = [...mount.querySelectorAll<HTMLButtonElement>(".on-app-menu button")].find((button) => button.textContent?.includes("Settings"));
    await act(async () => settingsButton?.click());
    const routing = [...mount.querySelectorAll<HTMLLabelElement>(".on-settings .on-field")].find((label) => label.textContent?.includes("Connections"))?.querySelector("select");
    expect(routing).not.toBeNull();
    await act(async () => { if (routing) { routing.value = "orthogonal"; routing.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); } });
    expect(controller.store.project.connections[0]?.routing).toBe("orthogonal");
    controller.store.mutate((draft) => { if (draft.connections[0]) draft.connections[0].routingOverride = true; }, "test");
    await act(async () => { if (routing) { routing.value = "smooth-step"; routing.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); } });
    expect(controller.store.project.settings.connectionRouting).toBe("smooth-step");
    expect(controller.store.project.connections[0]?.routing).toBe("orthogonal");
  });

  it("opens the built-in Documentation guide from the project menu", async () => {
    const { controller } = makeController();
    await render(controller);
    await act(async () => mount.querySelector<HTMLButtonElement>(".on-chevron-button")?.click());
    const documentation = [...mount.querySelectorAll<HTMLButtonElement>(".on-app-menu button")].find((button) => button.textContent === "Documentation");
    await act(async () => documentation?.click());
    expect(mount.querySelector(".on-documentation")?.textContent).toContain("Selection and editing");
    expect(mount.querySelector(".on-documentation")?.textContent).toContain("Projects and files");
  });
});

async function render(controller: OpenNodeEditorController, onSaveRequest?: (project: OpenNodeProject) => void | Promise<void>): Promise<void> {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => root.render(<OpenNodeEditor controller={controller} mode="embedded-edit" onSaveRequest={onSaveRequest} />));
}

function makeController(withGraph = false): { controller: OpenNodeEditorController; nodeId: string; replacementNodeId: string; targetNodeId: string } {
  const project = createEmptyProject("UI interactions");
  const nodes = new NodeRegistry();
  registerCoreNodes(nodes);
  let nodeId = "";
  let replacementNodeId = "";
  let targetNodeId = "";
  if (withGraph) {
    const source = createNodeFromDefinition(nodes.require("open-node.core.integer"), { x: -200, y: 0 });
    const replacement = createNodeFromDefinition(nodes.require("open-node.core.integer"), { x: -200, y: 180 });
    const target = createNodeFromDefinition(nodes.require("open-node.output.display"), { x: 200, y: 0 });
    nodeId = source.id;
    replacementNodeId = replacement.id;
    targetNodeId = target.id;
    const connection: ComputationalConnection = { id: createId("connection"), kind: "data", source: { elementId: source.id, portId: "value" }, target: { elementId: target.id, portId: "value" }, thickness: 2, opacity: 1, arrowhead: "end", routing: "bezier", reroutePoints: [] };
    project.nodes.push(source, replacement, target);
    project.connections.push(connection);
  }
  const store = new ProjectStore(project);
  return { nodeId, replacementNodeId, targetNodeId, controller: { store, history: new CommandHistory(), nodes, types: createCoreTypeRegistry(), runtime: new ExecutionRuntime(nodes), timeline: new TimelineRuntime(project.timeline), assets: new AssetRegistry() } };
}
