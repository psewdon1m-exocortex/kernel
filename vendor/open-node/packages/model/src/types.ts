export type ElementId = string;
export type NodeId = ElementId;
export type ContainerId = ElementId;
export type GroupId = ElementId;
export type AnnotationId = ElementId;
export type ConnectionId = string;
export type AssetId = string;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export type ExecutionStatus =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "error"
  | "bypassed"
  | "cancelled"
  | "paused"
  | "streaming";

export type ExecutionMode = "manual" | "reactive" | "continuous" | "timeline";
export type BackendId = "main" | "worker" | "gpu" | "host";
export type PreferredBackend = BackendId | "auto";

export interface PortInstance {
  id: string;
  label: string;
  direction: "input" | "output";
  kind: "data" | "control";
  typeId: string;
  required?: boolean;
  multiple?: boolean;
  dynamic?: boolean;
  hidden?: boolean;
}

export interface NodeUiState {
  collapsed?: boolean;
  previewEnabled?: boolean;
  previewHeight?: number;
  selectedTab?: string;
  [key: string]: unknown;
}

export interface RuntimeHints {
  preferredBackend?: PreferredBackend;
  priority?: number;
  timeoutMs?: number;
  cacheEnabled?: boolean;
}

export interface NodeInstance {
  id: NodeId;
  kind: "node";
  nodeTypeId: string;
  nodeTypeVersion: string;
  position: Point;
  size: Size;
  label: string;
  color?: string;
  bypassed: boolean;
  parameters: Record<string, unknown>;
  ports: PortInstance[];
  parentContainerId: ContainerId | null;
  parentGroupId: GroupId | null;
  uiState: NodeUiState;
  runtimeHints: RuntimeHints;
  tags?: string[];
  unresolved?: {
    reason: string;
    rawState: unknown;
  };
}

export interface ContainerInstance {
  id: ContainerId;
  kind: "container";
  name: string;
  position: Point;
  size: Size;
  color?: string;
  collapsed: boolean;
  bypassed: boolean;
  nodeIds: NodeId[];
  parentGroupId: GroupId | null;
  inputPort: PortInstance;
  outputPort: PortInstance;
  errorPolicy: "stop-on-error";
  tags?: string[];
}

export interface GroupInstance {
  id: GroupId;
  kind: "group";
  name?: string;
  position: Point;
  size: Size;
  color?: string;
  opacity: number;
  borderStyle: "solid" | "dashed" | "dotted";
  collapsed: boolean;
  bypassed: boolean;
  memberNodeIds: NodeId[];
  memberContainerIds: ContainerId[];
  bypassSnapshot?: Record<ElementId, boolean>;
  tags?: string[];
}

export type GraphElement = NodeInstance | ContainerInstance | GroupInstance;

export type AnnotationType = "rectangle" | "ellipse" | "diamond" | "arrow" | "brush" | "text";

export interface CanvasAnnotation {
  id: AnnotationId;
  kind: "annotation";
  annotationType: AnnotationType;
  position: Point;
  size: Size;
  rotation: number;
  color: string;
  fillColor?: string;
  strokeWidth: number;
  opacity: number;
  text?: string;
  fontSize?: number;
  points?: Point[];
}

export interface ComputationalEndpoint {
  elementId: NodeId | ContainerId;
  portId: string;
}

export interface DecorativeEndpoint {
  elementId: ElementId;
  normalizedAnchor: Point;
}

export type ConnectionRouting = "straight" | "bezier" | "smooth-step" | "orthogonal";

interface BaseConnection {
  id: ConnectionId;
  label?: string;
  color?: string;
  thickness: number;
  opacity: number;
  dash?: number[];
  arrowhead: "none" | "end" | "both";
  routing: ConnectionRouting;
  routingOverride?: boolean;
  reroutePoints: Point[];
}

export interface ComputationalConnection extends BaseConnection {
  kind: "data" | "control";
  source: ComputationalEndpoint;
  target: ComputationalEndpoint;
}

export interface DecorativeConnection extends BaseConnection {
  kind: "decorative";
  source: DecorativeEndpoint;
  target: DecorativeEndpoint;
}

export type Connection = ComputationalConnection | DecorativeConnection;

export interface TimelineSettings {
  enabled: boolean;
  fps: number;
  durationSeconds: number;
  startTime: number;
  endTime: number;
  loop: boolean;
  playbackRate: number;
  timeUnit: "seconds" | "frames";
  currentTime: number;
}

