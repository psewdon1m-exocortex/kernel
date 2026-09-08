import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { api, ApiError } from "./api";
import { Notices } from "./components";
import { DocumentationPage } from "./DocumentationPage";
import { DashboardPage, DocumentPage, RegisterPage, SettingsPage } from "./pages";
import type { NoticeMessage, Session, UiSettings, ViewName } from "./types";

const TopologyPage = lazy(async () => {
  const module = await import("./TopologyPage");
  return { default: module.TopologyPage };
});

type PrimaryView = Exclude<ViewName, "documentation">;

const NAVIGATION: Array<{ id: PrimaryView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "overview", label: "Overview" },
  { id: "topology", label: "Topology Map" },
  { id: "register", label: "Register" },
  { id: "constitution", label: "Constitution" },
  { id: "settings", label: "Settings" },
];

const DEFAULT_SETTINGS: UiSettings = {
  colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
  sidebar_auto_hide: false,
  revision_request_logging: true,
  presentation: {
    navigation_order: NAVIGATION.map((item) => item.id),
    dashboard_order: [
      "cpu", "ram", "disk", "uptime",
      "service-kernel", "service-chronos", "service-perimetr",
      "service-saturn", "service-laboratory", "service-volt",
    ],
    settings_order: ["appearance", "security", "backup", "updates", "logs", "documents"],
  },
  audit_limits: {
    max_entries: 10000,
    retention_days: 30,
    max_bytes: 64 * 1024 * 1024,
    stored_bytes: 0,
  },
};

