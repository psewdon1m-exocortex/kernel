import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { AssetRegistry, ImportableFile } from "@open-node/assets";
import { copySelection, moveElements, pasteSelection, projectCommand, removeElements, setGroupBypass, type ClipboardGraph, type CommandHistory } from "@open-node/commands";
import type { ExecutionRuntime, ExecutionSession } from "@open-node/engine";
import {
  createContainer,
  createAnnotation,
  createEmptyProject,
  createGroup,
  createId,
  getBounds,
  getElement,
  rectContainsRect,
  type AnnotationType,
  type CanvasAnnotation,
  type ComputationalConnection,
  type Connection,
  type ConnectionRouting,
  type ContainerInstance,
  type ContainerPreset,
  type GraphElement,
  type GroupInstance,
  type NodeInstance,
  type OpenNodeProject,
  type Point,
  type PortInstance,
  type ProjectStore,
  type RecentLibraryItem,
  type Rect,
  type Size,
  type ViewportState,
} from "@open-node/model";
import { createNodeFromDefinition, type NodeDefinition, type NodeRegistry, type ParameterDefinition } from "@open-node/sdk";
import { BrowserTelemetryAdapter, formatMetric, TelemetryMonitor, unavailableMetrics, type ResourceMetrics } from "@open-node/telemetry";
import type { TimelineRuntime } from "@open-node/timeline";
import { validateConnection, type TypeRegistry } from "@open-node/type-system";
import "./styles.css";

export interface OpenNodeEditorController {
  store: ProjectStore;
  history: CommandHistory;
  nodes: NodeRegistry;
  types: TypeRegistry;
  runtime: ExecutionRuntime;
  timeline: TimelineRuntime;
  assets?: AssetRegistry;
  telemetry?: TelemetryMonitor;
}

export interface OpenNodeEditorProps {
  controller: OpenNodeEditorController;
  mode?: "standalone" | "embedded-edit" | "embedded-readonly";
  className?: string;
  themeTokens?: Record<string, string>;
  onSaveRequest?: (project: OpenNodeProject) => void | Promise<void>;
  onOpenRequest?: (source: string) => void | Promise<void>;
  onProjectChanged?: (project: OpenNodeProject) => void;
  visualOnly?: boolean;
}

export interface OpenNodeEditorHandle {
  goToOrigin(): void;
  fitAll(): void;
  fitSelection(): void;
  setViewport(viewport: ViewportState): void;
  getViewport(): ViewportState;
  select(ids: string[]): void;
  run(): ExecutionSession;
  cancel(): void;
}

type Interaction =
  | { kind: "pan"; pointerId: number; startClient: Point; startViewport: ViewportState }
  | { kind: "drag"; pointerId: number; startClient: Point; ids: string[]; primaryId: string }
  | { kind: "resize"; pointerId: number; startClient: Point; elementId: string; startRect: Rect; handle: ResizeHandle }
  | { kind: "rotate"; pointerId: number; elementId: string; center: Point; startAngle: number; startRotation: number }
  | { kind: "annotation-point"; pointerId: number; annotation: CanvasAnnotation; pointIndex: number; points: Point[] }
  | { kind: "annotate"; pointerId: number; tool: AnnotationType; startWorld: Point; currentWorld: Point; points: Point[]; square: boolean }
  | { kind: "marquee" | "group"; pointerId: number; startWorld: Point; currentWorld: Point }
  | null;

type ResizeHandle = "nw" | "ne" | "sw" | "se";

interface ResizePreview {
  elementId: string;
  rect: Rect;
}

type CanvasMenu =
  | { kind: "element"; id: string; x: number; y: number }
  | { kind: "connection"; id: string; x: number; y: number }
  | null;

interface PendingConnection {
  sourceElementId: string;
  sourcePortId: string;
  kind: "data" | "control";
  point: Point;
}

interface ProjectTab {
  id: string;
  project: OpenNodeProject;
}

type CanvasSelectable = GraphElement | CanvasAnnotation;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const NODE_HEADER_HEIGHT = 54;
const NODE_PORT_START = 72;
const NODE_PORT_GAP = 28;
const PORT_VISUAL_OFFSET_Y = 1;
const PORT_DOT_GAP = 8;
const CONTAINER_HEADER_HEIGHT = 48;
const CONTAINER_NODE_HEIGHT = 112;
const CONTAINER_NODE_GAP = 8;
const DEFAULT_BACKGROUND = "#111318";
const DEFAULT_GRID_COLOR = "#75809a";
const ALT_TOOLBAR_HEIGHT = 46;
const ALT_TOOLBAR_GAP = 8;
const LIBRARY_MIN_WIDTH = 460;
let browserCapabilityCache: { cores: string; memory: string; gpu: string } | undefined;

