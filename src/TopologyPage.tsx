import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { api } from "./api";
import { ConfirmDialog, Modal, formatDate, shortHash } from "./components";
import type { RevisionSummary } from "./types";

type Notify = (message: string, kind?: "success" | "error" | "info") => void;

interface ExcalidrawDocument {
  type: "excalidraw";
  version: number;
  source: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

interface TopologyPayload {
  revision: string;
  checksum: string;
  actor: string;
  reason: string;
  source_revision: string | null;
  created_at: string;
  project: ExcalidrawDocument | Record<string, unknown>;
}

function createEmptyScene(): ExcalidrawDocument {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [],
    appState: {
      name: "Exocortex Topology",
      theme: "dark",
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridModeEnabled: true,
    },
    files: {},
  };
}

function isExcalidrawDocument(value: unknown): value is ExcalidrawDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ExcalidrawDocument>;
  return candidate.type === "excalidraw"
    && candidate.version === 2
    && Array.isArray(candidate.elements)
    && !!candidate.appState
    && typeof candidate.appState === "object"
    && !Array.isArray(candidate.appState)
    && (!candidate.files || (typeof candidate.files === "object" && !Array.isArray(candidate.files)));
}

function normalizeScene(value: unknown): { document: ExcalidrawDocument; migrated: boolean } {
  if (!isExcalidrawDocument(value)) return { document: createEmptyScene(), migrated: true };
  return {
    document: {
      ...value,
      appState: {
        viewBackgroundColor: "#ffffff",
        theme: "dark",
        ...value.appState,
        ...(value.appState.viewBackgroundColor === "#111318" ? { viewBackgroundColor: "#ffffff" } : {}),
      },
      files: value.files ?? {},
    },
    migrated: false,
  };
}

function sceneForEditor(document: ExcalidrawDocument): ImportedDataState {
  return {
    type: document.type,
    version: document.version,
    source: document.source,
    elements: document.elements,
    appState: document.appState,
    files: document.files,
    scrollToContent: false,
  };
}

function serializeScene(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): ExcalidrawDocument {
  const document = JSON.parse(
    serializeAsJSON(elements, appState, files, "database"),
  ) as ExcalidrawDocument;
  return { ...document, files: document.files ?? {} };
}