function readView(): ViewName {
  const candidate = window.location.hash.replace(/^#\/?/, "") as ViewName;
  return candidate === "documentation" || NAVIGATION.some((item) => item.id === candidate)
    ? candidate
    : "dashboard";
}

export function App() {
  const [session, setSession] = useState<Session | null>();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [previewAccent, setPreviewAccent] = useState<string>();
  const [view, setView] = useState<ViewName>(readView);
  const [notices, setNotices] = useState<NoticeMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragNav, setDragNav] = useState<PrimaryView>();
  const [insertNav, setInsertNav] = useState<{ id: PrimaryView; after: boolean }>();
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");

  const notify = useCallback((message: string, kind: "success" | "error" | "info" = "success") => {
    const id = crypto.randomUUID();
    setNotices((current) => [...current, { id, message, kind }].slice(-5));
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, kind === "error" ? 8000 : 4500);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const appearance = await api<Pick<UiSettings, "colors">>("/api/appearance");
        if (active) setSettings((current) => ({ ...current, colors: appearance.colors }));
      } catch {
        // Fixed monochrome defaults remain usable while the service is starting.
      }
      try {
        const value = await api<Session>("/api/auth/session");
        if (!active) return;
        setSession(value);
        setSettings(await api<UiSettings>("/api/settings"));
      } catch (error) {
        if (!active) return;
        setSession(null);
        if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
          notify((error as Error).message, "error");
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [notify]);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.history.replaceState(null, "", "#/dashboard");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dark", "#000000");
    root.style.setProperty("--light", "#ffffff");
    root.style.setProperty("--accent", previewAccent ?? settings.colors.accent);
  }, [previewAccent, settings.colors.accent]);

  const orderedNavigation = useMemo(() => settings.presentation.navigation_order.map(
    (id) => NAVIGATION.find((item) => item.id === id)!,
  ), [settings.presentation.navigation_order]);

  const persistSettings = useCallback(async (next: UiSettings, message?: string) => {
    setSettings(next);
    try {
      const saved = await api<UiSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setSettings(saved);
      if (message) notify(message);
      return saved;
    } catch (error) {
      notify((error as Error).message, "error");
      try { setSettings(await api<UiSettings>("/api/settings")); } catch { /* keep last usable state */ }
      return next;
    }
  }, [notify]);

  const navigate = (next: ViewName) => {
    window.location.hash = `/${next}`;
    setView(next);
    setSidebarOpen(false);
  };

  const moveNavigation = (source: PrimaryView, target: PrimaryView, after: boolean) => {
    if (source === target) return;
    const nextOrder = settings.presentation.navigation_order.filter((id) => id !== source);
    let index = nextOrder.indexOf(target);
    if (after) index += 1;
    nextOrder.splice(index, 0, source);
    const next = { ...settings, presentation: { ...settings.presentation, navigation_order: nextOrder } };
    setDragNav(undefined);
    setInsertNav(undefined);
    setReorderAnnouncement(`${NAVIGATION.find((item) => item.id === source)?.label} moved to position ${index + 1}`);
    void persistSettings(next, "Navigation order saved");
  };

  const moveNavigationByKeyboard = (id: PrimaryView, delta: -1 | 1) => {
    const order = settings.presentation.navigation_order;
    const current = order.indexOf(id);
    const target = current + delta;
    if (target < 0 || target >= order.length) return;
    moveNavigation(id, order[target], delta > 0);
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setSession(null);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  if (session === undefined) {
    return <div className="boot-screen"><span className="boot-cursor" /> Initializing KERNEL</div>;
  }
  if (!session) return <LoginScreen onLogin={setSession} notify={notify} />;

  const pageLabel = view === "documentation"
    ? "Documentation"
    : NAVIGATION.find((item) => item.id === view)?.label;

  return (
    <div className={`kernel-ui kernel-shell ${settings.sidebar_auto_hide ? "sidebar-auto" : "sidebar-fixed"} ${sidebarOpen ? "sidebar-force-open" : ""}`}>
      <button className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>Menu</button>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <div className="sidebar-activation" onPointerEnter={() => setSidebarOpen(true)} aria-hidden="true" />
      <aside className="sidebar" onPointerEnter={() => setSidebarOpen(true)} onPointerLeave={() => settings.sidebar_auto_hide && setSidebarOpen(false)}>
        <header className="kernel-brand"><img src="/kernel-logo.png" alt="" /><span>KERNEL</span></header>
        <nav aria-label="Primary navigation">
          {orderedNavigation.map((item, index) => (
            <button
              key={item.id}
              type="button"
              draggable
              className={`nav-item ${view === item.id ? "is-active" : ""} ${insertNav?.id === item.id ? (insertNav.after ? "insert-after" : "insert-before") : ""}`}
              onClick={() => navigate(item.id)}
              onKeyDown={(event) => {
                if (event.ctrlKey && event.key === "ArrowUp") {
                  event.preventDefault();
                  moveNavigationByKeyboard(item.id, -1);
                } else if (event.ctrlKey && event.key === "ArrowDown") {
                  event.preventDefault();
                  moveNavigationByKeyboard(item.id, 1);
                }
              }}
              onDragStart={() => setDragNav(item.id)}
              onDragEnd={() => { setDragNav(undefined); setInsertNav(undefined); }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setInsertNav({ id: item.id, after: event.clientY > rect.top + rect.height / 2 });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragNav) moveNavigation(dragNav, item.id, insertNav?.after ?? false);
              }}
              title="Drag, or use Ctrl+Arrow Up/Down to reorder"
            >
              <span>{item.label}</span><small>{String(index + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-operator">
          <button type="button" className={view === "documentation" ? "is-active" : ""} onClick={() => navigate("documentation")}>Documentation</button>
          <button type="button" className="logout-button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>

      <main className={`main-content view-${view}`}>
        <header className="page-title"><h1>{pageLabel}</h1></header>
        <div className="page-surface">
          {view === "dashboard" && <DashboardPage settings={settings} onSettings={persistSettings} notify={notify} />}
          {view === "overview" && <DocumentPage type="overview" />}
          {view === "topology" && (
            <Suspense fallback={<div className="loading-panel">Loading visual map...</div>}>
              <TopologyPage notify={notify} />
            </Suspense>
          )}
          {view === "register" && <RegisterPage notify={notify} />}
          {view === "constitution" && <DocumentPage type="constitution" />}
          {view === "settings" && (
            <SettingsPage settings={settings} onSettings={persistSettings} onPreviewAccent={setPreviewAccent} notify={notify} />
          )}
          {view === "documentation" && <DocumentationPage />}
        </div>
      </main>
      <span className="sr-only" aria-live="polite">{reorderAnnouncement}</span>
      <Notices notices={notices} dismiss={(id) => setNotices((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}

function LoginScreen({ onLogin, notify }: {
  onLogin(session: Session): void;
  notify(message: string, kind?: "success" | "error" | "info"): void;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reachable, setReachable] = useState<boolean>();

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/api/appearance", { cache: "no-store" });
        if (active) setReachable(response.ok);
      } catch {
        if (active) setReachable(false);
      }
    };
    void check();
    const timer = window.setInterval(check, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const value = await api<Session>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ access_key: accessKey }),
      });
      onLogin({ ...value, kind: "operator" });
      setAccessKey("");
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      notify(message, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="kernel-ui login-screen">
      <div className="login-composition">
        <header className="login-brand" aria-label="KERNEL">
          <h1>KERNEL</h1>
          <img className="login-mark" src="/kernel-logo.png" alt="" />
        </header>
        <section className="login-panel">
          <div className={`login-availability ${reachable === true ? "is-available" : reachable === false ? "is-unavailable" : ""}`} role="status" aria-live="polite">
            <span>{reachable === true ? "Service Reachability" : reachable === false ? "Service Unavailable" : "Checking Service"}</span>
            <span className="login-availability-spinner" aria-hidden="true" />
          </div>
          <form onSubmit={login}>
          <label><span className="sr-only">Access Key</span><input autoFocus type="password" aria-label="Access Key" placeholder="Access Key..." autoComplete="current-password" required value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={pending || !accessKey}>{pending ? "Entering..." : "Enter service"}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