export const OpenNodeEditor = forwardRef<OpenNodeEditorHandle, OpenNodeEditorProps>(function OpenNodeEditor(
  { controller, mode = "embedded-edit", className = "", themeTokens, onSaveRequest, onOpenRequest, onProjectChanged, visualOnly = false },
  ref,
) {
  const project = useProject(controller.store);
  const readOnly = mode === "embedded-readonly";
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mouseClientRef = useRef<Point>({ x: 120, y: 120 });
  const mouseWorldRef = useRef<Point>({ x: 0, y: 0 });
  const initialTabIdRef = useRef(createId("tab"));
  const [projectTabs, setProjectTabs] = useState<ProjectTab[]>(() => [{ id: initialTabIdRef.current, project: structuredClone(project) }]);
  const projectTabsRef = useRef(projectTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabIdRef.current);
  const activeTabIdRef = useRef(activeTabId);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 700 });
  const [viewport, setViewport] = useState(project.viewport);
  const [mouseWorld, setMouseWorld] = useState<Point>({ x: 0, y: 0 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [resizePreview, setResizePreview] = useState<ResizePreview>();
  const [rotationPreview, setRotationPreview] = useState<{ elementId: string; rotation: number }>();
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPosition, setLibraryPosition] = useState<Point>(() => project.settings.panelLayout?.library.position ?? { x: 70, y: 64 });
  const [librarySize, setLibrarySize] = useState<Size>(() => project.settings.panelLayout?.library.size ?? { width: 620, height: 430 });
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [documentationOpen, setDocumentationOpen] = useState(false);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenu>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectedElementId, setInspectedElementId] = useState<string>();
  const [search, setSearch] = useState("");
  const [activeSession, setActiveSession] = useState<ExecutionSession>();
  const [sessionRevision, setSessionRevision] = useState(0);
  const [timelineRevision, setTimelineRevision] = useState(0);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>();
  const [connectionError, setConnectionError] = useState("");
  const [annotationTool, setAnnotationTool] = useState<AnnotationType>();
  const annotationInteractionRef = useRef<Extract<NonNullable<Interaction>, { kind: "annotate" }> | null>(null);
  const [dropTargetContainerId, setDropTargetContainerId] = useState<string>();
  const [dropTargetContainerIndex, setDropTargetContainerIndex] = useState<number>();
  const [nativeNodeDragId, setNativeNodeDragId] = useState<string>();
  const [closePromptTabId, setClosePromptTabId] = useState<string>();
  const [minimapOpen, setMinimapOpen] = useState(project.settings.minimapVisible);
  const [dashboardOpen, setDashboardOpen] = useState(project.settings.dashboardVisible);
  const [metrics, setMetrics] = useState<ResourceMetrics>(unavailableMetrics());
  const [clipboard, setClipboard] = useState<ClipboardGraph>();
  const [statusMessage, setStatusMessage] = useState("Ready");
  const lastSpaceRef = useRef(0);
  const altDownAtRef = useRef(0);
  const altDragUsedRef = useRef(false);
  const suppressActivationRef = useRef<{ elementId: string; until: number } | undefined>(undefined);
  const inspectorStateRef = useRef<{ open: boolean; elementId?: string }>({ open: false });

  const elements = useMemo(() => [...project.groups, ...project.containers, ...project.nodes], [project]);
  const collapsedMembers = useMemo(() => project.settings.groupsVisible === false ? new Set<string>() : new Set(project.groups.filter((group) => group.collapsed).flatMap((group) => [...group.memberNodeIds, ...group.memberContainerIds])), [project.groups, project.settings.groupsVisible]);
  const displayElements = useMemo(() => elements.filter((element) => !collapsedMembers.has(element.id)), [elements, collapsedMembers]);
  const displayOffset = interaction?.kind === "drag" ? dragOffset : { x: 0, y: 0 };
  const visibleElements = useMemo(() => cullElements(displayElements, viewport, canvasSize, selection, interaction?.kind === "drag" ? new Set(interaction.ids) : new Set()), [displayElements, viewport, canvasSize, selection, interaction]);
  const inspectedElement = inspectedElementId ? getCanvasElement(project, inspectedElementId) : undefined;
  const annotationPreview = interaction?.kind === "annotate" ? annotationFromInteraction(interaction) : undefined;
  const annotationPointPreview = interaction?.kind === "annotation-point" ? annotationFromWorldPoints(interaction.annotation, interaction.points) : undefined;
  const worldTransform = `translate(${canvasSize.width / 2}px, ${canvasSize.height / 2}px) scale(${viewport.zoom}) translate(${-viewport.x}px, ${-viewport.y}px)`;
  const theme = project.settings.theme === "system" ? undefined : project.settings.theme;
  const themeStyle = themeTokens ? Object.fromEntries(Object.entries(themeTokens).map(([key, value]) => [`--on-${key}`, value])) as CSSProperties : undefined;

  const closeInspector = useCallback(() => {
    inspectorStateRef.current = { ...inspectorStateRef.current, open: false };
    setInspectorOpen(false);
  }, []);

  useEffect(() => {
    setViewport(project.viewport);
    setMinimapOpen(project.settings.minimapVisible);
    setDashboardOpen(project.settings.dashboardVisible);
    setLibraryPosition(project.settings.panelLayout?.library.position ?? { x: 70, y: 64 });
    setLibrarySize(project.settings.panelLayout?.library.size ?? { width: 620, height: 430 });
  }, [project.metadata.id]);

  useEffect(() => {
    setProjectTabs((current) => {
      const next = current.map((tab) => tab.id === activeTabIdRef.current ? { ...tab, project: structuredClone(project) } : tab);
      projectTabsRef.current = next;
      return next;
    });
  }, [project]);

  useEffect(() => setMinimapOpen(project.settings.minimapVisible), [project.settings.minimapVisible]);
  useEffect(() => setDashboardOpen(project.settings.dashboardVisible), [project.settings.dashboardVisible]);
  useEffect(() => {
    if (inspectedElementId && !inspectedElement) {
      inspectorStateRef.current = { open: false };
      setInspectorOpen(false);
      setInspectedElementId(undefined);
    }
  }, [inspectedElement, inspectedElementId]);

  useEffect(() => onProjectChanged?.(project), [project, onProjectChanged]);

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, []);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const preventBrowserZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    node.addEventListener("wheel", preventBrowserZoom, { passive: false });
    return () => node.removeEventListener("wheel", preventBrowserZoom);
  }, []);

  useEffect(() => controller.timeline.subscribe(() => setTimelineRevision((value) => value + 1)), [controller.timeline]);

  useEffect(() => {
    if (visualOnly) return;
    const monitor = controller.telemetry ?? new TelemetryMonitor(new BrowserTelemetryAdapter());
    const unsubscribe = monitor.subscribe(setMetrics);
    monitor.start();
    return () => {
      unsubscribe();
      if (!controller.telemetry) monitor.stop();
    };
  }, [controller.telemetry, visualOnly]);

  useEffect(() => {
    if (!activeSession) return;
    const unsubscribe = activeSession.subscribe(() => setSessionRevision((value) => value + 1));
    void activeSession.completion.then((session) => {
      setStatusMessage(session.status === "success" ? "Execution completed" : session.status === "cancelled" ? "Execution cancelled" : `Execution failed (${session.errors.length})`);
      setSessionRevision((value) => value + 1);
    }).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error)));
    return unsubscribe;
  }, [activeSession]);

  const commitViewport = useCallback((next: ViewportState) => {
    setViewport(next);
    controller.store.mutate((draft) => { draft.viewport = next; }, "viewport");
  }, [controller.store]);

  const fit = useCallback((ids?: ReadonlySet<string>) => {
    const bounds = getBounds(project, ids);
    if (!bounds) return commitViewport({ x: 0, y: 0, zoom: 1 });
    const padding = 96;
    const zoom = clamp(Math.min((canvasSize.width - padding * 2) / Math.max(bounds.width, 1), (canvasSize.height - padding * 2) / Math.max(bounds.height, 1)), MIN_ZOOM, MAX_ZOOM);
    commitViewport({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom });
  }, [project, canvasSize, commitViewport]);

  const run = useCallback(() => {
    if (visualOnly) throw new Error("Execution is disabled in visual-only mode");
    const session = controller.runtime.run(controller.store.snapshot(), {
      mode: project.execution.mode,
      scope: selection.size > 0 ? "selected" : "all",
      elementIds: [...selection],
      timeline: controller.timeline.context,
      services: controller.assets ? { assets: controller.assets, logger: console } : { logger: console },
    });
    setActiveSession(session);
    setStatusMessage("Execution started");
    return session;
  }, [controller, project.execution.mode, selection, visualOnly]);

  useImperativeHandle(ref, () => ({
    goToOrigin: () => commitViewport({ x: 0, y: 0, zoom: viewport.zoom }),
    fitAll: () => fit(),
    fitSelection: () => fit(selection),
    setViewport: commitViewport,
    getViewport: () => viewport,
    select: (ids) => setSelection(new Set(ids.filter((id) => getCanvasElement(project, id)))),
    run,
    cancel: () => activeSession?.cancel(),
  }), [activeSession, commitViewport, fit, project, run, selection, viewport]);

  const execute = useCallback((label: string, mutate: (draft: OpenNodeProject) => void) => {
    if (readOnly) return;
    void controller.history.execute(projectCommand(controller.store, label, mutate)).catch((error: unknown) => setStatusMessage(error instanceof Error ? error.message : String(error)));
  }, [controller.history, controller.store, readOnly]);

  const createNode = useCallback((typeId: string, position: Point, containerId?: string, containerIndex?: number) => {
    const definition = controller.nodes.require(typeId);
    if (containerId && (!definition.containerCompatible || !definition.containerAdapter)) {
      setStatusMessage(`${definition.displayName} cannot be placed in a Container`);
      return;
    }
    const nodePosition = containerId ? position : snapPointIfEnabled(position, project.settings.grid);
    const node = createNodeFromDefinition(definition, nodePosition);
    if (node.nodeTypeId === "exocortex.architecture.module") node.size = { width: 360, height: 240 };
    execute(`Create ${definition.displayName}`, (draft) => {
      if (containerId) {
        const container = draft.containers.find((item) => item.id === containerId);
        if (!container) throw new Error("Drop target Container no longer exists");
        node.parentContainerId = containerId;
        container.nodeIds.splice(clamp(containerIndex ?? container.nodeIds.length, 0, container.nodeIds.length), 0, node.id);
      }
      draft.nodes.push(node);
      recordRecentLibraryItem(draft, { kind: "node", id: typeId });
      reconcileGroupMembership(draft);
    });
    setSelection(new Set([node.id]));
  }, [controller.nodes, execute, project.settings.grid]);

  const createConnection = useCallback((targetElementId: string, targetPortId: string) => {
    if (!pendingConnection) return;
    const connection: ComputationalConnection = {
      id: createId("connection"), kind: pendingConnection.kind,
      source: { elementId: pendingConnection.sourceElementId, portId: pendingConnection.sourcePortId },
      target: { elementId: targetElementId, portId: targetPortId },
      thickness: 2, opacity: 1, arrowhead: "end", routing: project.settings.connectionRouting, reroutePoints: [],
    };
    const targetPort = findPort(project, targetElementId, targetPortId);
    const validationProject = targetPort?.multiple ? project : {
      ...project,
      connections: project.connections.filter((candidate) => candidate.kind === "decorative" || candidate.target.elementId !== targetElementId || candidate.target.portId !== targetPortId),
    };
    const validation = validateConnection(validationProject, connection, controller.types);
    if (!validation.valid) {
      setConnectionError(validation.issues[0]?.message ?? "Connection rejected");
      setStatusMessage(validation.issues[0]?.message ?? "Connection rejected");
    } else {
      execute("Create Connection", (draft) => {
        const target = findPort(draft, targetElementId, targetPortId);
        if (!target?.multiple) draft.connections = draft.connections.filter((candidate) => candidate.kind === "decorative" || candidate.target.elementId !== targetElementId || candidate.target.portId !== targetPortId);
        draft.connections.push(connection);
      });
      setConnectionError("");
    }
    setPendingConnection(undefined);
  }, [pendingConnection, project, controller.types, execute]);

  const deleteSelection = useCallback(() => {
    if (!selection.size) return;
    execute("Delete selection", (draft) => {
      const connectionIds = new Set(draft.connections.filter((connection) => selection.has(connection.id)).map((connection) => connection.id));
      if (connectionIds.size) draft.connections = draft.connections.filter((connection) => !connectionIds.has(connection.id));
      removeElements(draft, selection);
    });
    setSelection(new Set());
  }, [execute, selection]);

  const toggleBypass = useCallback((ids: Iterable<string>) => {
    execute("Toggle bypass", (draft) => {
      for (const id of ids) {
        const element = getElement(draft, id);
        if (!element) continue;
        if (element.kind === "group") setGroupBypass(draft, id, !element.bypassed);
        else element.bypassed = !element.bypassed;
      }
    });
  }, [execute]);

  const createEmptyContainer = useCallback((position: Point) => {
    const container = createContainer(snapPointIfEnabled(position, project.settings.grid));
    execute("Create Container", (draft) => { draft.containers.push(container); recordRecentLibraryItem(draft, { kind: "container", id: "empty" }); reconcileGroupMembership(draft); });
    setSelection(new Set([container.id]));
  }, [execute, project.settings.grid]);

  const createContainerFromPreset = useCallback((presetId: string, position: Point) => {
    const preset = project.presets.find((item): item is ContainerPreset => item.kind === "container" && item.id === presetId);
    if (!preset) return;
    const snappedPosition = snapPointIfEnabled(position, project.settings.grid);
    const container = createContainer(snappedPosition, preset.name);
    container.color = preset.color;
    container.errorPolicy = preset.errorPolicy;
    const nodes = preset.nodes.flatMap((saved) => {
      const definition = controller.nodes.get(saved.nodeTypeId, saved.nodeTypeVersion);
      if (!definition?.containerCompatible || !definition.containerAdapter) return [];
      const node = createNodeFromDefinition(definition, snappedPosition);
      if (node.nodeTypeId === "exocortex.architecture.module") node.size = { width: 360, height: 240 };
      node.label = saved.label;
      node.color = saved.color;
      node.parameters = structuredClone(saved.parameters);
      node.bypassed = saved.bypassed;
      node.parentContainerId = container.id;
      container.nodeIds.push(node.id);
      return [node];
    });
    execute(`Create ${preset.name}`, (draft) => { draft.containers.push(container); draft.nodes.push(...nodes); recordRecentLibraryItem(draft, { kind: "container", id: preset.id }); reconcileGroupMembership(draft); });
    setSelection(new Set([container.id]));
  }, [controller.nodes, execute, project.presets, project.settings.grid]);

  const saveContainerPreset = useCallback((containerId: string) => {
    execute("Save Container preset", (draft) => {
      const container = draft.containers.find((item) => item.id === containerId);
      if (!container) return;
      draft.presets.push({
        id: createId("preset"), kind: "container", name: container.name, color: container.color, errorPolicy: container.errorPolicy,
        nodes: container.nodeIds.map((id) => draft.nodes.find((node) => node.id === id)).filter((node): node is NodeInstance => Boolean(node)).map((node) => ({ nodeTypeId: node.nodeTypeId, nodeTypeVersion: node.nodeTypeVersion, label: node.label, color: node.color, parameters: structuredClone(node.parameters), bypassed: node.bypassed })),
      });
    });
    setStatusMessage("Container saved to Library");
  }, [execute]);

  const persistLibraryLayout = useCallback((position = libraryPosition, size = librarySize) => {
    if (readOnly) return;
    controller.store.mutate((draft) => {
      draft.settings.panelLayout = { library: { position: { ...position }, size: { ...size } } };
    }, "settings");
  }, [controller.store, libraryPosition, librarySize, readOnly]);

  const closeLibrary = useCallback(() => {
    if (libraryOpen) persistLibraryLayout();
    setLibraryOpen(false);
    setSearch("");
  }, [libraryOpen, persistLibraryLayout]);

  const clampLibraryPosition = useCallback((position: Point, size = librarySize): Point => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return position;
    const minX = ALT_TOOLBAR_GAP;
    const minY = ALT_TOOLBAR_HEIGHT + ALT_TOOLBAR_GAP;
    const maxX = Math.max(minX, bounds.width - size.width - ALT_TOOLBAR_GAP);
    const maxY = Math.max(minY, bounds.height - size.height - ALT_TOOLBAR_GAP);
    return { x: clamp(position.x, minX, maxX), y: clamp(position.y, minY, maxY) };
  }, [librarySize]);

  const openLibraryAtClient = useCallback((client: Point) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    const boundedSize = bounds ? {
      width: clamp(librarySize.width, LIBRARY_MIN_WIDTH, Math.max(LIBRARY_MIN_WIDTH, bounds.width - ALT_TOOLBAR_GAP * 2)),
      height: clamp(librarySize.height, 330, Math.max(330, bounds.height - ALT_TOOLBAR_HEIGHT - ALT_TOOLBAR_GAP * 2)),
    } : librarySize;
    const desired = bounds ? { x: client.x - bounds.left, y: client.y - bounds.top } : { x: 70, y: 64 };
    const next = clampLibraryPosition(desired, boundedSize);
    setLibrarySize(boundedSize);
    setLibraryPosition(next);
    setSearch("");
    setLibraryOpen(true);
    persistLibraryLayout(next, boundedSize);
  }, [clampLibraryPosition, librarySize, persistLibraryLayout]);

  const openLibraryAtPointer = useCallback(() => openLibraryAtClient(mouseClientRef.current), [openLibraryAtClient]);

  const applyProjectTab = useCallback((tab: ProjectTab) => {
    activeTabIdRef.current = tab.id;
    setActiveTabId(tab.id);
    setLibraryOpen(false);
    setSearch("");
    controller.history.clear();
    controller.timeline.pause();
    controller.timeline.configure(tab.project.timeline);
    controller.store.replace(tab.project, "load");
    setSelection(new Set());
    inspectorStateRef.current = { open: false };
    setInspectorOpen(false);
    setInspectedElementId(undefined);
    setActiveSession(undefined);
  }, [controller.history, controller.store, controller.timeline]);

  const activateProjectTab = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) return;
    const currentSnapshot = controller.store.snapshot();
    const nextTabs = projectTabsRef.current.map((tab) => tab.id === activeTabIdRef.current ? { ...tab, project: currentSnapshot } : tab);
    const target = nextTabs.find((tab) => tab.id === tabId);
    if (!target) return;
    projectTabsRef.current = nextTabs;
    setProjectTabs(nextTabs);
    applyProjectTab(target);
  }, [applyProjectTab, controller.store]);

  const createProjectTab = useCallback((initial = createEmptyProject("Untitled")): boolean => {
    if (projectTabsRef.current.length >= 4) { setStatusMessage("Up to four projects can be open at once"); return false; }
    const savedTabs = projectTabsRef.current.map((tab) => tab.id === activeTabIdRef.current ? { ...tab, project: controller.store.snapshot() } : tab);
    const tab = { id: createId("tab"), project: initial };
    const nextTabs = [...savedTabs, tab];
    projectTabsRef.current = nextTabs;
    setProjectTabs(nextTabs);
    applyProjectTab(tab);
    return true;
  }, [applyProjectTab, controller.store]);

  const closeProjectTab = useCallback((tabId: string) => {
    if (projectTabsRef.current.length <= 1) {
      const replacement = { id: createId("tab"), project: createEmptyProject("Untitled") };
      projectTabsRef.current = [replacement];
      setProjectTabs([replacement]);
      applyProjectTab(replacement);
      return;
    }
    const index = projectTabsRef.current.findIndex((tab) => tab.id === tabId);
    const nextTabs = projectTabsRef.current.filter((tab) => tab.id !== tabId);
    projectTabsRef.current = nextTabs;
    setProjectTabs(nextTabs);
    if (tabId === activeTabIdRef.current) applyProjectTab(nextTabs[Math.min(index, nextTabs.length - 1)]!);
  }, [applyProjectTab]);

  const confirmCloseProject = useCallback(async (save: boolean) => {
    if (!closePromptTabId) return;
    const tab = projectTabsRef.current.find((candidate) => candidate.id === closePromptTabId);
    if (save && tab && onSaveRequest) await onSaveRequest(tab.id === activeTabIdRef.current ? controller.store.snapshot() : tab.project);
    closeProjectTab(closePromptTabId);
    setClosePromptTabId(undefined);
  }, [closeProjectTab, closePromptTabId, controller.store, onSaveRequest]);

  const copyIds = useCallback((ids: Iterable<string>) => {
    const copied = copySelection(project, ids);
    setClipboard(copied);
    return copied;
  }, [project]);

  const duplicateIds = useCallback((ids: Iterable<string>, offset: Point = { x: 32, y: 32 }) => {
    const copied = copySelection(project, ids);
    const pasteOffset = project.settings.grid.snapping ? snapClipboardOffset(copied, offset, project.settings.grid.step) : offset;
    let createdIds: string[] = [];
    execute("Duplicate selection", (draft) => {
      createdIds = pasteSelection(draft, copied, pasteOffset);
      queueMicrotask(() => setSelection(new Set(createdIds)));
    });
    return createdIds;
  }, [execute, project]);

  const duplicateSelection = useCallback(() => {
    if (selection.size) duplicateIds(selection);
  }, [duplicateIds, selection]);

  const duplicateContainedNodeForDrag = useCallback((nodeId: string): string | undefined => {
    altDragUsedRef.current = true;
    const copied = copySelection(project, [nodeId]);
    let createdId: string | undefined;
    execute("Duplicate and move Node", (draft) => {
      [createdId] = pasteSelection(draft, copied, { x: 0, y: 0 });
      if (createdId) queueMicrotask(() => setSelection(new Set([createdId!])));
    });
    return createdId;
  }, [execute, project]);

  const cutIds = useCallback((ids: Iterable<string>) => {
    const values = [...ids];
    if (!values.length) return;
    const copied = copyIds(values);
    const copiedIds = new Set([...copied.nodes, ...copied.containers, ...copied.groups, ...copied.annotations].map((item) => item.id));
    execute("Cut selection", (draft) => removeElements(draft, copiedIds));
    setSelection(new Set());
    setCanvasMenu(null);
  }, [copyIds, execute]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (event.code === "Space") {
        const current = performance.now();
        if (current - lastSpaceRef.current < 320 && !event.repeat) commitViewport({ x: 0, y: 0, zoom: viewport.zoom });
        lastSpaceRef.current = current;
        setSpaceHeld(true);
        event.preventDefault();
      }
      if (event.code === "AltLeft" && !event.repeat) { altDownAtRef.current = performance.now(); event.preventDefault(); }
      if ((event.key === "Delete" || event.key === "Backspace") && !readOnly) { deleteSelection(); event.preventDefault(); }
      if (modifier && event.code === "KeyZ" && !readOnly) { void (event.shiftKey ? controller.history.redo() : controller.history.undo()); event.preventDefault(); }
      if (modifier && event.code === "KeyD" && !readOnly) { duplicateSelection(); event.preventDefault(); }
      if (modifier && event.code === "KeyS" && onSaveRequest) { void onSaveRequest(controller.store.snapshot()); event.preventDefault(); }
      if (modifier && event.code === "KeyC") { copyIds(selection); event.preventDefault(); }
      if (modifier && event.code === "KeyX" && !readOnly) { cutIds(selection); event.preventDefault(); }
      if (modifier && event.code === "KeyV" && clipboard && !readOnly) {
        const offset = clipboardOffsetAtPoint(clipboard, mouseWorldRef.current, project.settings.grid.snapping ? project.settings.grid.step : undefined);
        execute("Paste", (draft) => { const ids = pasteSelection(draft, clipboard, offset); queueMicrotask(() => setSelection(new Set(ids))); });
        event.preventDefault();
      }
      if (!visualOnly && event.key === "Enter" && !modifier && !event.repeat && activeSession?.status !== "running") { run(); event.preventDefault(); }
      if (!visualOnly && event.code === "KeyB" && !readOnly) toggleBypass(selection);
      if (event.key === "Escape") { setPendingConnection(undefined); setInteraction(null); setCanvasMenu(null); closeLibrary(); setAppMenuOpen(false); setSettingsOpen(false); setDocumentationOpen(false); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
      if (event.code === "AltLeft") {
        if (altDragUsedRef.current) altDragUsedRef.current = false;
        else if (performance.now() - altDownAtRef.current < 300 && !readOnly) { if (libraryOpen) closeLibrary(); else openLibraryAtPointer(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [activeSession?.status, clipboard, closeLibrary, commitViewport, controller.history, controller.store, copyIds, cutIds, deleteSelection, duplicateSelection, execute, libraryOpen, onSaveRequest, openLibraryAtPointer, project.settings.grid, readOnly, run, selection, toggleBypass, viewport.zoom, visualOnly]);

  const screenToWorld = useCallback((client: Point): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: viewport.x + (client.x - rect.left - rect.width / 2) / viewport.zoom, y: viewport.y + (client.y - rect.top - rect.height / 2) / viewport.zoom };
  }, [viewport]);

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setCanvasMenu(null);
    const target = event.target as HTMLElement;
    if (target.closest("button,input,select,textarea,[contenteditable=true],.on-canvas-ui,.on-library-overlay,.on-context-menu")) return;
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      capturePointer(event.currentTarget, event.pointerId);
      setInteraction({ kind: "pan", pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, startViewport: viewport });
      event.preventDefault();
      return;
    }
    if (event.button === 0 && annotationTool && !readOnly) {
      const world = screenToWorld({ x: event.clientX, y: event.clientY });
      if (annotationTool === "text") {
        const annotation = createAnnotation("text", world);
        execute("Create text", (draft) => { draft.annotations.push(annotation); });
        setSelection(new Set([annotation.id]));
        setAnnotationTool(undefined);
      } else {
        capturePointer(event.currentTarget, event.pointerId);
        const nextInteraction: Extract<NonNullable<Interaction>, { kind: "annotate" }> = { kind: "annotate", pointerId: event.pointerId, tool: annotationTool, startWorld: world, currentWorld: world, points: [world], square: event.shiftKey };
        annotationInteractionRef.current = nextInteraction;
        setInteraction(nextInteraction);
      }
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.target !== event.currentTarget && target.closest(".on-world")) return;
    const world = screenToWorld({ x: event.clientX, y: event.clientY });
    capturePointer(event.currentTarget, event.pointerId);
    setInteraction({ kind: event.altKey && !readOnly ? "group" : "marquee", pointerId: event.pointerId, startWorld: world, currentWorld: world });
    if (!event.shiftKey) setSelection(new Set());
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const world = screenToWorld({ x: event.clientX, y: event.clientY });
    setMouseWorld(world);
    mouseWorldRef.current = world;
    if (pendingConnection) setPendingConnection({ ...pendingConnection, point: world });
    const currentAnnotation = interaction?.kind === "annotate" ? interaction : annotationInteractionRef.current;
    if (currentAnnotation?.pointerId === event.pointerId) {
      const nextInteraction = {
        ...currentAnnotation,
        currentWorld: world,
        square: event.shiftKey,
        points: currentAnnotation.tool === "brush" ? [...currentAnnotation.points, world] : currentAnnotation.points,
      };
      annotationInteractionRef.current = nextInteraction;
      setInteraction(nextInteraction);
      return;
    }
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === "pan") {
      setViewport({ ...interaction.startViewport, x: interaction.startViewport.x - (event.clientX - interaction.startClient.x) / interaction.startViewport.zoom, y: interaction.startViewport.y - (event.clientY - interaction.startClient.y) / interaction.startViewport.zoom });
    } else if (interaction.kind === "drag") {
      const rawOffset = { x: (event.clientX - interaction.startClient.x) / viewport.zoom, y: (event.clientY - interaction.startClient.y) / viewport.zoom };
      const primary = getCanvasElement(project, interaction.primaryId);
      const nextOffset = project.settings.grid.snapping && primary && primary.kind !== "annotation"
        ? snapMovementOffset(primary.position, rawOffset, project.settings.grid.step)
        : rawOffset;
      setDragOffset(nextOffset);
      const primaryNode = project.nodes.find((node) => node.id === interaction.primaryId && !node.parentContainerId);
      const definition = primaryNode ? controller.nodes.get(primaryNode.nodeTypeId, primaryNode.nodeTypeVersion) : undefined;
      const target = primaryNode && definition?.containerCompatible && definition.containerAdapter ? [...project.containers].reverse().find((container) => pointInRect(world, containerDropRect(container))) : undefined;
      setDropTargetContainerId(target?.id);
      setDropTargetContainerIndex(target ? containerInsertionIndex(target, world.y) : undefined);
    } else if (interaction.kind === "resize") {
      const dx = (event.clientX - interaction.startClient.x) / viewport.zoom;
      const dy = (event.clientY - interaction.startClient.y) / viewport.zoom;
      const west = interaction.handle.includes("w");
      const north = interaction.handle.includes("n");
      const element = getCanvasElement(project, interaction.elementId);
      const min: Size = element?.kind === "annotation" ? { width: 20, height: 20 } : element?.kind === "group" ? { width: 120, height: 60 } : element?.kind === "container" ? { width: 190, height: 100 } : { width: 220, height: 100 };
      let x = west ? interaction.startRect.x + dx : interaction.startRect.x;
      let y = north ? interaction.startRect.y + dy : interaction.startRect.y;
      let width = interaction.startRect.width + (west ? -dx : dx);
      let height = interaction.startRect.height + (north ? -dy : dy);
      if (width < min.width) { if (west) x -= min.width - width; width = min.width; }
      if (height < min.height) { if (north) y -= min.height - height; height = min.height; }
      const rect = { x, y, width, height };
      setResizePreview({ elementId: interaction.elementId, rect: project.settings.grid.snapping && element?.kind !== "annotation" ? snapResizeRect(rect, interaction.handle, project.settings.grid.step, min) : rect });
    } else if (interaction.kind === "rotate") {
      const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x) * 180 / Math.PI;
      setRotationPreview({ elementId: interaction.elementId, rotation: interaction.startRotation + angle - interaction.startAngle });
    } else if (interaction.kind === "annotation-point") {
      const points = interaction.points.map((point, index) => index === interaction.pointIndex ? world : point);
      setInteraction({ ...interaction, points });
    } else {
      setInteraction({ ...interaction, currentWorld: world });
    }
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const completedAnnotation = interaction?.kind === "annotate" ? interaction : annotationInteractionRef.current;
    if (completedAnnotation?.pointerId === event.pointerId && !readOnly) {
      const drawn = annotationFromInteraction(completedAnnotation);
      const annotation = drawn.size.width > 4 || drawn.size.height > 4
        ? drawn
        : createAnnotation(completedAnnotation.tool, completedAnnotation.startWorld);
      execute(`Create ${completedAnnotation.tool}`, (draft) => { draft.annotations.push(annotation); });
      setSelection(new Set([annotation.id]));
      annotationInteractionRef.current = null;
      setAnnotationTool(undefined);
      setInteraction(null);
      return;
    }
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === "pan") commitViewport(viewport);
    if (interaction.kind === "drag") {
      const clientDistance = Math.hypot(event.clientX - interaction.startClient.x, event.clientY - interaction.startClient.y);
      const rawOffset = { x: (event.clientX - interaction.startClient.x) / viewport.zoom, y: (event.clientY - interaction.startClient.y) / viewport.zoom };
      const primary = getCanvasElement(project, interaction.primaryId);
      const finalOffset = project.settings.grid.snapping && primary && primary.kind !== "annotation"
        ? snapMovementOffset(primary.position, rawOffset, project.settings.grid.step)
        : rawOffset;
      if (clientDistance > 3) {
        const dropWorld = screenToWorld({ x: event.clientX, y: event.clientY });
        execute("Move elements", (draft) => {
          moveElements(draft, interaction.ids, finalOffset);
          const primaryNode = draft.nodes.find((node) => node.id === interaction.primaryId && !node.parentContainerId);
          const targetContainer = primaryNode ? [...draft.containers].reverse().find((container) => pointInRect(dropWorld, containerDropRect(container))) : undefined;
          if (primaryNode && targetContainer) {
            const definition = controller.nodes.get(primaryNode.nodeTypeId, primaryNode.nodeTypeVersion);
            if (definition?.containerCompatible && definition.containerAdapter) {
              draft.connections = draft.connections.filter((connection) => connection.kind === "decorative" || connection.source.elementId !== primaryNode.id && connection.target.elementId !== primaryNode.id);
              for (const group of draft.groups) group.memberNodeIds = group.memberNodeIds.filter((id) => id !== primaryNode.id);
              primaryNode.parentGroupId = null;
              primaryNode.parentContainerId = targetContainer.id;
              if (!targetContainer.nodeIds.includes(primaryNode.id)) targetContainer.nodeIds.splice(containerInsertionIndex(targetContainer, dropWorld.y), 0, primaryNode.id);
            }
          }
          reconcileGroupMembership(draft);
        });
      } else {
        toggleInspectorFor(interaction.primaryId);
      }
      suppressActivationRef.current = { elementId: interaction.primaryId, until: performance.now() + 400 };
      setDragOffset({ x: 0, y: 0 });
    }
    if (interaction.kind === "resize" && resizePreview) {
      execute("Resize element", (draft) => {
        const element = getCanvasElement(draft, resizePreview.elementId);
        if (!element) return;
        element.position = { x: resizePreview.rect.x, y: resizePreview.rect.y };
        element.size = { width: resizePreview.rect.width, height: resizePreview.rect.height };
        reconcileGroupMembership(draft);
      });
      setResizePreview(undefined);
    }
    if (interaction.kind === "rotate" && rotationPreview) {
      execute("Rotate annotation", (draft) => { const annotation = draft.annotations.find((item) => item.id === rotationPreview.elementId); if (annotation) annotation.rotation = rotationPreview.rotation; });
      setRotationPreview(undefined);
    }
    if (interaction.kind === "annotation-point") {
      const next = annotationFromWorldPoints(interaction.annotation, interaction.points);
      execute("Move arrow endpoint", (draft) => {
        const annotation = draft.annotations.find((item) => item.id === next.id);
        if (!annotation) return;
        annotation.position = next.position;
        annotation.size = next.size;
        annotation.points = next.points;
      });
    }
    if (interaction.kind === "marquee") {
      const rect = normalizedRect(interaction.startWorld, interaction.currentWorld);
      const selected = [...elements, ...project.annotations].filter((element) => rectContainsRect(rect, { ...element.position, ...element.size })).map((element) => element.id);
      setSelection((current) => new Set([...current, ...selected]));
    }
    if (interaction.kind === "group" && !readOnly) {
      const rawRect = normalizedRect(interaction.startWorld, interaction.currentWorld);
      const rect = project.settings.grid.snapping ? snapCreatedRect(rawRect, project.settings.grid.step) : rawRect;
      if (rect.width > 20 && rect.height > 20) {
        const group = createGroup(rect);
        execute("Create Group", (draft) => {
          draft.groups.push(group);
          reconcileGroupMembership(draft);
        });
        setSelection(new Set([group.id]));
      }
    }
    setInteraction(null);
    setDropTargetContainerId(undefined);
    setDropTargetContainerIndex(undefined);
  };

  const onElementPointerDown = (event: ReactPointerEvent, element: CanvasSelectable) => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    suppressActivationRef.current = undefined;
    const wasSelected = selection.has(element.id);
    const nextSelection = event.shiftKey
      ? (() => { const next = new Set(selection); if (wasSelected) next.delete(element.id); else next.add(element.id); return next; })()
      : wasSelected ? new Set(selection) : new Set([element.id]);
    setSelection(nextSelection);
    if (event.shiftKey && wasSelected) return;
    capturePointer(canvasRef.current, event.pointerId);
    if (event.altKey) {
      altDragUsedRef.current = true;
      const copied = copySelection(project, nextSelection);
      let createdIds: string[] = [];
      execute("Duplicate and move", (draft) => {
        createdIds = pasteSelection(draft, copied, { x: 0, y: 0 });
        queueMicrotask(() => {
          const primaryId = createdIds.find((id) => getCanvasElement(controller.store.project, id)?.kind === element.kind) ?? createdIds[0];
          if (!primaryId) return;
          setSelection(new Set(createdIds));
          setInteraction({ kind: "drag", pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, ids: createdIds, primaryId });
        });
      });
      event.preventDefault();
      return;
    }
    const ids = [...new Set([...nextSelection].flatMap((id) => {
      const selected = getCanvasElement(project, id);
      return selected?.kind === "group" ? [id, ...selected.memberNodeIds, ...selected.memberContainerIds] : [id];
    }))];
    setInteraction({ kind: "drag", pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, ids, primaryId: element.id });
  };

  const onElementSelect = (_event: ReactPointerEvent, _element: CanvasSelectable) => {};

  const toggleInspectorFor = useCallback((elementId: string) => {
    const current = inspectorStateRef.current;
    if (current.open && current.elementId === elementId) {
      inspectorStateRef.current = { open: false, elementId };
      setInspectorOpen(false);
      return;
    }
    inspectorStateRef.current = { open: true, elementId };
    setInspectedElementId(elementId);
    setInspectorOpen(true);
  }, []);

  const onElementActivate = (event: ReactMouseEvent, element: CanvasSelectable) => {
    const suppressed = suppressActivationRef.current;
    if (suppressed?.elementId === element.id && performance.now() < suppressed.until) {
      suppressActivationRef.current = undefined;
      return;
    }
    if ((event.target as HTMLElement).closest("input,select,textarea,button,.on-port,.on-resize-handle,.on-annotation-point")) return;
    event.stopPropagation();
    if (!selection.has(element.id)) setSelection(new Set([element.id]));
    toggleInspectorFor(element.id);
  };

  const onResizePointerDown = (event: ReactPointerEvent, element: CanvasSelectable, handle: ResizeHandle) => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    capturePointer(canvasRef.current, event.pointerId);
    const startRect = { ...element.position, ...element.size };
    setResizePreview({ elementId: element.id, rect: startRect });
    setSelection(new Set([element.id]));
    setInteraction({ kind: "resize", pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY }, elementId: element.id, startRect, handle });
  };

  const onAnnotationRotatePointerDown = (event: ReactPointerEvent, annotation: CanvasAnnotation) => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    capturePointer(canvasRef.current, event.pointerId);
    const center = { x: annotation.position.x + annotation.size.width / 2, y: annotation.position.y + annotation.size.height / 2 };
    const point = screenToWorld({ x: event.clientX, y: event.clientY });
    const startAngle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
    setSelection(new Set([annotation.id]));
    setInteraction({ kind: "rotate", pointerId: event.pointerId, elementId: annotation.id, center, startAngle, startRotation: annotation.rotation });
  };

  const onAnnotationPointPointerDown = (event: ReactPointerEvent, annotation: CanvasAnnotation, pointIndex: number) => {
    if (event.button !== 0 || readOnly || !annotation.points?.[pointIndex]) return;
    event.stopPropagation();
    capturePointer(canvasRef.current, event.pointerId);
    setSelection(new Set([annotation.id]));
    setInteraction({
      kind: "annotation-point",
      pointerId: event.pointerId,
      annotation: structuredClone(annotation),
      pointIndex,
      points: annotation.points.map((point) => ({ x: annotation.position.x + point.x, y: annotation.position.y + point.y })),
    });
  };

  const onElementContextMenu = (event: ReactMouseEvent, element: CanvasSelectable) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selection.has(element.id)) setSelection(new Set([element.id]));
    setCanvasMenu({ kind: "element", id: element.id, x: event.clientX, y: event.clientY });
  };

  const onConnectionContextMenu = (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection(new Set([connectionId]));
    setCanvasMenu({ kind: "connection", id: connectionId, x: event.clientX, y: event.clientY });
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = { x: viewport.x + (cursor.x - rect.width / 2) / viewport.zoom, y: viewport.y + (cursor.y - rect.height / 2) / viewport.zoom };
    const factor = Math.exp(-event.deltaY * 0.0015);
    const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const next = { x: world.x - (cursor.x - rect.width / 2) / zoom, y: world.y - (cursor.y - rect.height / 2) / zoom, zoom };
    commitViewport(next);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const position = screenToWorld({ x: event.clientX, y: event.clientY });
    const targetContainerId = (event.target as HTMLElement).closest<HTMLElement>("[data-container-id]")?.dataset.containerId;
    const containerNodeId = event.dataTransfer.getData("application/x-open-container-node");
    if (containerNodeId) {
      execute("Move Node out of Container", (draft) => {
        const node = draft.nodes.find((candidate) => candidate.id === containerNodeId);
        if (!node) return;
        const source = draft.containers.find((container) => container.id === node.parentContainerId);
        const target = targetContainerId ? draft.containers.find((container) => container.id === targetContainerId) : undefined;
        if (source?.id === target?.id) return;
        if (target) {
          const definition = controller.nodes.get(node.nodeTypeId, node.nodeTypeVersion);
          if (!definition?.containerCompatible || !definition.containerAdapter) return;
        }
        if (source) source.nodeIds = source.nodeIds.filter((id) => id !== node.id);
        node.parentContainerId = target?.id ?? null;
        node.position = target ? { ...target.position } : snapPointIfEnabled({ x: position.x - node.size.width / 2, y: position.y - node.size.height / 2 }, draft.settings.grid);
        if (target && !target.nodeIds.includes(node.id)) target.nodeIds.splice(containerInsertionIndex(target, position.y), 0, node.id);
        reconcileGroupMembership(draft);
      });
      setSelection(new Set([containerNodeId]));
      setNativeNodeDragId(undefined);
      setDropTargetContainerId(undefined);
      setDropTargetContainerIndex(undefined);
      return;
    }
    const emptyContainer = event.dataTransfer.getData("application/x-open-empty-container");
    if (emptyContainer) { createEmptyContainer(position); closeLibrary(); return; }
    const presetId = event.dataTransfer.getData("application/x-open-container-preset");
    if (presetId) { createContainerFromPreset(presetId, position); closeLibrary(); return; }
    const typeId = event.dataTransfer.getData("application/x-open-node-type");
    if (!typeId) return;
    const targetContainer = targetContainerId ? project.containers.find((container) => container.id === targetContainerId) : undefined;
    createNode(typeId, position, targetContainerId, targetContainer ? containerInsertionIndex(targetContainer, position.y) : undefined);
    closeLibrary();
  };

  const onCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".on-node,.on-container,.on-group,.on-annotation,.on-canvas-ui,.on-connection-hit")) return;
    mouseClientRef.current = { x: event.clientX, y: event.clientY };
    openLibraryAtClient(mouseClientRef.current);
    event.preventDefault();
  };

  const openFile = async (file?: File) => {
    if (!file || !onOpenRequest) return;
    const source = await file.text();
    if (!createProjectTab()) return;
    await onOpenRequest(source);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onProjectFileDrop = (event: DragEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-node-type-id="open-node.import.universal"]')) return;
    const file = event.dataTransfer.files[0];
    if (!file || !/\.(?:onode\.json|json)$/i.test(file.name)) return;
    event.preventDefault();
    event.stopPropagation();
    void file.text().then(async (source) => {
      try {
        const value = JSON.parse(source) as { format?: string };
        if (value.format !== "open-node-project") { setStatusMessage("JSON file is not an Open Node pipeline"); return; }
        if (!onOpenRequest || !createProjectTab()) return;
        await onOpenRequest(source);
        setStatusMessage(`Opened ${file.name} in a new project tab`);
      } catch {
        setStatusMessage("Could not read the dropped pipeline file");
      }
    });
  };

  const updateNodeParameter = (nodeId: string, parameterId: string, value: unknown) => {
    execute(`Set ${parameterId}`, (draft) => {
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (node) node.parameters[parameterId] = value;
    });
  };

  const updateAnnotationText = (annotationId: string, text: string) => {
    execute("Edit annotation text", (draft) => {
      const annotation = draft.annotations.find((candidate) => candidate.id === annotationId);
      if (annotation?.annotationType === "text") annotation.text = text;
    });
  };

  const importFileToNode = async (nodeId: string, file: File) => {
    if (!controller.assets) return;
    const imported = await controller.assets.import(file as ImportableFile);
    if (imported.preview) imported.reference.metadata["previewUrl"] = imported.preview.value;
    execute("Import Asset", (draft) => {
      if (!draft.assets.some((asset) => asset.id === imported.reference.id)) draft.assets.push(imported.reference);
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      node.parameters["assetId"] = imported.reference.id;
      const outputPort = node.ports.find((port) => port.direction === "output");
      if (outputPort) { outputPort.id = "result"; outputPort.label = "Result"; outputPort.typeId = assetOutputType(imported.reference); outputPort.dynamic = true; }
      node.ports = node.ports.filter((port) => port.direction !== "output" || port === outputPort);
    });
  };

  const renameElement = (elementId: string, value: string) => {
    execute("Rename element", (draft) => {
      const element = getElement(draft, elementId);
      if (!element) return;
      if (element.kind === "node") element.label = value || element.label;
      else element.name = value || (element.kind === "container" ? "Container" : "Group");
    });
  };

  const reorderContainerNode = (containerId: string, nodeId: string, targetIndex: number) => {
    execute("Reorder Container", (draft) => {
      const container = draft.containers.find((candidate) => candidate.id === containerId);
      if (!container) return;
      const from = container.nodeIds.indexOf(nodeId);
      if (from < 0) return;
      container.nodeIds.splice(from, 1);
      const insertion = from < targetIndex ? targetIndex - 1 : targetIndex;
      container.nodeIds.splice(clamp(insertion, 0, container.nodeIds.length), 0, nodeId);
    });
  };

  const mutateConnection = (connectionId: string, mutate: (connection: Connection) => void, label = "Update Connection") => {
    execute(label, (draft) => {
      const connection = draft.connections.find((candidate) => candidate.id === connectionId);
      if (connection) mutate(connection);
    });
  };

  const deleteById = (id: string) => {
    execute("Delete element", (draft) => {
      if (draft.connections.some((connection) => connection.id === id)) draft.connections = draft.connections.filter((connection) => connection.id !== id);
      else removeElements(draft, new Set([id]));
    });
    setSelection(new Set());
    setCanvasMenu(null);
  };

  const deleteElementIds = (ids: Iterable<string>) => {
    const values = [...ids];
    if (!values.length) return;
    execute(values.length > 1 ? "Delete selected elements" : "Delete element", (draft) => removeElements(draft, values));
    setSelection(new Set());
    setCanvasMenu(null);
  };

  const closeFloatingUi = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (libraryOpen && !target.closest(".on-library-overlay,.on-alt-toolbar")) closeLibrary();
    if (appMenuOpen && !target.closest(".on-project-menu-wrap")) setAppMenuOpen(false);
    if (canvasMenu && !target.closest(".on-context-menu")) setCanvasMenu(null);
    if (inspectorOpen && !target.closest(".on-inspector,.on-node,.on-contained-node,.on-container,.on-group,.on-annotation")) closeInspector();
  };

  const marqueeRect = interaction && (interaction.kind === "marquee" || interaction.kind === "group") ? normalizedRect(interaction.startWorld, interaction.currentWorld) : undefined;
  const timeline = controller.timeline.context;
  const contextElementIds = canvasMenu?.kind === "element" && selection.has(canvasMenu.id) ? selection : canvasMenu?.kind === "element" ? new Set([canvasMenu.id]) : new Set<string>();
  void timelineRevision;
  void sessionRevision;

  return (
    <div ref={rootRef} className={`on-editor ${project.settings.portsVisible === false ? "is-ports-hidden" : ""} ${project.timeline.enabled && !project.settings.timelineVisible ? "is-timeline-hidden" : ""} ${nativeNodeDragId ? "is-native-node-dragging" : ""} ${className}`} data-theme={theme} data-reduced-motion={project.settings.reducedMotion} style={themeStyle} onPointerDownCapture={closeFloatingUi} onPointerMoveCapture={(event) => { mouseClientRef.current = { x: event.clientX, y: event.clientY }; }} onDragOverCapture={(event) => { if (event.dataTransfer.types.includes("Files") && !(event.target as HTMLElement).closest('[data-node-type-id="open-node.import.universal"]')) event.preventDefault(); }} onDropCapture={onProjectFileDrop}>
      <header className="on-toolbar" aria-label="Open Node toolbar">
        <span className="on-brand-label">OPEN NODE</span>
        <div className="on-project-tabs">
          {projectTabs.map((tab) => <div className={`on-project-tab ${tab.id === activeTabId ? "is-active" : ""}`} key={tab.id}>
            {tab.id === activeTabId ? <ProjectNameInput value={project.metadata.name} onCommit={(value) => controller.store.mutate((draft) => { draft.metadata.name = value || "Untitled"; }, "settings")} /> : <button onClick={() => activateProjectTab(tab.id)}>{tab.project.metadata.name || "Untitled"}</button>}
            {tab.id === activeTabId && <div className="on-project-menu-wrap"><button className="on-chevron-button" onClick={() => setAppMenuOpen((value) => !value)} aria-expanded={appMenuOpen} aria-label="Project menu">▾</button>{appMenuOpen && <div className="on-app-menu">
              <button disabled={!onSaveRequest} onClick={() => { void onSaveRequest?.(controller.store.snapshot()); setAppMenuOpen(false); }}>Save project <kbd>Ctrl S</kbd></button>
              <button disabled={!onOpenRequest || projectTabs.length >= 4} onClick={() => { fileInputRef.current?.click(); setAppMenuOpen(false); }}>Load in new tab</button>
              <hr />
              <button onClick={() => { setSettingsOpen(true); setAppMenuOpen(false); }}>Settings…</button>
              <button onClick={() => { setDocumentationOpen(true); setAppMenuOpen(false); }}>Documentation</button>
            </div>}</div>}
            <button className="on-tab-close" onClick={() => setClosePromptTabId(tab.id)} aria-label={`Close ${tab.project.metadata.name}`}>×</button>
          </div>)}
          {projectTabs.length < 4 && <><span className="on-project-separator">|</span><button className="on-new-project" onClick={() => createProjectTab()} title="New project">+</button></>}
        </div>
        <input ref={fileInputRef} hidden type="file" accept=".json,.onode.json" onChange={(event) => void openFile(event.target.files?.[0])} />
        <div className="on-toolbar-group">
          <button disabled={readOnly || !controller.history.state.canUndo} onClick={() => void controller.history.undo()} title="Undo (Ctrl/Cmd+Z)">↶</button>
          <button disabled={readOnly || !controller.history.state.canRedo} onClick={() => void controller.history.redo()} title="Redo">↷</button>
        </div>
        {!visualOnly && <div className="on-toolbar-group on-run-controls">
          <select aria-label="Execution mode" value={project.execution.mode} disabled={readOnly} onChange={(event) => controller.store.mutate((draft) => { draft.execution.mode = event.target.value as OpenNodeProject["execution"]["mode"]; }, "settings")}>
            <option value="manual">Manual</option><option value="reactive">Reactive</option><option value="continuous">Continuous</option><option value="timeline">Timeline</option>
          </select>
          <button className="on-run-button" onClick={run} disabled={activeSession?.status === "running"}>▶ Run</button>
          <button onClick={() => activeSession?.cancel()} disabled={!activeSession || activeSession.status !== "running"}>■ Stop</button>
          <span className={`on-status-dot is-${activeSession?.status ?? "idle"}`} aria-label={`Execution ${activeSession?.status ?? "idle"}`} />
        </div>}
        <div className="on-toolbar-spacer" />
        <div className="on-toolbar-group">
          <span className="on-alt-hint">Left Alt — Library</span>
          <button onClick={() => controller.store.mutate((draft) => { draft.settings.theme = draft.settings.theme === "dark" ? "light" : "dark"; }, "settings")} aria-label="Toggle theme">◐</button>
        </div>
      </header>

      <div ref={workspaceRef} className="on-workspace">
        {libraryOpen && <LibraryOverlay definitions={controller.nodes.list()} project={project} search={search} onSearch={setSearch} position={libraryPosition} size={librarySize} onPosition={(position) => setLibraryPosition(clampLibraryPosition(position))} onPositionEnd={(position) => { const next = clampLibraryPosition(position); setLibraryPosition(next); persistLibraryLayout(next, librarySize); }} onSize={(size) => { const nextPosition = clampLibraryPosition(libraryPosition, size); setLibrarySize(size); setLibraryPosition(nextPosition); persistLibraryLayout(nextPosition, size); }} onCreateNode={(typeId) => { createNode(typeId, viewport); closeLibrary(); }} onCreateContainer={() => { createEmptyContainer(viewport); closeLibrary(); }} onCreatePreset={(presetId) => { createContainerFromPreset(presetId, viewport); closeLibrary(); }} onClose={closeLibrary} />}
        {libraryOpen && <AnnotationToolPalette position={libraryPosition} activeTool={annotationTool} connectionsVisible={project.settings.connectionsVisible !== false} portsVisible={project.settings.portsVisible !== false} groupsVisible={project.settings.groupsVisible !== false} annotationsVisible={project.settings.annotationsVisible !== false} gridVisible={project.settings.grid.enabled} onTool={(tool) => { setAnnotationTool(tool); closeLibrary(); }} onConnections={() => controller.store.mutate((draft) => { draft.settings.connectionsVisible = draft.settings.connectionsVisible === false; }, "settings")} onPorts={() => controller.store.mutate((draft) => { draft.settings.portsVisible = draft.settings.portsVisible === false; }, "settings")} onGroups={() => controller.store.mutate((draft) => { draft.settings.groupsVisible = draft.settings.groupsVisible === false; }, "settings")} onAnnotations={() => controller.store.mutate((draft) => { draft.settings.annotationsVisible = draft.settings.annotationsVisible === false; }, "settings")} onGrid={() => controller.store.mutate((draft) => { draft.settings.grid.enabled = !draft.settings.grid.enabled; }, "settings")} />}

        <main
          ref={canvasRef}
          className={`on-canvas ${spaceHeld ? "is-panning" : ""}`}
          style={canvasBackground(project)}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onDoubleClick={onCanvasDoubleClick}
          onWheel={onWheel}
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            if (!nativeNodeDragId) return;
            const containerId = (event.target as HTMLElement).closest<HTMLElement>("[data-container-id]")?.dataset.containerId;
            const container = containerId ? project.containers.find((candidate) => candidate.id === containerId) : undefined;
            setDropTargetContainerId(containerId);
            setDropTargetContainerIndex(container ? containerInsertionIndex(container, screenToWorld({ x: event.clientX, y: event.clientY }).y) : undefined);
          }}
          onContextMenu={(event) => event.preventDefault()}
          tabIndex={0}
          aria-label="Infinite graph canvas"
        >
          {project.settings.grid.enabled && <div className="on-grid" style={gridStyle(project, viewport, canvasSize)} />}
          {nativeNodeDragId && !dropTargetContainerId && <div className="on-canvas-node-drop-preview" />}
          <div className="on-world" style={{ transform: worldTransform }}>
            {project.settings.connectionsVisible !== false && <ConnectionLayer project={project} elements={elements} selection={selection} dragIds={interaction?.kind === "drag" ? new Set(interaction.ids) : new Set()} dragOffset={displayOffset} resizePreview={resizePreview} pending={pendingConnection} error={connectionError} onSelect={(id) => setSelection(new Set([id]))} onContextMenu={onConnectionContextMenu} onDetach={deleteById} />}
            {project.settings.groupsVisible !== false && visibleElements.filter((element) => element.kind === "group").map((element) => <GroupView key={element.id} group={element as GroupInstance} selected={selection.has(element.id)} dragging={interaction?.kind === "drag" && interaction.ids.includes(element.id)} offset={interaction?.kind === "drag" && interaction.ids.includes(element.id) ? displayOffset : { x: 0, y: 0 }} previewRect={resizePreview?.elementId === element.id ? resizePreview.rect : undefined} readOnly={readOnly} onPointerDown={onElementPointerDown} onSelect={onElementSelect} onActivate={onElementActivate} onContextMenu={onElementContextMenu} onResize={onResizePointerDown} onRename={renameElement} />)}
            {visibleElements.filter((element) => element.kind === "container").map((element) => <ContainerView key={element.id} container={element as ContainerInstance} project={project} definitions={controller.nodes} session={activeSession} selected={selection.has(element.id)} dragging={interaction?.kind === "drag" && interaction.ids.includes(element.id)} dropTarget={dropTargetContainerId === element.id} externalDropIndex={dropTargetContainerId === element.id ? dropTargetContainerIndex : undefined} offset={interaction?.kind === "drag" && interaction.ids.includes(element.id) ? displayOffset : { x: 0, y: 0 }} previewRect={resizePreview?.elementId === element.id ? resizePreview.rect : undefined} readOnly={readOnly} onPointerDown={onElementPointerDown} onSelect={onElementSelect} onActivate={onElementActivate} onContextMenu={onElementContextMenu} onResize={onResizePointerDown} onRename={renameElement} onStartConnection={(elementId, portId, kind, point) => setPendingConnection({ sourceElementId: elementId, sourcePortId: portId, kind, point })} onFinishConnection={createConnection} onReorder={reorderContainerNode} onSelectNode={(nodeId) => {
              const suppressed = suppressActivationRef.current;
              if (suppressed?.elementId === nodeId && performance.now() < suppressed.until) { suppressActivationRef.current = undefined; return; }
              setSelection(new Set([nodeId]));
              toggleInspectorFor(nodeId);
            }} onDuplicateNodeForDrag={duplicateContainedNodeForDrag} onNodeDragState={(nodeId) => {
              setNativeNodeDragId(nodeId);
              if (nodeId) suppressActivationRef.current = { elementId: nodeId, until: Number.POSITIVE_INFINITY };
              else if (suppressActivationRef.current) suppressActivationRef.current = { ...suppressActivationRef.current, until: performance.now() + 120 };
            }} onParameterCommit={updateNodeParameter} onFileDrop={(nodeId, file) => void importFileToNode(nodeId, file)} />)}
            {visibleElements.filter((element) => element.kind === "node" && !(element as NodeInstance).parentContainerId).map((element) => <NodeView key={element.id} node={element as NodeInstance} definition={controller.nodes.get((element as NodeInstance).nodeTypeId, (element as NodeInstance).nodeTypeVersion)} project={project} timelineTime={timeline.timeSeconds} session={activeSession} selected={selection.has(element.id)} dragging={interaction?.kind === "drag" && interaction.ids.includes(element.id)} offset={interaction?.kind === "drag" && interaction.ids.includes(element.id) ? displayOffset : { x: 0, y: 0 }} previewRect={resizePreview?.elementId === element.id ? resizePreview.rect : undefined} readOnly={readOnly} onPointerDown={onElementPointerDown} onSelect={onElementSelect} onActivate={onElementActivate} onContextMenu={onElementContextMenu} onResize={onResizePointerDown} onParameterCommit={updateNodeParameter} onFileDrop={(file) => void importFileToNode(element.id, file)} onStartConnection={(nodeId, portId, kind, point) => setPendingConnection({ sourceElementId: nodeId, sourcePortId: portId, kind, point })} onFinishConnection={createConnection} />)}
            {project.settings.annotationsVisible !== false && project.annotations.map((annotation) => {
              const rendered = annotationPointPreview?.id === annotation.id ? annotationPointPreview : annotation;
              return <AnnotationView key={annotation.id} annotation={rendered} selected={selection.has(annotation.id)} offset={interaction?.kind === "drag" && interaction.ids.includes(annotation.id) ? displayOffset : { x: 0, y: 0 }} previewRect={resizePreview?.elementId === annotation.id ? resizePreview.rect : undefined} previewRotation={rotationPreview?.elementId === annotation.id ? rotationPreview.rotation : undefined} readOnly={readOnly} onPointerDown={onElementPointerDown} onSelect={onElementSelect} onActivate={onElementActivate} onContextMenu={onElementContextMenu} onResize={onResizePointerDown} onRotate={onAnnotationRotatePointerDown} onPoint={onAnnotationPointPointerDown} onTextCommit={updateAnnotationText} />;
            })}
            {annotationPreview && <AnnotationView annotation={annotationPreview} selected={false} offset={{ x: 0, y: 0 }} readOnly preview />}
            {marqueeRect && <div className={`on-marquee ${interaction?.kind === "group" ? "is-group" : ""}`} style={rectStyle(marqueeRect)} />}
          </div>

          <div className="on-bottom-left-controls on-canvas-ui">
            {!visualOnly && project.timeline.enabled && !project.settings.timelineVisible && <button className="on-timeline-canvas-toggle" onClick={() => controller.store.mutate((draft) => { draft.settings.timelineVisible = true; }, "settings")} title="Show Timeline">▴</button>}
            <div className="on-canvas-controls">
              <button onClick={() => commitViewport({ ...viewport, zoom: clamp(viewport.zoom / 1.2, MIN_ZOOM, MAX_ZOOM) })}>−</button>
              <button onClick={() => commitViewport({ ...viewport, zoom: 1 })}>{Math.round(viewport.zoom * 100)}%</button>
              <button onClick={() => commitViewport({ ...viewport, zoom: clamp(viewport.zoom * 1.2, MIN_ZOOM, MAX_ZOOM) })}>+</button>
              <button onClick={() => fit()}>Fit</button>
              <button onClick={() => commitViewport({ x: 0, y: 0, zoom: viewport.zoom })}>Origin</button>
            </div>
          </div>

          {minimapOpen ? <Minimap project={project} viewport={viewport} canvasSize={canvasSize} onNavigate={(point) => commitViewport({ ...viewport, ...point })} onClose={() => controller.store.mutate((draft) => { draft.settings.minimapVisible = false; }, "settings")} /> : <button className="on-minimap-toggle on-canvas-ui" onClick={() => controller.store.mutate((draft) => { draft.settings.minimapVisible = true; }, "settings")}>Map</button>}
          {!visualOnly && (dashboardOpen ? <ResourceDashboard metrics={metrics} onClose={() => controller.store.mutate((draft) => { draft.settings.dashboardVisible = false; }, "settings")} /> : <button className="on-dashboard-toggle on-canvas-ui" onClick={() => controller.store.mutate((draft) => { draft.settings.dashboardVisible = true; }, "settings")}>Stats</button>)}
        </main>

        <Inspector open={inspectorOpen} element={inspectedElement} project={project} definitions={controller.nodes} assets={controller.assets} readOnly={readOnly} execute={execute} onClose={closeInspector} />
      </div>

      {!visualOnly && project.timeline.enabled && project.settings.timelineVisible && <TimelineBar controller={controller.timeline} settings={project.timeline} onHide={() => controller.store.mutate((draft) => { draft.settings.timelineVisible = false; }, "settings")} onChange={(patch) => controller.store.mutate((draft) => { draft.timeline = { ...draft.timeline, ...patch }; }, "timeline")} />}
      <footer className="on-statusbar">
        {!visualOnly && <div className="on-progress-track"><div className={`on-progress-fill ${activeSession?.progress.percent == null ? "is-indeterminate" : ""}`} style={{ width: `${activeSession?.progress.percent ?? 18}%` }} /></div>}
        <span>{visualOnly ? "Visual architecture map" : statusMessage}</span>{!visualOnly && <span>{activeSession ? `${activeSession.progress.completed}/${activeSession.progress.total}` : "0/0"}</span>}
        <span className="on-status-spacer" /><span>Zoom {Math.round(viewport.zoom * 100)}%</span><span>Mouse X {Math.round(mouseWorld.x)} / Y {Math.round(mouseWorld.y)}</span><span>{project.metadata.updatedAt === project.metadata.createdAt ? "Saved" : "Modified"}</span>
      </footer>
      {canvasMenu?.kind === "element" && <ElementContextMenu menu={canvasMenu} element={getCanvasElement(project, canvasMenu.id)} selectionCount={contextElementIds.size} readOnly={readOnly} onCopy={() => { copyIds(contextElementIds); setCanvasMenu(null); }} onDuplicate={() => { duplicateIds(contextElementIds); setCanvasMenu(null); }} onCut={() => cutIds(contextElementIds)} onDelete={() => deleteElementIds(contextElementIds)} onBypass={() => { toggleBypass(contextElementIds); setCanvasMenu(null); }} onSaveContainer={() => { saveContainerPreset(canvasMenu.id); setCanvasMenu(null); }} onClose={() => setCanvasMenu(null)} />}
      {canvasMenu?.kind === "connection" && <ConnectionContextMenu menu={canvasMenu} connection={project.connections.find((connection) => connection.id === canvasMenu.id)} defaultRouting={project.settings.connectionRouting} readOnly={readOnly} onRouting={(routing) => { mutateConnection(canvasMenu.id, (connection) => { if (routing === "default") { connection.routingOverride = false; connection.routing = project.settings.connectionRouting; } else { connection.routingOverride = true; connection.routing = routing; } }); setCanvasMenu(null); }} onArrow={(arrowhead) => { mutateConnection(canvasMenu.id, (connection) => { connection.arrowhead = arrowhead; }); setCanvasMenu(null); }} onDelete={() => deleteById(canvasMenu.id)} onClose={() => setCanvasMenu(null)} />}
      {settingsOpen && <SettingsDialog project={project} readOnly={readOnly} onChange={(mutate) => controller.store.mutate(mutate, "settings")} onClose={() => setSettingsOpen(false)} />}
      {documentationOpen && <DocumentationDialog onClose={() => setDocumentationOpen(false)} />}
      {closePromptTabId && <CloseProjectDialog name={(projectTabs.find((tab) => tab.id === closePromptTabId)?.project.metadata.name || "Untitled")} canSave={Boolean(onSaveRequest)} onSave={() => void confirmCloseProject(true)} onDiscard={() => void confirmCloseProject(false)} onCancel={() => setClosePromptTabId(undefined)} />}
    </div>
  );
});