export function TopologyPage({ notify }: { notify: Notify }) {
  const editorRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const latestSceneRef = useRef<ExcalidrawDocument | undefined>(undefined);
  const lastObservedRef = useRef("");
  const lastSavedRef = useRef("");
  const sceneKeyRef = useRef(0);
  const [scene, setScene] = useState<{ key: number; data: ImportedDataState }>();
  const [metadata, setMetadata] = useState<Omit<TopologyPayload, "project">>();
  const [status, setStatus] = useState("Loading map...");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<RevisionSummary[]>([]);
  const [restore, setRestore] = useState<RevisionSummary>();
  const [restorePending, setRestorePending] = useState(false);
  const [reload, setReload] = useState(0);

  const save = useCallback(async function persist(visibleFeedback = false) {
    const editor = editorRef.current;
    const project = editor
      ? serializeScene(
        editor.getSceneElementsIncludingDeleted(),
        editor.getAppState(),
        editor.getFiles(),
      )
      : latestSceneRef.current;
    if (!project) return;
    const serialized = JSON.stringify(project);
    latestSceneRef.current = project;
    if (serialized === lastSavedRef.current) {
      setStatus("Saved");
      if (visibleFeedback) notify("Topology Map is already saved", "info");
      return;
    }
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("Saving...");
    try {
      const result = await api<TopologyPayload>("/api/topology", {
        method: "PUT",
        body: JSON.stringify({ project }),
      });
      const { project: savedProject, ...meta } = result;
      const normalized = normalizeScene(savedProject).document;
      lastSavedRef.current = JSON.stringify(normalized);
      setMetadata(meta);
      setStatus("Saved");
      if (visibleFeedback) notify("Topology Map saved");
    } catch (error) {
      setStatus("Save failed");
      notify((error as Error).message, "error");
    } finally {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        void persist(false);
      }
    }
  }, [notify]);

  useEffect(() => {
    let disposed = false;
    editorRef.current = null;
    setScene(undefined);
    setStatus("Loading map...");
    api<TopologyPayload>("/api/topology")
      .then((payload) => {
        if (disposed) return;
        const { project, ...meta } = payload;
        const normalized = normalizeScene(project);
        const serialized = JSON.stringify(normalized.document);
        latestSceneRef.current = normalized.document;
        lastObservedRef.current = serialized;
        lastSavedRef.current = normalized.migrated ? "" : serialized;
        setMetadata(meta);
        setStatus(normalized.migrated ? "Migrating map..." : "Saved");
        sceneKeyRef.current += 1;
        setScene({ key: sceneKeyRef.current, data: sceneForEditor(normalized.document) });
        if (normalized.migrated) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => void save(false), 0);
        }
      })
      .catch((error: Error) => {
        if (disposed) return;
        setStatus("Map unavailable");
        notify(error.message, "error");
      });

    return () => {
      disposed = true;
      editorRef.current = null;
      window.clearTimeout(saveTimerRef.current);
    };
  }, [notify, reload, save]);

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    const project = serializeScene(elements, appState, files);
    const serialized = JSON.stringify(project);
    latestSceneRef.current = project;
    if (serialized === lastObservedRef.current) return;
    lastObservedRef.current = serialized;
    if (serialized === lastSavedRef.current) {
      setStatus("Saved");
      return;
    }
    setStatus("Modified");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void save(false), 1000);
  }, [save]);

  const loadVersions = async () => {
    try {
      const result = await api<{ versions: RevisionSummary[] }>("/api/topology/versions");
      setVersions(result.versions);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    void loadVersions();
  };

  const restoreVersion = async () => {
    if (!restore) return;
    setRestorePending(true);
    window.clearTimeout(saveTimerRef.current);
    try {
      await api<TopologyPayload>("/api/topology/restore", {
        method: "POST",
        body: JSON.stringify({ revision: restore.revision }),
      });
      setRestore(undefined);
      setHistoryOpen(false);
      setReload((value) => value + 1);
      notify("Topology restored as a new revision");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setRestorePending(false);
    }
  };

  const metadataTitle = [
    metadata?.revision ? `Revision ${metadata.revision}` : "No revision",
    metadata?.checksum ? `SHA-256 ${shortHash(metadata.checksum)}` : "",
    metadata?.created_at ? formatDate(metadata.created_at) : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="topology-page" aria-label="Topology Map editor">
      {scene ? (
        <div className="topology-canvas">
          <Excalidraw
            key={scene.key}
            initialData={scene.data}
            excalidrawAPI={(editor) => {
              editorRef.current = editor;
            }}
            onChange={handleChange}
            name="Exocortex Topology"
            langCode="en"
            theme="dark"
            autoFocus
            gridModeEnabled
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: true,
                export: { saveFileToDisk: true },
                loadScene: true,
                saveToActiveFile: true,
                saveAsImage: true,
                toggleTheme: false,
              },
              tools: { image: true },
            }}
            renderTopRightUI={() => (
              <div className="topology-host-controls" title={metadataTitle}>
                <span className={`topology-host-status is-${status.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`} aria-live="polite">
                  {status}
                </span>
                <button type="button" onClick={() => void save(true)}>Save</button>
                <button type="button" onClick={openHistory}>Versions</button>
              </div>
            )}
          />
        </div>
      ) : (
        <div className="topology-loading">{status}</div>
      )}

      {historyOpen && (
        <Modal title="Topology versions" width={900} onClose={() => setHistoryOpen(false)}>
          <div className="version-list">
            {versions.map((version) => {
              const active = version.revision === metadata?.revision;
              return (
                <div key={version.revision}>
                  <span className={active ? "active-tag" : ""}>
                    {active ? "ACTIVE" : version.reason.toUpperCase()}
                  </span>
                  <code>{version.revision}</code>
                  <span>{shortHash(version.checksum)}</span>
                  <time>{formatDate(version.created_at)}</time>
                  <button
                    type="button"
                    disabled={restorePending || active}
                    onClick={() => setRestore(version)}
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {restore && (
        <ConfirmDialog
          title="Restore topology"
          message={`Revision ${restore.revision} will be restored.`}
          detail="The current map will remain in history. Restore creates a new active immutable revision."
          confirmLabel="Restore"
          pending={restorePending}
          onConfirm={() => void restoreVersion()}
          onClose={() => setRestore(undefined)}
        />
      )}
    </section>
  );
}