export interface TimelineContext {
  timeSeconds: number;
  frame: number;
  fps: number;
  deltaTime: number;
  playbackState: "stopped" | "playing" | "paused" | "scrubbing";
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export type BackgroundSettings =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; from: string; to: string; angle: number }
  | { type: "radial-gradient"; inner: string; outer: string }
  | {
      type: "image";
      assetId: AssetId;
      fit: "cover" | "contain" | "stretch" | "tile";
      scale: number;
      opacity: number;
      offset: Point;
      binding: "world" | "viewport";
    }
  | { type: "transparent" };

export interface GridSettings {
  enabled: boolean;
  step: number;
  majorEvery: number;
  color: string;
  opacity: number;
  snapping: boolean;
}

export interface RecentLibraryItem {
  kind: "node" | "container";
  id: string;
}

export interface ExecutionSettings {
  mode: ExecutionMode;
  concurrency: number;
  preferredBackend: PreferredBackend;
  cacheEnabled: boolean;
  nodeTimeoutMs: number;
  continuousQueueSize: number;
  backpressure: "block" | "drop-oldest" | "drop-newest";
}

export interface ProjectSettings {
  theme: "light" | "dark" | "system";
  grid: GridSettings;
  minimapVisible: boolean;
  timelineVisible: boolean;
  dashboardVisible: boolean;
  reducedMotion: boolean;
  previewQuality: "low" | "medium" | "high";
  connectionRouting: ConnectionRouting;
  connectionsVisible?: boolean;
  portsVisible?: boolean;
  groupsVisible?: boolean;
  annotationsVisible?: boolean;
  recentLibraryItems?: RecentLibraryItem[];
  panelLayout?: {
    library: { position: Point; size: Size };
  };
}

export interface ProjectMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface ProjectDependency {
  packageId: string;
  version: string;
  integrity?: string;
  required: boolean;
}

export type AssetStorageMode = "embedded" | "external" | "remote" | "host-managed";

export interface AssetReference {
  id: AssetId;
  name: string;
  storage: AssetStorageMode;
  uri?: string;
  path?: string;
  mimeType: string;
  mediaType: "image" | "video" | "audio" | "text" | "table" | "document" | "geometry" | "archive" | "binary";
  size: number;
  checksum?: string;
  metadata: Record<string, unknown>;
  missing?: boolean;
  embeddedPath?: string;
}

export interface NodePreset {
  id: string;
  kind: "node";
  name: string;
  nodeTypeId: string;
  nodeTypeVersion: string;
  color?: string;
  parameters: Record<string, unknown>;
  uiState: NodeUiState;
}

export interface ContainerPresetNode {
  nodeTypeId: string;
  nodeTypeVersion: string;
  label: string;
  color?: string;
  parameters: Record<string, unknown>;
  bypassed: boolean;
}

export interface ContainerPreset {
  id: string;
  kind: "container";
  name: string;
  color?: string;
  nodes: ContainerPresetNode[];
  errorPolicy: "stop-on-error";
}

export type Preset = NodePreset | ContainerPreset;

export interface OpenNodeProject {
  format: "open-node-project";
  schemaVersion: "1.0.0";
  createdWith: string;
  metadata: ProjectMetadata;
  dependencies: ProjectDependency[];
  settings: ProjectSettings;
  execution: ExecutionSettings;
  timeline: TimelineSettings;
  viewport: ViewportState;
  background: BackgroundSettings;
  nodes: NodeInstance[];
  containers: ContainerInstance[];
  groups: GroupInstance[];
  connections: Connection[];
  annotations: CanvasAnnotation[];
  presets: Preset[];
  assets: AssetReference[];
}

export interface ValueEnvelope<T = unknown> {
  typeId: string;
  value: T;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionError {
  code: string;
  message: string;
  nodeId: string;
  portId: string | null;
  backend: BackendId;
  stack: string | null;
  timestamp: string;
}

export interface ElementExecutionState {
  status: ExecutionStatus;
  progress: number | null;
  backend?: BackendId;
  error?: ExecutionError;
  startedAt?: number;
  finishedAt?: number;
}

export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type ProjectChangeReason =
  | "load"
  | "node"
  | "container"
  | "group"
  | "annotation"
  | "connection"
  | "timeline"
  | "viewport"
  | "settings"
  | "asset"
  | "preset"
  | "transaction";

export interface ProjectChangeEvent {
  project: OpenNodeProject;
  reason: ProjectChangeReason;
  revision: number;
}