function LibraryOverlay({ definitions, project, search, onSearch, position, size, onPosition, onPositionEnd, onSize, onCreateNode, onCreateContainer, onCreatePreset, onClose }: {
  definitions: NodeDefinition[]; project: OpenNodeProject; search: string; position: Point; size: Size; onSearch(value: string): void; onPosition(point: Point): void; onPositionEnd(point: Point): void; onSize(size: Size): void;
  onCreateNode(typeId: string): void; onCreateContainer(): void; onCreatePreset(presetId: string): void; onClose(): void;
}) {
  const [tab, setTab] = useState<"recent" | "nodes" | "containers">(() => project.settings.recentLibraryItems?.length ? "recent" : "nodes");
  const [drag, setDrag] = useState<{ pointerId: number; offset: Point }>();
  const filtered = definitions.filter((definition) => [definition.displayName, definition.description ?? "", definition.category, ...(definition.tags ?? [])].join(" ").toLowerCase().includes(search.toLowerCase()));
  const presets = project.presets.filter((preset): preset is ContainerPreset => preset.kind === "container");
  const filteredPresets = presets.filter((preset) => [preset.name, ...preset.nodes.flatMap((node) => [node.label, node.nodeTypeId])].join(" ").toLowerCase().includes(search.toLowerCase()));
  const showEmpty = "empty container".includes(search.toLowerCase());
  const searching = search.trim().length > 0;
  const nodeTile = (definition: NodeDefinition, key = definition.typeId) => <button key={key} className="on-library-tile" draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-open-node-type", definition.typeId); event.dataTransfer.effectAllowed = "copy"; }} onDoubleClick={() => onCreateNode(definition.typeId)} title={definition.description}>
    <strong className="on-library-tile-title">{definition.displayName}</strong><NodeLibraryPreview definition={definition} />
  </button>;
  const emptyContainerTile = (key = "empty-container") => <button key={key} className="on-library-tile" draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-open-empty-container", "true"); event.dataTransfer.effectAllowed = "copy"; }} onDoubleClick={onCreateContainer}><strong className="on-library-tile-title">Empty Container</strong><ContainerLibraryPreview name="Empty Container" color="#ffffff" nodeCount={0} /></button>;
  const presetTile = (preset: ContainerPreset, key = preset.id) => <button className="on-library-tile" key={key} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-open-container-preset", preset.id); event.dataTransfer.effectAllowed = "copy"; }} onDoubleClick={() => onCreatePreset(preset.id)}><strong className="on-library-tile-title">{preset.name}</strong><ContainerLibraryPreview name={preset.name} color={preset.color ?? "#ffffff"} nodeCount={preset.nodes.length} /></button>;
  const recentTiles = (project.settings.recentLibraryItems ?? []).flatMap((item, index) => {
    if (item.kind === "node") {
      const definition = definitions.find((candidate) => candidate.typeId === item.id);
      return definition ? [nodeTile(definition, `recent-node-${item.id}-${index}`)] : [];
    }
    if (item.id === "empty") return [emptyContainerTile(`recent-container-empty-${index}`)];
    const preset = presets.find((candidate) => candidate.id === item.id);
    return preset ? [presetTile(preset, `recent-container-${item.id}-${index}`)] : [];
  });
  return <aside className={`on-library-overlay on-canvas-ui ${searching ? "is-searching" : ""}`} style={{ left: position.x, top: position.y, width: size.width, height: size.height }} aria-label="Node and Container Library" onPointerUpCapture={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSize({ width: Math.round(rect.width), height: Math.round(rect.height) }); }}>
    <div className="on-library-dragbar" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; capturePointer(event.currentTarget, event.pointerId); setDrag({ pointerId: event.pointerId, offset: { x: event.clientX - position.x, y: event.clientY - position.y } }); }} onPointerMove={(event) => { if (drag?.pointerId === event.pointerId) onPosition({ x: Math.max(8, event.clientX - drag.offset.x), y: Math.max(8, event.clientY - drag.offset.y) }); }} onPointerUp={(event) => { if (drag?.pointerId === event.pointerId) { const next = { x: Math.max(8, event.clientX - drag.offset.x), y: Math.max(8, event.clientY - drag.offset.y) }; onPosition(next); onPositionEnd(next); setDrag(undefined); } }}>
      <strong>Library</strong><span>drag</span><button className="on-library-close" onClick={onClose} aria-label="Close Library">×</button>
    </div>
    <div className="on-search"><span>⌕</span><input autoFocus placeholder="Search Nodes and Containers…" value={search} onChange={(event) => onSearch(event.target.value)} /></div>
    {!searching && <div className="on-library-tabs"><button className={tab === "recent" ? "is-active" : ""} onClick={() => setTab("recent")}>Recently <small>{recentTiles.length}</small></button><button className={tab === "nodes" ? "is-active" : ""} onClick={() => setTab("nodes")}>Nodes <small>{definitions.length}</small></button><button className={tab === "containers" ? "is-active" : ""} onClick={() => setTab("containers")}>Containers <small>{presets.length + 1}</small></button></div>}
    {searching && <div className="on-library-grid is-unified">{filtered.map((definition) => nodeTile(definition))}{showEmpty && emptyContainerTile()}{filteredPresets.map((preset) => presetTile(preset))}{filtered.length === 0 && !showEmpty && filteredPresets.length === 0 && <div className="on-empty">No matching Nodes or Containers</div>}</div>}
    {!searching && tab === "recent" && <div className="on-library-grid is-recent">{recentTiles}{recentTiles.length === 0 && <div className="on-empty">Recently used Nodes and Containers will appear here</div>}</div>}
    {!searching && tab === "nodes" && <div className="on-library-grid">{filtered.map((definition) => nodeTile(definition))}{filtered.length === 0 && <div className="on-empty">No matching Nodes</div>}</div>}
    {!searching && tab === "containers" && <div className="on-library-grid is-containers">{emptyContainerTile()}{filteredPresets.map((preset) => presetTile(preset))}</div>}
    <div className="on-panel-hint">Drag to canvas · double-click to add · Left Alt to close</div>
  </aside>;
}

