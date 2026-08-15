import { useEffect, useRef, useState } from "react";
import { createOpenNode, type OpenNodeInstance } from "@open-node/embed";
import type { OpenNodeProject } from "@open-node/model";
import type { NodeDefinition } from "@open-node/sdk";
import { api } from "./api";
import { ConfirmDialog, Modal, formatDate, shortHash } from "./components";
import type { RevisionSummary } from "./types";

type Notify = (message: string, kind?: "success" | "error" | "info") => void;

interface TopologyPayload {
  revision: string;
  checksum: string;
  actor: string;
  reason: string;
  source_revision: string | null;
  created_at: string;
  project: OpenNodeProject;
}

const architectureNodes: NodeDefinition[] = [{
    typeId: "exocortex.architecture.module",
    version: "1.0.0",
    displayName: "module",
    description: "Editable module for a conceptual architecture map.",
    category: "MODULE",
    tags: ["architecture", "visual", "text"],
    defaultColor: "#ffffff",
    inputs: [{
      id: "in",
      label: "In",
      kind: "data",
      typeId: "core.any",
      multiple: true,
    }],
    outputs: [{
      id: "out",
      label: "Out",
      kind: "data",
      typeId: "core.any",
      multiple: true,
    }],
    parameters: [{ id: "content", label: "Text", control: "text" }],
    pure: true,
    containerCompatible: true,
    bypass: { strategy: "unsupported" },
    createDefaultParams: () => ({ content: "" }),
    validate: () => ({ valid: true, issues: [] }),
    // Open Node validates every definition at registration time. Execution is
    // disabled by visualOnly, but the registry still requires an implementation.
    execute: async () => ({ outputs: {} }),
    containerAdapter: async ({ value }) => value,
  }, {
    typeId: "exocortex.architecture.document",
    version: "1.0.0",
    displayName: "document",
    description: "Attach a PDF, Markdown, DOCX, or versioned graph project.",
    category: "DOCUMENT",
    tags: ["architecture", "visual", "browser-document"],
    defaultColor: "#ffffff",
    inputs: [{
      id: "in",
      label: "In",
      kind: "data",
      typeId: "core.any",
      multiple: true,
    }],
    outputs: [{
      id: "out",
      label: "Out",
      kind: "data",
      typeId: "core.any",
      multiple: true,
    }],
    parameters: [{
      id: "assetId",
      label: "File",
      control: "file",
      accept: [".pdf", ".md", ".docx", ".onode", ".onode.json"],
    }],
    pure: true,
    containerCompatible: false,
    bypass: { strategy: "unsupported" },
    capabilities: { preview: true },
    createDefaultParams: () => ({ assetId: "" }),
    validate: () => ({ valid: true, issues: [] }),
    execute: async () => ({ outputs: {} }),
  }];

export function TopologyPage({ notify }: { notify: Notify }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<OpenNodeInstance | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const [metadata, setMetadata] = useState<Omit<TopologyPayload, "project">>();
  const [status, setStatus] = useState("Loading map...");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<RevisionSummary[]>([]);
  const [restore, setRestore] = useState<RevisionSummary>();
  const [restorePending, setRestorePending] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    const save = async (project: OpenNodeProject, visibleFeedback = false) => {
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
        if (!disposed) {
          const { project: _project, ...meta } = result;
          setMetadata(meta);
          setStatus("Saved");
          if (visibleFeedback) notify("Topology Map saved");
        }
      } catch (error) {
        if (!disposed) {
          setStatus("Save failed");
          notify((error as Error).message, "error");
        }
      } finally {
        savingRef.current = false;
        if (queuedRef.current && instanceRef.current && !disposed) {
          queuedRef.current = false;
          void save(instanceRef.current.serialize());
        }
      }
    };

    api<TopologyPayload>("/api/topology")
      .then((payload) => {
        if (disposed || !mountRef.current) return;
        const { project, ...meta } = payload;
        setMetadata(meta);
        setStatus("Saved");
        const editor = createOpenNode({
          container: mountRef.current,
          mode: "embedded-edit",
          project,
          nodeDefinitions: architectureNodes,
          registerCoreNodes: false,
          visualOnly: true,
          onSaveRequest: async (current) => save(current, true),
        });
        instanceRef.current = editor;
        editor.on<{ reason?: string }>("projectChanged", (event) => {
          if (event.detail?.reason === "load") return;
          window.clearTimeout(saveTimerRef.current);
          setStatus("Modified");
          saveTimerRef.current = window.setTimeout(() => {
            if (instanceRef.current) void save(instanceRef.current.serialize());
          }, event.detail?.reason === "viewport" ? 1800 : 900);
        });
      })
      .catch((error: Error) => {
        setStatus("Map unavailable");
        notify(error.message, "error");
      });

    return () => {
      disposed = true;
      window.clearTimeout(saveTimerRef.current);
      const editor = instanceRef.current;
      instanceRef.current = undefined;
      if (editor) void editor.destroy();
    };
  }, [notify, reload]);

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

  return (
    <section className="topology-page">
      <div className="topology-meta">
        <span>{status}</span>
        <span>Revision {metadata?.revision ?? "—"}</span>
        <span>SHA-256 {shortHash(metadata?.checksum)}</span>
        <span>{formatDate(metadata?.created_at)}</span>
        <span className="topology-hint">Left Alt — Library · Ctrl+S — Save</span>
        <button type="button" className="topology-versions" onClick={openHistory}>
          Versions
        </button>
      </div>
      <div className="topology-canvas" ref={mountRef} />

      {historyOpen && (
        <Modal title="TOPOLOGY VERSIONS" width={900} onClose={() => setHistoryOpen(false)}>
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
          title="RESTORE TOPOLOGY"
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