function NodeLibraryPreview({ definition }: { definition: NodeDefinition }) {
  const inputCount = definition.inputs.length;
  const outputCount = definition.outputs.length;
  return <span className="on-node-preview-mini" style={{ "--element-color": definition.defaultColor ?? "#667085" } as CSSProperties}><span className="on-node-preview-header"><i>{definition.icon ?? definition.displayName.slice(0, 2).toUpperCase()}</i><b>{definition.displayName}</b></span><span className="on-node-preview-body"><small>{definition.category}</small>{definition.parameters.slice(0, 2).map((parameter) => <em key={parameter.id}>{parameter.label}</em>)}</span><span className="on-preview-ports is-input">{Array.from({ length: inputCount }, (_, index) => <i key={index} />)}</span><span className="on-preview-ports is-output">{Array.from({ length: outputCount }, (_, index) => <i key={index} />)}</span></span>;
}

function ContainerLibraryPreview({ name, color, nodeCount }: { name: string; color: string; nodeCount: number }) {
  return <span className="on-container-preview-mini" style={{ "--element-color": color } as CSSProperties}><span className="on-container-preview-header"><b>{name}</b><small>{nodeCount}</small></span><span className="on-container-preview-port is-input" /><span className="on-container-preview-port is-output" /><span className="on-container-preview-rows">{Array.from({ length: Math.min(3, Math.max(1, nodeCount)) }, (_, index) => <i key={index} />)}</span></span>;
}

function AnnotationToolPalette({ position, activeTool, connectionsVisible, portsVisible, groupsVisible, annotationsVisible, gridVisible, onTool, onConnections, onPorts, onGroups, onAnnotations, onGrid }: {
  position: Point; activeTool?: AnnotationType; connectionsVisible: boolean; portsVisible: boolean; groupsVisible: boolean; annotationsVisible: boolean; gridVisible: boolean;
  onTool(tool: AnnotationType): void; onConnections(): void; onPorts(): void; onGroups(): void; onAnnotations(): void; onGrid(): void;
}) {
  const actions: Array<{ id: string; label: string; title: string; active: boolean; run(): void }> = [
    { id: "arrow", label: "→", title: "Arrow", active: activeTool === "arrow", run: () => onTool("arrow") },
    { id: "brush", label: "✎", title: "Curve / brush", active: activeTool === "brush", run: () => onTool("brush") },
    { id: "text", label: "T", title: "Text", active: activeTool === "text", run: () => onTool("text") },
    { id: "rectangle", label: "□", title: "Rectangle", active: activeTool === "rectangle", run: () => onTool("rectangle") },
    { id: "ellipse", label: "○", title: "Circle / ellipse", active: activeTool === "ellipse", run: () => onTool("ellipse") },
    { id: "diamond", label: "◇", title: "Diamond", active: activeTool === "diamond", run: () => onTool("diamond") },
    { id: "connections", label: "⌁", title: "Show or hide connections", active: connectionsVisible, run: onConnections },
    { id: "ports", label: "◉", title: "Show or hide ports", active: portsVisible, run: onPorts },
    { id: "groups", label: "▱", title: "Show or hide every Group", active: groupsVisible, run: onGroups },
    { id: "annotations", label: "✦", title: "Show or hide every annotation", active: annotationsVisible, run: onAnnotations },
    { id: "grid", label: "▦", title: "Show or hide Canvas grid", active: gridVisible, run: onGrid },
  ];
  return <div className="on-alt-toolbar on-canvas-ui" style={{ left: position.x, top: position.y - ALT_TOOLBAR_HEIGHT }}>
    {actions.map((action) => <button key={action.id} className={action.active ? "is-active" : ""} onClick={action.run} title={action.title}>{action.label}</button>)}
  </div>;
}

function isTextCanvasNode(node: NodeInstance): boolean {
  return node.nodeTypeId === "open-node.core.text" || node.nodeTypeId === "exocortex.architecture.module";
}

const NodeView = memo(function NodeView({ node, definition, project, timelineTime, session, selected, dragging, offset, previewRect, readOnly, onPointerDown, onSelect, onActivate, onContextMenu, onResize, onParameterCommit, onFileDrop, onStartConnection, onFinishConnection }: {
  node: NodeInstance; definition?: NodeDefinition; project: OpenNodeProject; timelineTime: number; session?: ExecutionSession; selected: boolean; dragging: boolean; offset: Point; previewRect?: Rect; readOnly: boolean;
  onPointerDown(event: ReactPointerEvent, element: GraphElement): void; onSelect(event: ReactPointerEvent, element: GraphElement): void; onActivate(event: ReactMouseEvent, element: GraphElement): void; onContextMenu(event: ReactMouseEvent, element: GraphElement): void;
  onResize(event: ReactPointerEvent, element: GraphElement, handle: ResizeHandle): void; onParameterCommit(nodeId: string, parameterId: string, value: unknown): void;
  onFileDrop(file: File): void;
  onStartConnection(nodeId: string, portId: string, kind: "data" | "control", point: Point): void; onFinishConnection(nodeId: string, portId: string): void;
}) {
  const state = session?.elementStates.get(node.id);
  const inputs = node.ports.filter((port) => port.direction === "input");
  const outputs = node.ports.filter((port) => port.direction === "output");
  const assetId = String(node.parameters["assetId"] ?? "");
  const asset = project.assets.find((item) => item.id === assetId);
  const rect = previewRect ?? { x: node.position.x + offset.x, y: node.position.y + offset.y, width: node.size.width, height: node.size.height };
  return <article className={`on-node ${isTextCanvasNode(node) ? "is-text-node" : ""} ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${node.bypassed ? "is-bypassed" : ""} is-status-${state?.status ?? "idle"}`} style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: rect.height, ...(isTextCanvasNode(node) ? { height: rect.height } : {}), "--element-color": node.color ?? definition?.defaultColor ?? "#667085" } as CSSProperties} data-node-id={node.id} data-node-type-id={node.nodeTypeId} onDragOver={(event) => { if (node.nodeTypeId === "open-node.import.universal" && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { const file = event.dataTransfer.files[0]; if (node.nodeTypeId === "open-node.import.universal" && file) { event.preventDefault(); event.stopPropagation(); onFileDrop(file); } }} onPointerDown={(event) => { onSelect(event, node); if (!(event.target as HTMLElement).closest("input,select,textarea,button,.on-port,.on-resize-handle")) onPointerDown(event, node); }} onClick={(event) => onActivate(event, node)} onContextMenu={(event) => onContextMenu(event, node)}>
    <header onPointerDown={(event) => onPointerDown(event, node)}><span className="on-node-icon">{definition?.icon ?? node.label.slice(0, 2).toUpperCase()}</span><div><strong>{node.label}</strong><small>{definition?.category ?? "Unresolved"}</small></div><span className={`on-node-state is-${state?.status ?? "idle"}`}>{state?.status ?? "idle"}</span></header>
    <div className="on-node-body">
      <div className="on-port-column is-input">{inputs.map((port, index) => <Port key={port.id} port={port} elementId={node.id} top={NODE_PORT_START - NODE_HEADER_HEIGHT + PORT_VISUAL_OFFSET_Y + index * NODE_PORT_GAP} side="left" onPointerDown={() => {}} onPointerUp={() => onFinishConnection(node.id, port.id)} />)}</div>
      <div className="on-node-summary">{node.unresolved ? <span className="on-error-text">{node.unresolved.reason}</span> : <ParameterSummary node={node} definition={definition} readOnly={readOnly} onCommit={onParameterCommit} />}</div>
      <div className="on-port-column is-output">{outputs.map((port, index) => <Port key={port.id} port={port} elementId={node.id} top={NODE_PORT_START - NODE_HEADER_HEIGHT + PORT_VISUAL_OFFSET_Y + index * NODE_PORT_GAP} side="right" onPointerDown={(event) => { event.stopPropagation(); onStartConnection(node.id, port.id, port.kind, { x: rect.x + rect.width, y: rect.y + NODE_PORT_START + PORT_VISUAL_OFFSET_Y + index * NODE_PORT_GAP }); }} onPointerUp={() => {}} />)}</div>
      {asset && node.uiState.previewEnabled !== false && <AssetPreview asset={asset} timelineTime={timelineTime} />}
      {definition?.capabilities?.preview && !asset && session?.results.get(node.id) && <pre className="on-value-preview">{formatOutputs(session.results.get(node.id)?.outputs)}</pre>}
    </div>
    {state?.progress != null && state.status === "running" && <div className="on-node-progress"><span style={{ width: `${state.progress * 100}%` }} /></div>}
    {!readOnly && <ResizeHandles element={node} onResize={onResize} />}
  </article>;
});

function ContainerView({ container, project, definitions, session, selected, dragging, dropTarget, externalDropIndex, offset, previewRect, readOnly, onPointerDown, onSelect, onActivate, onContextMenu, onResize, onRename, onStartConnection, onFinishConnection, onReorder, onSelectNode, onDuplicateNodeForDrag, onNodeDragState, onParameterCommit, onFileDrop }: {
  container: ContainerInstance; project: OpenNodeProject; definitions: NodeRegistry; session?: ExecutionSession; selected: boolean; dragging: boolean; dropTarget: boolean; externalDropIndex?: number; offset: Point; previewRect?: Rect; readOnly: boolean;
  onPointerDown(event: ReactPointerEvent, element: GraphElement): void; onSelect(event: ReactPointerEvent, element: GraphElement): void; onActivate(event: ReactMouseEvent, element: GraphElement): void; onContextMenu(event: ReactMouseEvent, element: GraphElement): void;
  onResize(event: ReactPointerEvent, element: GraphElement, handle: ResizeHandle): void; onRename(elementId: string, value: string): void;
  onStartConnection(elementId: string, portId: string, kind: "data" | "control", point: Point): void; onFinishConnection(elementId: string, portId: string): void; onReorder(containerId: string, nodeId: string, targetIndex: number): void; onSelectNode(nodeId: string): void; onDuplicateNodeForDrag(nodeId: string): string | undefined; onNodeDragState(nodeId?: string): void; onParameterCommit(nodeId: string, parameterId: string, value: unknown): void; onFileDrop(nodeId: string, file: File): void;
}) {
  const [dropIndex, setDropIndex] = useState<number>();
  const state = session?.elementStates.get(container.id);
  const nodes = container.nodeIds.map((id) => project.nodes.find((node) => node.id === id)).filter((node): node is NodeInstance => Boolean(node));
  const rect = previewRect ?? { x: container.position.x + offset.x, y: container.position.y + offset.y, width: container.size.width, height: container.size.height };
  const visibleDropIndex = dropIndex ?? externalDropIndex;
  return <article className={`on-container ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${dropTarget ? "is-drop-target" : ""} ${container.bypassed ? "is-bypassed" : ""}`} data-container-id={container.id} style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: container.collapsed ? 88 : rect.height, "--element-color": container.color ?? "#ffffff" } as CSSProperties} onPointerDown={(event) => { onSelect(event, container); if (!(event.target as HTMLElement).closest("input,select,textarea,button,.on-port,.on-container-port,.on-resize-handle,.on-contained-node")) onPointerDown(event, container); }} onClick={(event) => onActivate(event, container)} onContextMenu={(event) => onContextMenu(event, container)}>
    <header onPointerDown={(event) => onPointerDown(event, container)}><span>▤</span><InlineName value={container.name} fallback="Container" readOnly={readOnly} onCommit={(value) => onRename(container.id, value)} /><small>{nodes.length} Nodes</small><span className={`on-node-state is-${state?.status ?? "idle"}`}>{state?.status ?? "idle"}</span></header>
    <span className="on-container-port is-input" style={{ top: containerPortY(container, "input") }} title={`${container.inputPort.label}: ${container.inputPort.typeId}`} onPointerUp={(event) => { event.stopPropagation(); onFinishConnection(container.id, container.inputPort.id); }} />
    <span className="on-container-port is-output" style={{ top: containerPortY(container, "output") }} title={`${container.outputPort.label}: ${container.outputPort.typeId}`} onPointerDown={(event) => { event.stopPropagation(); onStartConnection(container.id, container.outputPort.id, container.outputPort.kind, { x: rect.x + rect.width, y: rect.y + containerPortY(container, "output") }); }} />
    {!container.collapsed && <div className="on-container-list" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(undefined); }}>
      {nodes.map((node, index) => <div className="on-container-node-slot" key={node.id} onDragOver={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1); }} onDrop={(event) => { const nodeId = event.dataTransfer.getData("application/x-open-container-node"); setDropIndex(undefined); if (nodeId) { event.preventDefault(); event.stopPropagation(); onReorder(container.id, nodeId, dropIndex ?? index); } }}>
        {visibleDropIndex === index && <span className="on-container-drop-line" />}
        <ContainedNodePreview node={node} definition={definitions.get(node.nodeTypeId, node.nodeTypeVersion)} status={session?.elementStates.get(node.id)?.status ?? `${index + 1}`} readOnly={readOnly} onSelect={() => onSelectNode(node.id)} onContextMenu={(event) => onContextMenu(event, node)} onParameterCommit={onParameterCommit} onFileDrop={(file) => onFileDrop(node.id, file)} onDragStart={(event) => { event.stopPropagation(); const dragId = event.altKey ? onDuplicateNodeForDrag(node.id) ?? node.id : node.id; event.dataTransfer.setData("application/x-open-container-node", dragId); event.dataTransfer.effectAllowed = event.altKey ? "copyMove" : "move"; onNodeDragState(dragId); }} onDragEnd={() => { onNodeDragState(undefined); setDropIndex(undefined); }} />
      </div>)}
      {visibleDropIndex === nodes.length && <span className="on-container-drop-line" />}
      <div className="on-container-drop" onDragOver={(event) => { event.preventDefault(); setDropIndex(nodes.length); }} onDrop={(event) => { const nodeId = event.dataTransfer.getData("application/x-open-container-node"); setDropIndex(undefined); if (nodeId) { event.preventDefault(); event.stopPropagation(); onReorder(container.id, nodeId, nodes.length); } }}>Drop compatible Node here</div>
    </div>}
    {dropTarget && <div className="on-container-drop-preview" />}
    {!readOnly && <ResizeHandles element={container} onResize={onResize} />}
  </article>;
}

function ContainedNodePreview({ node, definition, status, readOnly, onSelect, onContextMenu, onParameterCommit, onFileDrop, onDragStart, onDragEnd }: {
  node: NodeInstance; definition?: NodeDefinition; status: string; readOnly: boolean; onSelect(): void; onParameterCommit(nodeId: string, parameterId: string, value: unknown): void;
  onContextMenu(event: ReactMouseEvent): void; onFileDrop(file: File): void; onDragStart(event: DragEvent<HTMLDivElement>): void; onDragEnd(): void;
}) {
  const inputs = node.ports.filter((port) => port.direction === "input");
  const outputs = node.ports.filter((port) => port.direction === "output");
  return <div className={`on-contained-node ${isTextCanvasNode(node) ? "is-text-node" : ""} ${node.bypassed ? "is-bypassed" : ""}`} style={{ "--element-color": node.color ?? definition?.defaultColor ?? "#667085" } as CSSProperties} data-node-id={node.id} data-node-type-id={node.nodeTypeId} draggable={!readOnly} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => { if (node.nodeTypeId === "open-node.import.universal" && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { const file = event.dataTransfer.files[0]; if (node.nodeTypeId === "open-node.import.universal" && file) { event.preventDefault(); event.stopPropagation(); onFileDrop(file); } }} onClick={(event) => { event.stopPropagation(); onSelect(); }} onContextMenu={onContextMenu}>
    <div className="on-contained-node-header"><span className="on-grip">⋮⋮</span><span className="on-mini-icon" style={{ background: node.color ?? definition?.defaultColor }}>{node.label.slice(0, 1)}</span><strong>{node.label}</strong><small>{status}</small></div>
    <div className="on-contained-node-body"><span className="is-inputs">{inputs.slice(0, 2).map((port) => <i key={port.id}>{port.label}</i>)}</span><span className="is-summary on-contained-node-parameters" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}><ParameterSummary node={node} definition={definition} readOnly={readOnly} onCommit={onParameterCommit} /></span><span className="is-outputs">{outputs.slice(0, 2).map((port) => <i key={port.id}>{port.label}</i>)}</span></div>
  </div>;
}

function AnnotationView({ annotation, selected, offset, previewRect, previewRotation, readOnly = false, preview = false, onPointerDown, onSelect, onActivate, onContextMenu, onResize, onRotate, onPoint, onTextCommit }: {
  annotation: CanvasAnnotation; selected: boolean; offset: Point; previewRect?: Rect; previewRotation?: number; readOnly?: boolean; preview?: boolean;
  onPointerDown?(event: ReactPointerEvent, element: CanvasAnnotation): void; onSelect?(event: ReactPointerEvent, element: CanvasAnnotation): void;
  onActivate?(event: ReactMouseEvent, element: CanvasAnnotation): void; onContextMenu?(event: ReactMouseEvent, element: CanvasAnnotation): void;
  onResize?(event: ReactPointerEvent, element: CanvasAnnotation, handle: ResizeHandle): void; onRotate?(event: ReactPointerEvent, element: CanvasAnnotation): void;
  onPoint?(event: ReactPointerEvent, element: CanvasAnnotation, pointIndex: number): void; onTextCommit?(annotationId: string, text: string): void;
}) {
  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState(annotation.text ?? "");
  useEffect(() => setTextDraft(annotation.text ?? ""), [annotation.id, annotation.text]);
  const rect = previewRect ?? { x: annotation.position.x + offset.x, y: annotation.position.y + offset.y, width: annotation.size.width, height: annotation.size.height };
  const rotation = previewRotation ?? annotation.rotation;
  const markerId = `on-annotation-arrow-${annotation.id}`;
  const points = annotation.points?.map((point) => `${point.x},${point.y}`).join(" ") ?? "";
  const finishText = () => {
    setEditingText(false);
    if (textDraft !== (annotation.text ?? "")) onTextCommit?.(annotation.id, textDraft);
  };
  const isGeometricShape = annotation.annotationType === "rectangle" || annotation.annotationType === "ellipse" || annotation.annotationType === "diamond";
  return <div className={`on-annotation is-${annotation.annotationType} ${selected ? "is-selected" : ""} ${offset.x || offset.y ? "is-dragging" : ""} ${preview ? "is-preview" : ""}`} data-annotation-id={annotation.id} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, transform: `rotate(${rotation}deg)`, "--annotation-color": annotation.color, "--annotation-fill": solidHexColor(annotation.fillColor ?? annotation.color), "--annotation-stroke": annotation.strokeWidth } as CSSProperties} onPointerDown={(event) => { if (!preview && !(event.target as HTMLElement).closest("textarea,input,button,.on-resize-handle,.on-annotation-rotate,.on-annotation-point")) { onSelect?.(event, annotation); onPointerDown?.(event, annotation); } }} onClick={(event) => { if (!preview) onActivate?.(event, annotation); }} onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => { if (!preview) onContextMenu?.(event, annotation); }}>
    {annotation.annotationType === "text" ? editingText && !readOnly
      ? <textarea className="on-annotation-text-input" autoFocus value={textDraft} style={{ fontSize: annotation.fontSize, opacity: annotation.opacity }} onChange={(event) => setTextDraft(event.target.value)} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onBlur={finishText} onKeyDown={(event) => { if (event.key === "Escape") { setTextDraft(annotation.text ?? ""); setEditingText(false); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur(); }} />
      : <div className="on-annotation-text" style={{ fontSize: annotation.fontSize, opacity: annotation.opacity }} onDoubleClick={(event) => { if (!readOnly) { event.stopPropagation(); setEditingText(true); } }}>{annotation.text || "Text"}</div>
      : <svg style={isGeometricShape ? undefined : { opacity: annotation.opacity }} viewBox={`0 0 ${Math.max(1, annotation.size.width)} ${Math.max(1, annotation.size.height)}`} preserveAspectRatio="none">
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={annotation.color} /></marker></defs>
      {annotation.annotationType === "rectangle" && <rect x="4" y="4" width={Math.max(1, annotation.size.width - 8)} height={Math.max(1, annotation.size.height - 8)} rx="2" fillOpacity={annotation.opacity} />}
      {annotation.annotationType === "ellipse" && <ellipse cx={annotation.size.width / 2} cy={annotation.size.height / 2} rx={Math.max(1, annotation.size.width / 2 - 4)} ry={Math.max(1, annotation.size.height / 2 - 4)} fillOpacity={annotation.opacity} />}
      {annotation.annotationType === "diamond" && <polygon points={`${annotation.size.width / 2},4 ${annotation.size.width - 4},${annotation.size.height / 2} ${annotation.size.width / 2},${annotation.size.height - 4} 4,${annotation.size.height / 2}`} fillOpacity={annotation.opacity} />}
      {annotation.annotationType === "arrow" && <><polyline className="on-annotation-hit" points={points} /><polyline className="on-annotation-stroke" points={points} markerEnd={`url(#${markerId})`} /></>}
      {annotation.annotationType === "brush" && <><polyline className="on-annotation-hit" points={points} /><polyline className="on-annotation-stroke" points={points} /></>}
    </svg>}
    {selected && !readOnly && !preview && annotation.annotationType === "arrow" && annotation.points?.map((point, index) => <span key={index} className="on-annotation-point" style={{ left: point.x, top: point.y }} onPointerDown={(event) => onPoint?.(event, annotation, index)} title={`Move ${index === 0 ? "start" : "end"} point`} />)}
    {selected && !readOnly && !preview && (["rectangle", "ellipse", "diamond", "text"] as AnnotationType[]).includes(annotation.annotationType) && <><ResizeHandles element={annotation} onResize={(event, element, handle) => onResize?.(event, element as CanvasAnnotation, handle)} /><span className="on-annotation-rotate" onPointerDown={(event) => onRotate?.(event, annotation)} title="Drag to rotate" /></>}
  </div>;
}

function GroupView({ group, selected, dragging, offset, previewRect, readOnly, onPointerDown, onSelect, onActivate, onContextMenu, onResize, onRename }: {
  group: GroupInstance; selected: boolean; dragging: boolean; offset: Point; previewRect?: Rect; readOnly: boolean; onPointerDown(event: ReactPointerEvent, element: GraphElement): void;
  onSelect(event: ReactPointerEvent, element: GraphElement): void; onActivate(event: ReactMouseEvent, element: GraphElement): void; onContextMenu(event: ReactMouseEvent, element: GraphElement): void; onResize(event: ReactPointerEvent, element: GraphElement, handle: ResizeHandle): void; onRename(elementId: string, value: string): void;
}) {
  const rect = previewRect ?? { x: group.position.x + offset.x, y: group.position.y + offset.y, width: group.size.width, height: group.size.height };
  return <section className={`on-group ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${group.collapsed ? "is-collapsed" : ""} ${group.bypassed ? "is-bypassed" : ""}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: group.collapsed ? 42 : rect.height, borderStyle: group.borderStyle, "--group-color": group.color ?? "#4b84ff", "--group-opacity": group.opacity } as CSSProperties} data-group-id={group.id} onPointerDown={(event) => { onSelect(event, group); if (!(event.target as HTMLElement).closest("input,button,.on-resize-handle")) onPointerDown(event, group); }} onClick={(event) => onActivate(event, group)} onContextMenu={(event) => onContextMenu(event, group)}>
    <header onPointerDown={(event) => onPointerDown(event, group)}><span>◇</span><InlineName value={group.name ?? ""} fallback="Group" readOnly={readOnly} onCommit={(value) => onRename(group.id, value)} /><small>{group.memberNodeIds.length + group.memberContainerIds.length} items</small></header>
    {!readOnly && <ResizeHandles element={group} onResize={onResize} />}
  </section>;
}

function InlineName({ value, fallback, readOnly, onCommit }: { value: string; fallback: string; readOnly: boolean; onCommit(value: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing || readOnly) return <strong className="on-inline-name" onClick={(event) => { if (!readOnly) { event.stopPropagation(); setEditing(true); } }} title={readOnly ? undefined : "Click to rename"}>{value || fallback}</strong>;
  const finish = () => { setEditing(false); onCommit(draft.trim() || fallback); };
  return <input className="on-inline-name-input" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onPointerDown={(event) => event.stopPropagation()} onBlur={finish} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(value); setEditing(false); } }} />;
}

function ProjectNameInput({ value, onCommit }: { value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="on-project-name" aria-label="Project name" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => onCommit(draft.trim() || "Untitled")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function ResizeHandles<T extends CanvasSelectable>({ element, onResize }: { element: T; onResize(event: ReactPointerEvent, element: T, handle: ResizeHandle): void }) {
  return <>{(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => <span key={handle} className={`on-resize-handle is-${handle}`} onPointerDown={(event) => onResize(event, element, handle)} />)}</>;
}

function Port({ port, elementId, top, side, onPointerDown, onPointerUp }: { port: PortInstance; elementId: string; top: number; side: "left" | "right"; onPointerDown(event: ReactPointerEvent): void; onPointerUp(): void }) {
  return <div className={`on-port is-${side}`} style={{ top }} data-element-id={elementId} data-port-id={port.id} onPointerDown={onPointerDown} onPointerUp={(event) => { event.stopPropagation(); onPointerUp(); }} title={`${port.label}: ${port.typeId}`}>
    <span className="on-port-dot" /><span className="on-port-label">{port.label}</span>
  </div>;
}

function ConnectionLayer({ project, elements, selection, dragIds, dragOffset, resizePreview, pending, error, onSelect, onContextMenu, onDetach }: {
  project: OpenNodeProject; elements: GraphElement[]; selection: Set<string>; dragIds: Set<string>; dragOffset: Point; resizePreview?: ResizePreview; pending?: PendingConnection; error: string;
  onSelect(connectionId: string): void; onContextMenu(event: ReactMouseEvent<SVGPathElement>, connectionId: string): void; onDetach(connectionId: string): void;
}) {
  const detachRef = useRef<{ id: string; start: Point } | undefined>(undefined);
  const paths = project.connections.map((connection) => {
    const source = connectionPoint(project, connection, "source", elements, dragIds, dragOffset, resizePreview);
    const target = connectionPoint(project, connection, "target", elements, dragIds, dragOffset, resizePreview);
    if (!source || !target) return null;
    const d = routePath(source, target, connection.routing);
    const sourceElement = elements.find((element) => element.id === connection.source.elementId);
    const targetElement = elements.find((element) => element.id === connection.target.elementId);
    const sourceColor = graphElementColor(sourceElement);
    const targetColor = graphElementColor(targetElement);
    const gradientId = `on-connection-gradient-${connection.id}`;
    const markerStartId = `on-connection-start-${connection.id}`;
    const markerEndId = `on-connection-end-${connection.id}`;
    return <g key={connection.id} className={selection.has(connection.id) ? "is-selected" : ""}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={source.x} y1={source.y} x2={target.x} y2={target.y}><stop offset="0%" stopColor={sourceColor} /><stop offset="100%" stopColor={targetColor} /></linearGradient>
        <marker id={markerStartId} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={sourceColor} /></marker>
        <marker id={markerEndId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={targetColor} /></marker>
      </defs>
      <path className={`on-connection is-${connection.kind}`} d={d} style={{ stroke: `url(#${gradientId})`, strokeWidth: connection.thickness, opacity: connection.opacity, strokeDasharray: connection.dash?.join(" ") }} markerStart={connection.arrowhead === "both" ? `url(#${markerStartId})` : undefined} markerEnd={connection.arrowhead === "end" || connection.arrowhead === "both" ? `url(#${markerEndId})` : undefined} />
      <path className="on-connection-hit" d={d} onPointerDown={(event) => { if (event.button === 0) { event.stopPropagation(); onSelect(connection.id); } }} onContextMenu={(event) => onContextMenu(event, connection.id)} />
      {selection.has(connection.id) && [source, target].map((point, index) => <circle key={index} className="on-connection-endpoint" cx={point.x} cy={point.y} r="6" onPointerDown={(event) => { event.stopPropagation(); capturePointer(event.currentTarget, event.pointerId); detachRef.current = { id: connection.id, start: { x: event.clientX, y: event.clientY } }; }} onPointerUp={(event) => { const candidate = detachRef.current; detachRef.current = undefined; if (candidate?.id === connection.id && Math.hypot(event.clientX - candidate.start.x, event.clientY - candidate.start.y) > 4) onDetach(connection.id); }} />)}
    </g>;
  });
  return <svg className="on-connections" width="1" height="1" overflow="visible">{paths}{pending && <path className={`on-connection is-pending ${error ? "is-error" : ""}`} d={routePath(portWorldPoint(project, pending.sourceElementId, pending.sourcePortId) ?? pending.point, pending.point, "bezier")} />}</svg>;
}

function Inspector({ open, element, project, definitions, assets, readOnly, execute, onClose }: { open: boolean; element?: CanvasSelectable; project: OpenNodeProject; definitions: NodeRegistry; assets?: AssetRegistry; readOnly: boolean; execute(label: string, mutate: (draft: OpenNodeProject) => void): void; onClose(): void }) {
  const className = `on-panel on-inspector ${open ? "is-open" : "is-closed"}`;
  if (!element) return <aside className={className} aria-hidden={!open}><div className="on-panel-header"><strong>Inspector</strong><button onClick={onClose}>×</button></div><div className="on-empty">Select an element to inspect its properties.</div></aside>;
  const definition = element.kind === "node" ? definitions.get(element.nodeTypeId, element.nodeTypeVersion) : undefined;
  const update = (mutate: (target: CanvasSelectable, draft: OpenNodeProject) => void, label = "Update element") => execute(label, (draft) => { const target = getCanvasElement(draft, element.id); if (!target) throw new Error("Element no longer exists"); mutate(target, draft); reconcileGroupMembership(draft); });
  const name = element.kind === "node" ? element.label : element.kind === "container" ? element.name : element.kind === "group" ? element.name ?? "" : element.annotationType === "text" ? element.text ?? "Text" : titleCase(element.annotationType);
  return <aside className={className} aria-hidden={!open}>
    <div className="on-panel-header"><strong>Inspector</strong><button onClick={onClose}>×</button></div>
    <div className="on-inspector-title"><span className="on-library-icon" style={{ background: element.color }}>{element.kind.slice(0, 2).toUpperCase()}</span><div><strong>{name || "Untitled Group"}</strong><small>{element.kind === "node" ? element.nodeTypeId : element.kind}</small></div></div>
    <InspectorSection title="Properties">
      {(element.kind !== "annotation" || element.annotationType === "text") && <Field label={element.kind === "node" ? "Label" : element.kind === "annotation" ? "Content" : "Name"}>{element.kind === "annotation"
        ? <textarea key={`${element.id}-content`} disabled={readOnly} defaultValue={name} onBlur={(event) => update((target) => { if (target.kind === "annotation" && target.annotationType === "text") target.text = event.target.value; }, "Edit text content")} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur(); }} />
        : <input key={`${element.id}-name`} disabled={readOnly} defaultValue={name} onBlur={(event) => update((target) => { if (target.kind === "node") target.label = event.target.value; else if (target.kind !== "annotation") target.name = event.target.value || undefined; }, "Rename element")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}</Field>}
      <Field label="Color"><span className="on-color-control"><input type="color" disabled={readOnly} value={canvasElementColor(element, definitions)} onChange={(event) => update((target) => { target.color = event.target.value; }, "Change color")} /><button type="button" disabled={readOnly} onClick={() => update((target) => { if (target.kind === "node") delete target.color; else target.color = target.kind === "container" ? "#ffffff" : target.kind === "group" ? "#4b84ff" : "#ffffff"; }, "Reset color")}>Reset</button></span></Field>
      {element.kind !== "annotation" && <Field label="Bypass"><input type="checkbox" disabled={readOnly} checked={element.bypassed} onChange={(event) => update((target, draft) => { if (target.kind === "annotation") return; if (target.kind === "group") setGroupBypass(draft, target.id, event.target.checked); else target.bypassed = event.target.checked; }, "Toggle bypass")} /></Field>}
      {"collapsed" in element && <Field label="Collapsed"><input type="checkbox" disabled={readOnly} checked={element.collapsed} onChange={(event) => update((target) => { if ("collapsed" in target) target.collapsed = event.target.checked; }, "Toggle collapse")} /></Field>}
    </InspectorSection>
    {element.kind === "annotation" && <InspectorSection title="Drawing">{["rectangle", "ellipse", "diamond", "text"].includes(element.annotationType) && <Field label="Angle"><input type="number" disabled={readOnly} value={Math.round(element.rotation)} onChange={(event) => update((target) => { if (target.kind === "annotation") target.rotation = Number(event.target.value); }, "Rotate annotation")} /></Field>}{["rectangle", "ellipse", "diamond", "brush"].includes(element.annotationType) && <Field label="Stroke"><input type="number" min="1" max="32" disabled={readOnly} value={element.strokeWidth} onChange={(event) => update((target) => { if (target.kind === "annotation") target.strokeWidth = clamp(Number(event.target.value), 1, 32); }, "Stroke width")} /></Field>}{["rectangle", "ellipse", "diamond"].includes(element.annotationType) && <><Field label="Fill"><input type="color" disabled={readOnly} value={solidHexColor(element.fillColor ?? "#111318")} onChange={(event) => update((target) => { if (target.kind === "annotation") target.fillColor = event.target.value; }, "Fill color")} /></Field><Field label="Fill opacity"><span className="on-opacity-control"><input type="range" min="0" max="100" disabled={readOnly} value={Math.round(element.opacity * 100)} onChange={(event) => update((target) => { if (target.kind === "annotation") target.opacity = clamp(Number(event.target.value) / 100, 0, 1); }, "Change fill opacity")} /><output>{Math.round(element.opacity * 100)}%</output></span></Field></>}{element.annotationType === "text" && <Field label="Size"><input type="number" min="8" max="160" disabled={readOnly} value={element.fontSize ?? 24} onChange={(event) => update((target) => { if (target.kind === "annotation") target.fontSize = clamp(Number(event.target.value), 8, 160); }, "Text size")} /></Field>}</InspectorSection>}
    {element.kind === "node" && definition && <InspectorSection title="Parameters">{definition.parameters.map((parameter) => <ParameterEditor key={parameter.id} parameter={parameter} value={element.parameters[parameter.id]} disabled={readOnly} onCommit={async (value) => {
      if (parameter.control === "file" && value instanceof File && assets) {
        const imported = await assets.import(value as ImportableFile);
        if (imported.preview) imported.reference.metadata["previewUrl"] = imported.preview.value;
        execute("Import Asset", (draft) => {
          if (!draft.assets.some((asset) => asset.id === imported.reference.id)) draft.assets.push(imported.reference);
          const node = draft.nodes.find((candidate) => candidate.id === element.id);
          if (!node) return;
          node.parameters[parameter.id] = imported.reference.id;
          if (node.nodeTypeId === "open-node.import.universal") {
            const outputPort = node.ports.find((port) => port.direction === "output");
            if (outputPort) { outputPort.id = "result"; outputPort.label = "Result"; outputPort.typeId = assetOutputType(imported.reference); outputPort.dynamic = true; }
            node.ports = node.ports.filter((port) => port.direction !== "output" || port === outputPort);
          }
        });
      } else update((target) => { if (target.kind === "node") target.parameters[parameter.id] = value; }, `Set ${parameter.label}`);
    }} />)}</InspectorSection>}
    {element.kind === "node" && <InspectorSection title="Ports"><div className="on-port-list">{element.ports.map((port) => <div key={port.id}><span className={`on-tiny-dot is-${port.direction}`} /><strong>{port.label}</strong><small>{port.typeId}</small></div>)}</div></InspectorSection>}
    {element.kind === "container" && <InspectorSection title="Order"><div className="on-order-list">{element.nodeIds.map((nodeId, index) => <div key={nodeId}><span>{project.nodes.find((node) => node.id === nodeId)?.label ?? nodeId}</span><button disabled={readOnly || index === 0} onClick={() => update((target) => { if (target.kind === "container") { target.nodeIds.splice(index, 1); target.nodeIds.splice(index - 1, 0, nodeId); } }, "Reorder Container")}>↑</button><button disabled={readOnly || index === element.nodeIds.length - 1} onClick={() => update((target) => { if (target.kind === "container") { target.nodeIds.splice(index, 1); target.nodeIds.splice(index + 1, 0, nodeId); } }, "Reorder Container")}>↓</button><button disabled={readOnly} onClick={() => update((target, draft) => { if (target.kind === "container") target.nodeIds = target.nodeIds.filter((id) => id !== nodeId); const node = draft.nodes.find((item) => item.id === nodeId); if (node) node.parentContainerId = null; }, "Detach Node")}>↗</button></div>)}</div><button className="on-secondary-wide" disabled={readOnly} onClick={() => execute("Save Container preset", (draft) => { const current = draft.containers.find((item) => item.id === element.id); if (!current) return; draft.presets.push({ id: createId("preset"), kind: "container", name: current.name, color: current.color, errorPolicy: current.errorPolicy, nodes: current.nodeIds.map((id) => draft.nodes.find((node) => node.id === id)).filter((node): node is NodeInstance => Boolean(node)).map((node) => ({ nodeTypeId: node.nodeTypeId, nodeTypeVersion: node.nodeTypeVersion, label: node.label, color: node.color, parameters: structuredClone(node.parameters), bypassed: node.bypassed })) }); })}>Save as preset</button></InspectorSection>}
    <InspectorSection title="Transform"><div className="on-two-cols"><Field label="X"><input type="number" disabled={readOnly} defaultValue={Math.round(element.position.x)} onBlur={(event) => update((target, draft) => { const value = Number(event.target.value); target.position.x = target.kind !== "annotation" && draft.settings.grid.snapping ? snapValue(value, draft.settings.grid.step) : value; }, "Move element")} /></Field><Field label="Y"><input type="number" disabled={readOnly} defaultValue={Math.round(element.position.y)} onBlur={(event) => update((target, draft) => { const value = Number(event.target.value); target.position.y = target.kind !== "annotation" && draft.settings.grid.snapping ? snapValue(value, draft.settings.grid.step) : value; }, "Move element")} /></Field><Field label="W"><input type="number" min="20" disabled={readOnly} defaultValue={Math.round(element.size.width)} onBlur={(event) => update((target, draft) => { const value = Math.max(20, Number(event.target.value)); target.size.width = target.kind !== "annotation" && draft.settings.grid.snapping ? Math.max(draft.settings.grid.step, snapValue(value, draft.settings.grid.step)) : value; }, "Resize element")} /></Field><Field label="H"><input type="number" min="20" disabled={readOnly} defaultValue={Math.round(element.size.height)} onBlur={(event) => update((target, draft) => { const value = Math.max(20, Number(event.target.value)); target.size.height = target.kind !== "annotation" && draft.settings.grid.snapping ? Math.max(draft.settings.grid.step, snapValue(value, draft.settings.grid.step)) : value; }, "Resize element")} /></Field></div></InspectorSection>
    {element.kind === "node" && <InspectorSection title="Runtime"><dl className="on-details"><dt>Version</dt><dd>{element.nodeTypeVersion}</dd><dt>Pure</dt><dd>{definition?.pure ? "Yes" : "No"}</dd><dt>Backend</dt><dd>{element.runtimeHints.preferredBackend ?? definition?.resources?.preferredBackend ?? "Auto"}</dd></dl></InspectorSection>}
  </aside>;
}

function ParameterEditor({ parameter, value, disabled, onCommit }: { parameter: ParameterDefinition; value: unknown; disabled: boolean; onCommit(value: unknown): void | Promise<void> }) {
  if (parameter.control === "toggle") return <Field label={parameter.label}><input type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(event) => void onCommit(event.target.checked)} /></Field>;
  if (parameter.control === "color") return <Field label={parameter.label}><input type="color" disabled={disabled} value={String(value ?? "#000000")} onChange={(event) => void onCommit(event.target.value)} /></Field>;
  if (parameter.control === "select") return <Field label={parameter.label}><select disabled={disabled} value={String(value)} onChange={(event) => void onCommit(event.target.value)}>{parameter.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select></Field>;
  if (parameter.control === "file") return <Field label={parameter.label}><input type="file" disabled={disabled} accept={parameter.accept?.join(",")} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onCommit(file); }} /></Field>;
  if (parameter.control === "table") return <Field label={parameter.label}><textarea disabled={disabled} defaultValue={formatOutputs(value)} onBlur={(event) => { try { void onCommit(JSON.parse(event.target.value)); } catch { /* Leave invalid draft untouched. */ } }} /></Field>;
  return <Field label={parameter.label}><input type={parameter.control === "number" ? "number" : "text"} disabled={disabled} min={parameter.min} max={parameter.max} step={parameter.step} defaultValue={typeof value === "object" ? JSON.stringify(value) : String(value ?? "")} onBlur={(event) => void onCommit(parameter.control === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) { return <section className="on-inspector-section"><h3>{title}</h3>{children}</section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="on-field"><span>{label}</span>{children}</label>; }

function TimelineBar({ controller, settings, onChange, onHide }: { controller: TimelineRuntime; settings: OpenNodeProject["timeline"]; onChange(patch: Partial<OpenNodeProject["timeline"]>): void; onHide(): void }) {
  const context = controller.context;
  return <div className="on-timeline">
    <button className="on-timeline-hide" onClick={onHide} title="Hide Timeline">▾</button>
    <button onClick={() => controller.step(-1)} title="Back 1 frame">‹1F</button>
    <button onClick={() => controller.step(1)} title="Forward 1 frame">1F›</button>
    <button className="on-timeline-play" onClick={() => controller.state === "playing" ? controller.pause() : controller.play()}>{controller.state === "playing" ? "Ⅱ" : "▶"}</button>
    <button onClick={() => controller.stop()}>■</button>
    <span className="on-timecode">{formatTime(context.timeSeconds)}</span>
    <strong className="on-framecode">F {context.frame}</strong>
    <input className="on-scrubber" type="range" min={settings.startTime} max={settings.endTime} step={1 / settings.fps} value={context.timeSeconds} onChange={(event) => { const time = Number(event.target.value); controller.setTime(time); onChange({ currentTime: time }); }} />
    <label>FPS <input type="number" min="1" max="240" value={settings.fps} onChange={(event) => { const fps = Number(event.target.value); controller.configure({ fps }); onChange({ fps }); }} /></label>
    <label><input type="checkbox" checked={settings.loop} onChange={(event) => { controller.configure({ loop: event.target.checked }); onChange({ loop: event.target.checked }); }} /> Loop</label>
    <select value={settings.playbackRate} onChange={(event) => { const playbackRate = Number(event.target.value); controller.configure({ playbackRate }); onChange({ playbackRate }); }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select>
  </div>;
}

function Minimap({ project, viewport, canvasSize, onNavigate, onClose }: { project: OpenNodeProject; viewport: ViewportState; canvasSize: { width: number; height: number }; onNavigate(point: Point): void; onClose(): void }) {
  const viewportWorld: Rect = { x: viewport.x - canvasSize.width / 2 / viewport.zoom, y: viewport.y - canvasSize.height / 2 / viewport.zoom, width: canvasSize.width / viewport.zoom, height: canvasSize.height / viewport.zoom };
  const bounds = unionRects(getBounds(project), viewportWorld) ?? { x: -500, y: -300, width: 1000, height: 600 };
  const padding = Math.max(50, Math.max(bounds.width, bounds.height) * 0.06);
  const full = { x: bounds.x - padding, y: bounds.y - padding, width: Math.max(bounds.width + padding * 2, 1), height: Math.max(bounds.height + padding * 2, 1) };
  const scale = Math.min(180 / full.width, 110 / full.height);
  const mapOffset = { x: (180 - full.width * scale) / 2, y: (110 - full.height * scale) / 2 };
  const map = (point: Point) => ({ x: mapOffset.x + (point.x - full.x) * scale, y: mapOffset.y + (point.y - full.y) * scale });
  const viewportTopLeft = map({ x: viewport.x - canvasSize.width / 2 / viewport.zoom, y: viewport.y - canvasSize.height / 2 / viewport.zoom });
  const viewportSize = { width: viewportWorld.width * scale, height: viewportWorld.height * scale };
  const navigate = (event: ReactPointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); const mapX = (event.clientX - rect.left) / rect.width * 180; const mapY = (event.clientY - rect.top) / rect.height * 110; onNavigate({ x: full.x + (mapX - mapOffset.x) / scale, y: full.y + (mapY - mapOffset.y) / scale }); };
  return <div className="on-minimap on-canvas-ui"><div className="on-overlay-title"><span>Minimap</span><button onClick={onClose}>×</button></div><svg viewBox="0 0 180 110" onPointerDown={(event) => { capturePointer(event.currentTarget, event.pointerId); navigate(event); }} onPointerMove={(event) => { if (event.buttons === 1) navigate(event); }}>{[...project.groups, ...project.containers, ...project.nodes.filter((node) => !node.parentContainerId)].map((element) => { const point = map(element.position); return <rect key={element.id} className={`is-${element.kind}`} x={point.x} y={point.y} width={Math.max(2, element.size.width * scale)} height={Math.max(2, element.size.height * scale)} />; })}<rect className="is-viewport" x={viewportTopLeft.x} y={viewportTopLeft.y} width={viewportSize.width} height={viewportSize.height} /></svg></div>;
}

function ResourceDashboard({ metrics, onClose }: { metrics: ResourceMetrics; onClose(): void }) {
  const capabilities = browserCapabilities();
  return <div className="on-dashboard on-canvas-ui"><div className="on-overlay-title"><span>Resources · live</span><button onClick={onClose}>×</button></div><div className="on-metrics"><Metric label="JS RAM" value={metrics.ram.percent} used={metrics.ram.usedBytes} total={metrics.ram.totalBytes} fallback={capabilities.memory} /><Metric label={`UI thread · ${capabilities.cores}`} value={metrics.cpu.percent} /><Metric label="GPU" value={metrics.gpu.percent} used={metrics.gpu.memoryUsedBytes} total={metrics.gpu.memoryTotalBytes} fallback={capabilities.gpu} /><Metric label="Browser storage" value={metrics.disk.percent} used={metrics.disk.usedBytes} total={metrics.disk.totalBytes} fallback="Storage API restricted" /></div><small className="on-metric-source">Live browser process/storage data and detected hardware capabilities.</small></div>;
}

function Metric({ label, value, used, total, fallback }: { label: string; value: number | null; used?: number | null; total?: number | null; fallback?: string }) { return <div><span>{label}</span><strong>{value == null ? fallback ?? "Restricted" : formatMetric(value)}</strong>{used != null && total != null && <small>{formatMetric(used, "bytes")} / {formatMetric(total, "bytes")}</small>}<i><b style={{ width: `${value ?? 0}%` }} /></i></div>; }

function AssetPreview({ asset, timelineTime }: { asset: OpenNodeProject["assets"][number]; timelineTime: number }) {
  const url = String(asset.metadata["previewUrl"] ?? asset.uri ?? "");
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const target = clamp(timelineTime, 0, Math.max(0, video.duration - 0.001));
    if (Math.abs(video.currentTime - target) > 1 / 60) video.currentTime = target;
  }, [timelineTime]);
  if (asset.missing) return <div className="on-asset-preview is-missing">Missing Asset<br /><small>{asset.name}</small></div>;
  if (asset.mediaType === "image" && url) return <div className="on-asset-preview"><img src={url} alt={asset.name} /></div>;
  if (asset.mediaType === "video" && url) return <div className="on-asset-preview"><video ref={videoRef} src={url} muted preload="metadata" /></div>;
  if (asset.mediaType === "audio") return <div className="on-asset-preview is-audio">▥ {asset.name}</div>;
  return <div className="on-asset-preview is-file">{asset.name}<small>{asset.mimeType}</small></div>;
}

function ParameterSummary({ node, definition, readOnly, onCommit }: { node: NodeInstance; definition?: NodeDefinition; readOnly: boolean; onCommit(nodeId: string, parameterId: string, value: unknown): void }) {
  const parameters = (definition?.parameters ?? []).filter((parameter) => parameter.control !== "file" && parameter.control !== "button" && parameter.control !== "preview").slice(0, 2);
  if (!parameters.length) return <span className="on-muted">{definition?.description ?? "No parameters"}</span>;
  if (isTextCanvasNode(node)) {
    const parameter = parameters[0]!;
    return <textarea className="on-notebook-input" disabled={readOnly} defaultValue={String(node.parameters[parameter.id] ?? "")} placeholder="Write text…" onPointerDown={(event) => event.stopPropagation()} onBlur={(event) => onCommit(node.id, parameter.id, event.target.value)} />;
  }
  return <>{parameters.map((parameter) => <InlineParameter key={parameter.id} parameter={parameter} value={node.parameters[parameter.id]} readOnly={readOnly} onCommit={(value) => onCommit(node.id, parameter.id, value)} />)}</>;
}

function InlineParameter({ parameter, value, readOnly, onCommit }: { parameter: ParameterDefinition; value: unknown; readOnly: boolean; onCommit(value: unknown): void }) {
  const stop = (event: ReactPointerEvent) => event.stopPropagation();
  if (parameter.control === "color") return <label className="on-param-summary"><span>{parameter.label}</span><input type="color" disabled={readOnly} value={String(value ?? "#000000")} onPointerDown={stop} onChange={(event) => onCommit(event.target.value)} /></label>;
  if (parameter.control === "select") return <label className="on-param-summary"><span>{parameter.label}</span><select disabled={readOnly} value={String(value ?? "")} onPointerDown={stop} onChange={(event) => onCommit(event.target.value)}>{parameter.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select></label>;
  if (parameter.control === "toggle") return <label className="on-param-summary"><span>{parameter.label}</span><input type="checkbox" disabled={readOnly} checked={Boolean(value)} onPointerDown={stop} onChange={(event) => onCommit(event.target.checked)} /></label>;
  if (parameter.control === "table") return <div className="on-param-summary"><span>{parameter.label}</span><strong>{Array.isArray(value) ? `${value.length} items` : "Object"}</strong></div>;
  return <label className="on-param-summary"><span>{parameter.label}</span><input type={parameter.control === "number" ? "number" : "text"} disabled={readOnly} defaultValue={String(value ?? "")} min={parameter.min} max={parameter.max} step={parameter.step} onPointerDown={stop} onBlur={(event) => onCommit(parameter.control === "number" ? Number(event.target.value) : event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

function ElementContextMenu({ menu, element, selectionCount, readOnly, onCopy, onDuplicate, onCut, onDelete, onBypass, onSaveContainer, onClose }: {
  menu: Extract<CanvasMenu, { kind: "element" }>; element?: CanvasSelectable; selectionCount: number; readOnly: boolean; onCopy(): void; onDuplicate(): void; onCut(): void; onDelete(): void; onBypass(): void; onSaveContainer(): void; onClose(): void;
}) {
  if (!element) return null;
  const title = selectionCount > 1 ? `${selectionCount} selected` : element.kind === "node" ? element.label : element.kind === "annotation" ? element.annotationType === "text" ? element.text || "Text" : titleCase(element.annotationType) : element.name || "Group";
  return <div className="on-context-menu" style={{ left: menu.x, top: menu.y }} role="menu"><div><strong>{title}</strong><button onClick={onClose}>×</button></div><button onClick={onCopy}>Copy<kbd>Ctrl C</kbd></button><button disabled={readOnly} onClick={onDuplicate}>Duplicate<kbd>Ctrl D</kbd></button><button disabled={readOnly} onClick={onCut}>Cut<kbd>Ctrl X</kbd></button><hr />{element.kind !== "annotation" && <button disabled={readOnly} onClick={onBypass}>{element.bypassed ? "Disable bypass" : "Bypass"}<kbd>B</kbd></button>}{element.kind === "container" && <button disabled={readOnly} onClick={onSaveContainer}>Save to Library</button>}<hr /><button className="is-danger" disabled={readOnly} onClick={onDelete}>Delete<kbd>Backspace</kbd></button></div>;
}

function ConnectionContextMenu({ menu, connection, defaultRouting, readOnly, onRouting, onArrow, onDelete, onClose }: {
  menu: Extract<CanvasMenu, { kind: "connection" }>; connection?: Connection; defaultRouting: ConnectionRouting; readOnly: boolean; onRouting(routing: ConnectionRouting | "default"): void; onArrow(arrowhead: Connection["arrowhead"]): void; onDelete(): void; onClose(): void;
}) {
  if (!connection) return null;
  return <div className="on-context-menu on-connection-menu" style={{ left: menu.x, top: menu.y }} role="menu"><div><strong>{connection.kind === "decorative" ? "Decorative link" : `${titleCase(connection.kind)} connection`}</strong><button onClick={onClose}>×</button></div><label>Form<select disabled={readOnly} value={connection.routingOverride ? connection.routing : "default"} onChange={(event) => onRouting(event.target.value as ConnectionRouting | "default")}><option value="default">Project default ({defaultRouting})</option><option value="bezier">Bezier</option><option value="smooth-step">Smooth step</option><option value="orthogonal">Orthogonal</option><option value="straight">Straight</option></select></label><label>Direction<select disabled={readOnly} value={connection.arrowhead} onChange={(event) => onArrow(event.target.value as Connection["arrowhead"])}><option value="none">Line</option><option value="end">Vector</option><option value="both">Bidirectional</option></select></label><hr /><button className="is-danger" disabled={readOnly} onClick={onDelete}>Disconnect and delete<kbd>Backspace</kbd></button></div>;
}

function CloseProjectDialog({ name, canSave, onSave, onDiscard, onCancel }: { name: string; canSave: boolean; onSave(): void; onDiscard(): void; onCancel(): void }) {
  return <div className="on-modal-backdrop" onPointerDown={onCancel}><section className="on-modal on-close-project" onPointerDown={(event) => event.stopPropagation()}><div className="on-panel-header"><strong>Close “{name}”?</strong><button onClick={onCancel}>×</button></div><p>Save and download this project before closing it?</p><div className="on-close-project-actions"><button onClick={onCancel}>Cancel</button><button className="is-danger" onClick={onDiscard}>Close without saving</button><button className="on-run-button" disabled={!canSave} onClick={onSave}>Save &amp; close</button></div></section></div>;
}

function SettingsDialog({ project, readOnly, onChange, onClose }: { project: OpenNodeProject; readOnly: boolean; onChange(mutate: (draft: OpenNodeProject) => void): void; onClose(): void }) {
  const background = project.background;
  return <div className="on-modal-backdrop on-settings-backdrop" onPointerDown={onClose}><section className="on-modal on-settings" onPointerDown={(event) => event.stopPropagation()}>
    <div className="on-panel-header"><strong>OPEN NODE Settings</strong><button onClick={onClose}>×</button></div>
    <div className="on-settings-grid">
      <InspectorSection title="Appearance">
        <Field label="Theme"><select disabled={readOnly} value={project.settings.theme} onChange={(event) => onChange((draft) => { draft.settings.theme = event.target.value as OpenNodeProject["settings"]["theme"]; })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></Field>
        <Field label="Background"><select disabled={readOnly} value={background.type} onChange={(event) => onChange((draft) => { const type = event.target.value; draft.background = type === "solid" ? { type, color: "#111318" } : type === "linear-gradient" ? { type, from: "#111318", to: "#232943", angle: 135 } : type === "radial-gradient" ? { type, inner: "#232943", outer: "#111318" } : { type: "transparent" }; })}><option value="solid">Solid</option><option value="linear-gradient">Linear gradient</option><option value="radial-gradient">Radial gradient</option><option value="transparent">Transparent</option></select></Field>
        {background.type === "solid" && <Field label="Color"><input type="color" disabled={readOnly} value={background.color} onChange={(event) => onChange((draft) => { if (draft.background.type === "solid") draft.background.color = event.target.value; })} /></Field>}
        {background.type === "linear-gradient" && <div className="on-two-cols"><Field label="From"><input type="color" disabled={readOnly} value={background.from} onChange={(event) => onChange((draft) => { if (draft.background.type === "linear-gradient") draft.background.from = event.target.value; })} /></Field><Field label="To"><input type="color" disabled={readOnly} value={background.to} onChange={(event) => onChange((draft) => { if (draft.background.type === "linear-gradient") draft.background.to = event.target.value; })} /></Field><Field label="Angle"><input type="number" disabled={readOnly} value={background.angle} onChange={(event) => onChange((draft) => { if (draft.background.type === "linear-gradient") draft.background.angle = Number(event.target.value); })} /></Field></div>}
        {background.type === "radial-gradient" && <div className="on-two-cols"><Field label="Inner"><input type="color" disabled={readOnly} value={background.inner} onChange={(event) => onChange((draft) => { if (draft.background.type === "radial-gradient") draft.background.inner = event.target.value; })} /></Field><Field label="Outer"><input type="color" disabled={readOnly} value={background.outer} onChange={(event) => onChange((draft) => { if (draft.background.type === "radial-gradient") draft.background.outer = event.target.value; })} /></Field></div>}
        <button className="on-secondary-wide" disabled={readOnly} onClick={() => onChange((draft) => { draft.background = { type: "solid", color: DEFAULT_BACKGROUND }; })}>Reset background color</button>
        <Field label="Preview"><select disabled={readOnly} value={project.settings.previewQuality} onChange={(event) => onChange((draft) => { draft.settings.previewQuality = event.target.value as OpenNodeProject["settings"]["previewQuality"]; })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
        <Field label="Motion"><input type="checkbox" disabled={readOnly} checked={!project.settings.reducedMotion} onChange={(event) => onChange((draft) => { draft.settings.reducedMotion = !event.target.checked; })} /></Field>
      </InspectorSection>
      <InspectorSection title="Canvas">
        <Field label="Grid"><input type="checkbox" disabled={readOnly} checked={project.settings.grid.enabled} onChange={(event) => onChange((draft) => { draft.settings.grid.enabled = event.target.checked; draft.settings.grid.majorEvery = 10; })} /></Field>
        <Field label="Grid color"><span className="on-color-control"><input type="color" disabled={readOnly} value={project.settings.grid.color} onChange={(event) => onChange((draft) => { draft.settings.grid.color = event.target.value; })} /><button type="button" disabled={readOnly} onClick={() => onChange((draft) => { draft.settings.grid.color = DEFAULT_GRID_COLOR; })}>Reset</button></span></Field>
        <Field label="Grid step"><input type="number" min="4" max="256" disabled={readOnly} value={project.settings.grid.step} onChange={(event) => onChange((draft) => { draft.settings.grid.step = Math.max(4, Number(event.target.value)); })} /></Field>
        <Field label="Snap to grid"><input type="checkbox" disabled={readOnly} checked={project.settings.grid.snapping} onChange={(event) => onChange((draft) => { draft.settings.grid.snapping = event.target.checked; })} /></Field>
        <Field label="Connections"><select disabled={readOnly} value={project.settings.connectionRouting} onChange={(event) => onChange((draft) => { const routing = event.target.value as ConnectionRouting; draft.settings.connectionRouting = routing; for (const connection of draft.connections) if (!connection.routingOverride) connection.routing = routing; })}><option value="bezier">Bezier</option><option value="smooth-step">Smooth step</option><option value="orthogonal">Orthogonal</option><option value="straight">Straight</option></select></Field>
        <Field label="Minimap"><input type="checkbox" disabled={readOnly} checked={project.settings.minimapVisible} onChange={(event) => onChange((draft) => { draft.settings.minimapVisible = event.target.checked; })} /></Field>
        <Field label="Resources"><input type="checkbox" disabled={readOnly} checked={project.settings.dashboardVisible} onChange={(event) => onChange((draft) => { draft.settings.dashboardVisible = event.target.checked; })} /></Field>
        <Field label="Timeline"><input type="checkbox" disabled={readOnly} checked={project.settings.timelineVisible} onChange={(event) => onChange((draft) => { draft.settings.timelineVisible = event.target.checked; })} /></Field>
      </InspectorSection>
      <InspectorSection title="Execution">
        <Field label="Mode"><select disabled={readOnly} value={project.execution.mode} onChange={(event) => onChange((draft) => { draft.execution.mode = event.target.value as OpenNodeProject["execution"]["mode"]; })}><option value="manual">Manual</option><option value="reactive">Reactive</option><option value="continuous">Continuous</option><option value="timeline">Timeline</option></select></Field>
        <Field label="Concurrency"><input type="number" min="1" max="64" disabled={readOnly} value={project.execution.concurrency} onChange={(event) => onChange((draft) => { draft.execution.concurrency = clamp(Number(event.target.value), 1, 64); })} /></Field>
        <Field label="Backend"><select disabled={readOnly} value={project.execution.preferredBackend} onChange={(event) => onChange((draft) => { draft.execution.preferredBackend = event.target.value as OpenNodeProject["execution"]["preferredBackend"]; })}><option value="auto">Auto</option><option value="main">Main</option><option value="worker">Worker</option><option value="gpu">GPU</option><option value="host">Host</option></select></Field>
        <Field label="Cache"><input type="checkbox" disabled={readOnly} checked={project.execution.cacheEnabled} onChange={(event) => onChange((draft) => { draft.execution.cacheEnabled = event.target.checked; })} /></Field>
      </InspectorSection>
    </div>
    <div className="on-settings-actions"><button onClick={onClose}>Done</button></div>
  </section></div>;
}

function DocumentationDialog({ onClose }: { onClose(): void }) {
  const sections = [
    { id: "start", title: "Quick start" },
    { id: "canvas", title: "Canvas and navigation" },
    { id: "library", title: "Library" },
    { id: "editing", title: "Selection and editing" },
    { id: "graph", title: "Nodes, Containers and Groups" },
    { id: "connections", title: "Connections" },
    { id: "execution", title: "Execution and Timeline" },
    { id: "projects", title: "Projects and files" },
  ];
  return <div className="on-modal-backdrop on-documentation-backdrop" onPointerDown={onClose}><section className="on-modal on-documentation" onPointerDown={(event) => event.stopPropagation()}>
    <div className="on-panel-header"><strong>OPEN NODE Documentation</strong><button onClick={onClose}>×</button></div>
    <div className="on-documentation-layout">
      <nav aria-label="Documentation sections">{sections.map((section) => <a key={section.id} href={`#on-doc-${section.id}`}>{section.title}</a>)}</nav>
      <article>
        <section id="on-doc-start"><h2>Quick start</h2><ol><li>Open the Library with left <kbd>Alt</kbd> or double-click an empty Canvas area.</li><li>Drag a Node or Container onto the Canvas.</li><li>Connect an output port to a compatible input port.</li><li>Edit values directly on a Node or in Inspector.</li><li>Press <kbd>Enter</kbd> or Run to execute the workflow.</li></ol></section>
        <section id="on-doc-canvas"><h2>Canvas and navigation</h2><p>Use the mouse wheel to zoom under the cursor. Hold Space and drag, or use the middle mouse button, to pan. Fit frames all visible entities; Origin returns the viewport to world origin. Settings control the background, hierarchical grid and entity snapping. Snapping affects Nodes, Containers and Groups, but never annotations.</p></section>
        <section id="on-doc-library"><h2>Library</h2><p>The Library opens with its top-left corner at the pointer whenever space permits. The toolbar above it creates annotations and toggles visual layers. Recently lists the last used Nodes and Containers; Nodes contains all registered Node types; Containers contains an empty Container and saved presets. Search combines all types into one result grid.</p></section>
        <section id="on-doc-editing"><h2>Selection and editing</h2><p>Click-drag on empty Canvas space to marquee-select. Hold Shift to add or remove individual entities. Drag any selected entity to move the complete selection. Internal connections are preserved by copy, cut, duplicate and paste.</p><dl><dt><kbd>Ctrl/Cmd C</kbd></dt><dd>Copy selection</dd><dt><kbd>Ctrl/Cmd X</kbd></dt><dd>Cut selection</dd><dt><kbd>Ctrl/Cmd V</kbd></dt><dd>Paste at the pointer</dd><dt><kbd>Ctrl/Cmd D</kbd></dt><dd>Duplicate selection</dd><dt><kbd>Backspace</kbd></dt><dd>Delete selection and attached connections</dd><dt><kbd>B</kbd></dt><dd>Toggle bypass</dd></dl></section>
        <section id="on-doc-graph"><h2>Nodes, Containers and Groups</h2><p>Nodes perform graph operations and expose typed ports and inline parameters. Containers execute compatible Nodes serially and preserve their visible order. Drag Nodes into a highlighted Container slot or back to the Canvas. Groups organize top-level Nodes and Containers and move their current members together. Rename Containers and Groups directly on the Canvas.</p></section>
        <section id="on-doc-connections"><h2>Connections</h2><p>Drag from an output port to a compatible input. A single-input port replaces its existing connection. Right-click a connection to choose project-default or per-connection routing and arrow direction. Dragging a selected endpoint away disconnects and removes the connection.</p></section>
        <section id="on-doc-execution"><h2>Execution and Timeline</h2><p>Manual runs on demand; Reactive follows graph changes; Continuous supports streaming Nodes; Timeline supplies shared time and frame context. Run executes the selected scope when entities are selected, otherwise the entire graph. Stop cancels the active session. Timeline controls step by one frame in either direction.</p></section>
        <section id="on-doc-projects"><h2>Projects and files</h2><p>Up to four projects can be open in tabs. Save exports the current canonical project: complete Node state and ports, connection styles and routes, Containers, Groups, annotations, presets, assets, execution and Timeline settings, Canvas settings, viewport and Library layout. Loading or dropping a valid pipeline opens it in a new project tab. Selection, clipboard, Inspector visibility and open tabs are session state; each project is saved independently. Closing a project or browser tab warns before unsaved work is discarded.</p></section>
      </article>
    </div>
    <div className="on-settings-actions"><button onClick={onClose}>Done</button></div>
  </section></div>;
}

function useProject(store: ProjectStore): OpenNodeProject {
  return useSyncExternalStore((notify) => store.subscribe(notify), () => store.project, () => store.project);
}

function cullElements(elements: GraphElement[], viewport: ViewportState, canvas: { width: number; height: number }, selection: Set<string>, dragIds: Set<string>): GraphElement[] {
  const margin = 300 / viewport.zoom;
  const rect = { x: viewport.x - canvas.width / 2 / viewport.zoom - margin, y: viewport.y - canvas.height / 2 / viewport.zoom - margin, width: canvas.width / viewport.zoom + margin * 2, height: canvas.height / viewport.zoom + margin * 2 };
  return elements.filter((element) => selection.has(element.id) || dragIds.has(element.id) || rectanglesIntersect(rect, { ...element.position, ...element.size }));
}

function connectionPoint(project: OpenNodeProject, connection: Connection, side: "source" | "target", elements: GraphElement[], dragIds: Set<string>, offset: Point, resizePreview?: ResizePreview): Point | null {
  const endpoint = connection[side];
  const element = elements.find((item) => item.id === endpoint.elementId);
  if (!element) return null;
  const delta = dragIds.has(element.id) ? offset : { x: 0, y: 0 };
  const preview = resizePreview?.elementId === element.id ? resizePreview.rect : undefined;
  const position = preview ? { x: preview.x, y: preview.y } : { x: element.position.x + delta.x, y: element.position.y + delta.y };
  const size = preview ? { width: preview.width, height: preview.height } : element.size;
  if ("normalizedAnchor" in endpoint) return { x: position.x + size.width * endpoint.normalizedAnchor.x, y: position.y + size.height * endpoint.normalizedAnchor.y };
  return portWorldPoint(project, endpoint.elementId, endpoint.portId, { ...position, ...size });
}

function portWorldPoint(project: OpenNodeProject, elementId: string, portId: string, override?: Rect): Point | null {
  const node = project.nodes.find((item) => item.id === elementId);
  if (node) {
    const ports = node.ports.filter((port) => port.direction === node.ports.find((candidate) => candidate.id === portId)?.direction);
    const index = Math.max(0, ports.findIndex((port) => port.id === portId));
    const port = node.ports.find((candidate) => candidate.id === portId);
    const rect = override ?? { ...node.position, ...node.size };
    const output = port?.direction === "output";
    return { x: rect.x + (output ? rect.width + PORT_DOT_GAP : -PORT_DOT_GAP), y: rect.y + NODE_PORT_START + PORT_VISUAL_OFFSET_Y + index * NODE_PORT_GAP };
  }
  const container = project.containers.find((item) => item.id === elementId);
  if (container) { const rect = override ?? { ...container.position, ...container.size }; const output = portId === container.outputPort.id; return { x: rect.x + (output ? rect.width + PORT_DOT_GAP : -PORT_DOT_GAP), y: rect.y + containerPortY(container, output ? "output" : "input") }; }
  return null;
}

function routePath(source: Point, target: Point, routing: Connection["routing"]): string {
  if (routing === "straight") return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  if (routing === "orthogonal") { const middle = (source.x + target.x) / 2; return `M ${source.x} ${source.y} L ${middle} ${source.y} L ${middle} ${target.y} L ${target.x} ${target.y}`; }
  if (routing === "smooth-step") { const middle = (source.x + target.x) / 2; return `M ${source.x} ${source.y} C ${middle} ${source.y}, ${middle} ${target.y}, ${target.x} ${target.y}`; }
  const distance = Math.max(60, Math.abs(target.x - source.x) * 0.45);
  return `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`;
}

function canvasBackground(project: OpenNodeProject): CSSProperties {
  const background = project.background;
  if (background.type === "solid") return { backgroundColor: background.color };
  if (background.type === "linear-gradient") return { backgroundImage: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` };
  if (background.type === "radial-gradient") return { backgroundImage: `radial-gradient(circle, ${background.inner}, ${background.outer})` };
  if (background.type === "transparent") return { background: "transparent" };
  const asset = project.assets.find((item) => item.id === background.assetId);
  return { backgroundImage: `url(${String(asset?.metadata["previewUrl"] ?? asset?.uri ?? "")})`, backgroundSize: background.fit === "stretch" ? "100% 100%" : background.fit, backgroundRepeat: background.fit === "tile" ? "repeat" : "no-repeat", backgroundPosition: `${background.offset.x}px ${background.offset.y}px`, opacity: background.opacity };
}

function gridStyle(project: OpenNodeProject, viewport: ViewportState, canvas: { width: number; height: number }): CSSProperties {
  const step = project.settings.grid.step * viewport.zoom;
  const majorEvery = Math.max(2, project.settings.grid.majorEvery);
  const major = step * majorEvery;
  const superMajor = major * majorEvery;
  const offsetX = canvas.width / 2 - viewport.x * viewport.zoom;
  const offsetY = canvas.height / 2 - viewport.y * viewport.zoom;
  const color = project.settings.grid.color;
  const minorAlpha = project.settings.grid.opacity * 100 * clamp((step - 5) / 12, 0, 1);
  const majorAlpha = Math.min(48, project.settings.grid.opacity * 220) * clamp((major - 7) / 22, 0, 1);
  const superAlpha = Math.min(72, project.settings.grid.opacity * 360) * clamp((superMajor - 8) / 26, 0, 1);
  const minorColor = `color-mix(in srgb, ${color} ${minorAlpha}%, transparent)`;
  const majorColor = `color-mix(in srgb, ${color} ${majorAlpha}%, transparent)`;
  const superColor = `color-mix(in srgb, ${color} ${superAlpha}%, transparent)`;
  return {
    backgroundImage: `linear-gradient(to right, ${superColor} 1px, transparent 1px), linear-gradient(to bottom, ${superColor} 1px, transparent 1px), linear-gradient(to right, ${majorColor} 1px, transparent 1px), linear-gradient(to bottom, ${majorColor} 1px, transparent 1px), linear-gradient(to right, ${minorColor} 1px, transparent 1px), linear-gradient(to bottom, ${minorColor} 1px, transparent 1px)`,
    backgroundSize: `${superMajor}px ${superMajor}px, ${superMajor}px ${superMajor}px, ${major}px ${major}px, ${major}px ${major}px, ${step}px ${step}px, ${step}px ${step}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
  };
}

function rectStyle(rect: Rect): CSSProperties { return { left: rect.x, top: rect.y, width: rect.width, height: rect.height }; }
function normalizedRect(a: Point, b: Point): Rect { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }
function rectanglesIntersect(a: Rect, b: Rect): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function pointInRect(point: Point, rect: Rect): boolean { return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height; }
function unionRects(a: Rect | null, b: Rect | null): Rect | null { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y); const right = Math.max(a.x + a.width, b.x + b.width); const bottom = Math.max(a.y + a.height, b.y + b.height); return { x, y, width: right - x, height: bottom - y }; }
function clipboardOffsetAtPoint(clipboard: ClipboardGraph, point: Point, snapStep?: number): Point {
  const bounds = [...clipboard.nodes, ...clipboard.containers, ...clipboard.groups, ...clipboard.annotations]
    .reduce<Rect | null>((current, element) => unionRects(current, { ...element.position, ...element.size }), null);
  if (!bounds) return { x: 0, y: 0 };
  const offset = { x: point.x - (bounds.x + bounds.width / 2), y: point.y - (bounds.y + bounds.height / 2) };
  return snapStep ? snapClipboardOffset(clipboard, offset, snapStep) : offset;
}
function snapValue(value: number, step: number): number { return Math.round(value / Math.max(1, step)) * Math.max(1, step); }
function snapPoint(point: Point, step: number): Point { return { x: snapValue(point.x, step), y: snapValue(point.y, step) }; }
function snapPointIfEnabled(point: Point, grid: OpenNodeProject["settings"]["grid"]): Point { return grid.snapping ? snapPoint(point, grid.step) : point; }
function snapMovementOffset(position: Point, offset: Point, step: number): Point {
  const snapped = snapPoint({ x: position.x + offset.x, y: position.y + offset.y }, step);
  return { x: snapped.x - position.x, y: snapped.y - position.y };
}
function snapClipboardOffset(clipboard: ClipboardGraph, offset: Point, step: number): Point {
  const anchor = [...clipboard.groups, ...clipboard.containers, ...clipboard.nodes][0];
  return anchor ? snapMovementOffset(anchor.position, offset, step) : offset;
}
function snapResizeRect(rect: Rect, handle: ResizeHandle, step: number, min: Size): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) left = snapValue(left, step); else right = snapValue(right, step);
  if (handle.includes("n")) top = snapValue(top, step); else bottom = snapValue(bottom, step);
  if (right - left < min.width) {
    if (handle.includes("w")) left = right - min.width;
    else right = left + min.width;
  }
  if (bottom - top < min.height) {
    if (handle.includes("n")) top = bottom - min.height;
    else bottom = top + min.height;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function snapCreatedRect(rect: Rect, step: number): Rect {
  const start = snapPoint({ x: rect.x, y: rect.y }, step);
  const end = snapPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, step);
  return { x: start.x, y: start.y, width: Math.max(step, end.x - start.x), height: Math.max(step, end.y - start.y) };
}
function recordRecentLibraryItem(project: OpenNodeProject, item: RecentLibraryItem): void {
  project.settings.recentLibraryItems = [item, ...(project.settings.recentLibraryItems ?? []).filter((candidate) => candidate.kind !== item.kind || candidate.id !== item.id)].slice(0, 12);
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function capturePointer(element: Element | null, pointerId: number): void { (element as (Element & { setPointerCapture?: (id: number) => void }) | null)?.setPointerCapture?.(pointerId); }
function formatTime(seconds: number): string { const minutes = Math.floor(seconds / 60); const remaining = seconds - minutes * 60; return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`; }
function formatOutputs(value: unknown): string { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function isFormTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable=true]")); }
function titleCase(value: string): string { return value ? value[0]!.toUpperCase() + value.slice(1) : value; }
function getCanvasElement(project: OpenNodeProject, id: string): CanvasSelectable | undefined { return getElement(project, id) ?? project.annotations.find((annotation) => annotation.id === id); }
function annotationFromInteraction(interaction: Extract<NonNullable<Interaction>, { kind: "annotate" }>): CanvasAnnotation {
  if (interaction.tool === "brush") {
    const points = interaction.points.length > 1 ? interaction.points : [interaction.startWorld, interaction.currentWorld];
    const x = Math.min(...points.map((point) => point.x));
    const y = Math.min(...points.map((point) => point.y));
    const width = Math.max(8, Math.max(...points.map((point) => point.x)) - x);
    const height = Math.max(8, Math.max(...points.map((point) => point.y)) - y);
    const annotation = createAnnotation("brush", { x, y });
    annotation.size = { width, height };
    annotation.points = points.map((point) => ({ x: point.x - x, y: point.y - y }));
    return annotation;
  }
  let current = interaction.currentWorld;
  if (interaction.square && ["rectangle", "ellipse", "diamond"].includes(interaction.tool)) {
    const dx = current.x - interaction.startWorld.x;
    const dy = current.y - interaction.startWorld.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    current = { x: interaction.startWorld.x + Math.sign(dx || 1) * side, y: interaction.startWorld.y + Math.sign(dy || 1) * side };
  }
  const rect = normalizedRect(interaction.startWorld, current);
  const annotation = createAnnotation(interaction.tool, { x: rect.x, y: rect.y });
  annotation.size = { width: Math.max(8, rect.width), height: Math.max(8, rect.height) };
  if (interaction.tool === "arrow") annotation.points = [{ x: interaction.startWorld.x - rect.x, y: interaction.startWorld.y - rect.y }, { x: current.x - rect.x, y: current.y - rect.y }];
  return annotation;
}
function annotationFromWorldPoints(annotation: CanvasAnnotation, points: Point[]): CanvasAnnotation {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  const x = rawWidth < 8 ? minX - (8 - rawWidth) / 2 : minX;
  const y = rawHeight < 8 ? minY - (8 - rawHeight) / 2 : minY;
  return {
    ...structuredClone(annotation),
    position: { x, y },
    size: { width: Math.max(8, rawWidth), height: Math.max(8, rawHeight) },
    points: points.map((point) => ({ x: point.x - x, y: point.y - y })),
  };
}
function assetOutputType(asset: OpenNodeProject["assets"][number]): string { if (asset.mediaType === "image" || asset.mediaType === "video" || asset.mediaType === "audio") return `media.${asset.mediaType}`; if (asset.mediaType === "table") return "core.table"; if (asset.mediaType === "text") return asset.mimeType === "application/json" ? "core.json" : "core.string"; if (asset.mediaType === "binary") return "core.binary"; return "core.file"; }
function graphElementColor(element?: GraphElement): string { return element?.color ?? (element?.kind === "container" ? "#ffffff" : element?.kind === "group" ? "#4b84ff" : "#667085"); }
function canvasElementColor(element: CanvasSelectable, definitions: NodeRegistry): string { if (element.kind === "annotation") return element.color; if (element.kind === "node") return element.color ?? definitions.get(element.nodeTypeId, element.nodeTypeVersion)?.defaultColor ?? "#667085"; return graphElementColor(element); }
function solidHexColor(value: string): string {
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#111318";
}
function containerPortY(container: ContainerInstance, side: "input" | "output"): number {
  if (container.collapsed || container.nodeIds.length === 0) return NODE_PORT_START + PORT_VISUAL_OFFSET_Y;
  const index = side === "input" ? 0 : container.nodeIds.length - 1;
  return CONTAINER_HEADER_HEIGHT + 9 + CONTAINER_NODE_HEIGHT / 2 + index * (CONTAINER_NODE_HEIGHT + CONTAINER_NODE_GAP) + PORT_VISUAL_OFFSET_Y;
}
function containerInsertionIndex(container: ContainerInstance, worldY: number): number {
  if (container.collapsed || container.nodeIds.length === 0) return container.nodeIds.length;
  const firstSlotTop = container.position.y + CONTAINER_HEADER_HEIGHT + 9;
  return clamp(Math.floor((worldY - firstSlotTop) / (CONTAINER_NODE_HEIGHT + CONTAINER_NODE_GAP)), 0, container.nodeIds.length);
}
function containerDropRect(container: ContainerInstance): Rect {
  const contentHeight = container.collapsed ? 88 : CONTAINER_HEADER_HEIGHT + 18 + container.nodeIds.length * (CONTAINER_NODE_HEIGHT + CONTAINER_NODE_GAP) + 30;
  return { ...container.position, width: container.size.width, height: Math.max(container.size.height, contentHeight) };
}
function findPort(project: OpenNodeProject, elementId: string, portId: string): PortInstance | undefined { const node = project.nodes.find((candidate) => candidate.id === elementId); if (node) return node.ports.find((port) => port.id === portId); const container = project.containers.find((candidate) => candidate.id === elementId); return container ? [container.inputPort, container.outputPort].find((port) => port.id === portId) : undefined; }
function reconcileGroupMembership(project: OpenNodeProject): void {
  for (const group of project.groups) { group.memberNodeIds = []; group.memberContainerIds = []; }
  for (const node of project.nodes) node.parentGroupId = null;
  for (const container of project.containers) container.parentGroupId = null;
  const elements: Array<NodeInstance | ContainerInstance> = [...project.nodes.filter((node) => !node.parentContainerId), ...project.containers];
  for (const element of elements) {
    const group = project.groups.filter((candidate) => rectContainsRect({ ...candidate.position, ...candidate.size }, { ...element.position, ...element.size })).sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0];
    element.parentGroupId = group?.id ?? null;
    if (!group) continue;
    if (element.kind === "node") group.memberNodeIds.push(element.id); else group.memberContainerIds.push(element.id);
  }
}
function browserCapabilities(): { cores: string; memory: string; gpu: string } {
  if (browserCapabilityCache) return browserCapabilityCache;
  if (typeof navigator === "undefined") return { cores: "restricted", memory: "Browser restricted", gpu: "Browser restricted" };
  const extended = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} cores` : "cores restricted";
  const memory = extended.deviceMemory ? `${extended.deviceMemory} GB device` : "Heap API restricted";
  let gpu = extended.gpu ? "WebGPU ready" : "WebGL ready";
  if (typeof document !== "undefined" && !navigator.userAgent.toLowerCase().includes("jsdom")) { const canvas = document.createElement("canvas"); if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) gpu = "GPU API restricted"; }
  browserCapabilityCache = { cores, memory, gpu };
  return browserCapabilityCache;
}
