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
import {
  DashboardPage,
  DocumentPage,
  RegisterPage,
  SettingsPage,
} from "./pages";
import type {
  NoticeMessage,
  Session,
  UiSettings,
  ViewName,
} from "./types";

const TopologyPage = lazy(async () => {
  const module = await import("./TopologyPage");
  return { default: module.TopologyPage };
});

const NAVIGATION: Array<{ id: ViewName; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "overview", label: "Overview" },
  { id: "topology", label: "Topology Map" },
  { id: "register", label: "Register" },
  { id: "constitution", label: "Constitution" },
  { id: "settings", label: "Settings" },
];

const DEFAULT_SETTINGS: UiSettings = {
  colors: { dark: "#000000", light: "#ffffff", accent: "#00a8ff" },
  sidebar_auto_hide: true,
  revision_request_logging: true,
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

function readNavigationOrder() {
  try {
    const value = JSON.parse(localStorage.getItem("kernel.navigation.order") ?? "null");
    const known = new Set(NAVIGATION.map((item) => item.id));
    return Array.isArray(value)
      && value.length === NAVIGATION.length
      && value.every((item) => known.has(item))
      ? value as ViewName[]
      : NAVIGATION.map((item) => item.id);
  } catch {
    return NAVIGATION.map((item) => item.id);
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState<ViewName>(readView);
  const [notices, setNotices] = useState<NoticeMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navigationOrder, setNavigationOrder] = useState<ViewName[]>(readNavigationOrder);
  const [dragNav, setDragNav] = useState<ViewName>();
  const [insertNav, setInsertNav] = useState<{ id: ViewName; after: boolean }>();

  const notify = useCallback((
    message: string,
    kind: "success" | "error" | "info" = "success",
  ) => {
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
        if (active) {
          setSettings((current) => ({ ...current, colors: appearance.colors }));
        }
      } catch {
        // Keep the local defaults when the appearance endpoint is unavailable.
      }

      try {
        const value = await api<Session>("/api/auth/session");
        if (!active) return;
        setSession(value);
        const fullSettings = await api<UiSettings>("/api/settings");
        if (active) setSettings(fullSettings);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setSession(null);
        } else {
          setSession(null);
          notify((error as Error).message, "error");
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [notify]);

  useEffect(() => {
    const onHash = () => setView(readView());
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.history.replaceState(null, "", "#/dashboard");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dark", settings.colors.dark);
    root.style.setProperty("--light", settings.colors.light);
    root.style.setProperty("--accent", settings.colors.accent);
  }, [settings]);

  useEffect(() => {
    const smartScale = (event: Event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".kernel-ui button,.kernel-ui .button-link,.kernel-ui .nav-item,.kernel-ui .register-card",
      );
      if (!target || target.closest(".on-editor")) return;
      const rect = target.getBoundingClientRect();
      const grow = Math.min(rect.width, rect.height) * 0.05;
      target.style.setProperty("--hover-scale-x", String((rect.width + grow) / rect.width));
      target.style.setProperty("--hover-scale-y", String((rect.height + grow) / rect.height));
    };
    document.addEventListener("pointerover", smartScale);
    document.addEventListener("focusin", smartScale);
    return () => {
      document.removeEventListener("pointerover", smartScale);
      document.removeEventListener("focusin", smartScale);
    };
  }, []);

  const orderedNavigation = useMemo(() => (
    navigationOrder.map((id) => NAVIGATION.find((item) => item.id === id)!)
  ), [navigationOrder]);

  const navigate = (next: ViewName) => {
    window.location.hash = `/${next}`;
    setView(next);
    setSidebarOpen(false);
  };

  const commitNavigation = (target: ViewName, after: boolean) => {
    if (!dragNav || dragNav === target) return;
    const next = navigationOrder.filter((id) => id !== dragNav);
    let index = next.indexOf(target);
    if (after) index += 1;
    next.splice(index, 0, dragNav);
    setNavigationOrder(next);
    localStorage.setItem("kernel.navigation.order", JSON.stringify(next));
    setDragNav(undefined);
    setInsertNav(undefined);
    notify("Navigation order saved");
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
    return <div className="boot-screen"><span className="boot-cursor" /> INITIALIZING KERNEL</div>;
  }

  if (!session) {
    return <LoginScreen onLogin={setSession} notify={notify} />;
  }

  return (
    <div
      className={`kernel-ui kernel-shell ${settings.sidebar_auto_hide ? "sidebar-auto" : "sidebar-fixed"} ${sidebarOpen ? "sidebar-force-open" : ""}`}
    >
      <button
        className="mobile-menu"
        aria-label="Open navigation"
        title="Navigation"
        onClick={() => setSidebarOpen((value) => !value)}
      >
        MENU
      </button>
      <div
        className="sidebar-activation"
        onPointerEnter={() => setSidebarOpen(true)}
        aria-hidden="true"
      />
      <aside
        className="sidebar"
        onPointerEnter={() => setSidebarOpen(true)}
        onPointerLeave={() => settings.sidebar_auto_hide && setSidebarOpen(false)}
      >
        <header className="kernel-brand">
          <span>KERNEL</span>
        </header>
        <nav aria-label="Primary navigation">
          {orderedNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              draggable
              className={`nav-item ${view === item.id ? "is-active" : ""} ${insertNav?.id === item.id ? (insertNav.after ? "insert-after" : "insert-before") : ""}`}
              onClick={() => navigate(item.id)}
              onDragStart={() => setDragNav(item.id)}
              onDragEnd={() => {
                setDragNav(undefined);
                setInsertNav(undefined);
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setInsertNav({ id: item.id, after: event.clientY > rect.top + rect.height / 2 });
              }}
              onDrop={(event) => {
                event.preventDefault();
                commitNavigation(item.id, insertNav?.after ?? false);
              }}
            >
              <span>{item.label}</span>
              <small>{String(orderedNavigation.indexOf(item) + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-operator">
          <button
            type="button"
            className={view === "documentation" ? "is-active" : ""}
            onClick={() => navigate("documentation")}
          >
            Documentation
          </button>
          <button type="button" className="logout-button" onClick={() => void logout()}>Logout</button>
        </div>
      </aside>

      <main className={`main-content view-${view}`}>
        <header className="page-title">
          <h1>{view === "documentation" ? "Documentation" : NAVIGATION.find((item) => item.id === view)?.label}</h1>
        </header>
        <div className="page-surface">
          {view === "dashboard" && <DashboardPage />}
          {view === "overview" && <DocumentPage type="overview" />}
          {view === "topology" && (
            <Suspense fallback={<div className="loading-panel">Loading visual map...</div>}>
              <TopologyPage notify={notify} />
            </Suspense>
          )}
          {view === "register" && <RegisterPage notify={notify} />}
          {view === "constitution" && <DocumentPage type="constitution" />}
          {view === "settings" && (
            <SettingsPage
              settings={settings}
              onSettings={setSettings}
              notify={notify}
            />
          )}
          {view === "documentation" && <DocumentationPage />}
        </div>
      </main>

      <Notices
        notices={notices}
        dismiss={(id) => setNotices((current) => current.filter((item) => item.id !== id))}
      />
    </div>
  );
}

function LoginScreen({
  onLogin,
  notify,
}: {
  onLogin(session: Session): void;
  notify(message: string, kind?: "success" | "error" | "info"): void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    const checkAvailability = async () => {
      try {
        const health = await api<{ status: string }>("/api/health");
        if (active) setAvailable(health.status === "ok");
      } catch {
        if (active) setAvailable(false);
      }
    };
    void checkAvailability();
    const timer = window.setInterval(() => void checkAvailability(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const session = await api<Session>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin({ ...session, kind: "operator" });
      setUsername("");
      setPassword("");
    } catch (error) {
      const message = (error as Error).message;
      if (!(error instanceof ApiError)) setAvailable(false);
      setError(message);
      notify(message, "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="kernel-ui login-screen">
      <section className="login-panel">
        <header className="login-header">
          <h1 aria-label="KERNEL">
            {"KERNEL".split("").map((letter, index) => (
              <span key={`${letter}-${index}`} aria-hidden="true">{letter}</span>
            ))}
          </h1>
          <div
            className={`login-availability ${available ? "is-available" : "is-unavailable"}`}
            role="status"
            aria-live="polite"
          >
            {available && <span className="login-availability-spinner" aria-hidden="true" />}
            <span>{available ? "AVAILABLE" : "UNAVAILABLE"}</span>
          </div>
        </header>
        <form
          onSubmit={login}
          onKeyDown={(event) => {
            if (
              event.key === "Enter"
              && !event.shiftKey
              && !pending
              && username
              && password
            ) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <label>
            <input
              autoFocus
              type="text"
              aria-label="Login"
              placeholder="Login"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            <input
              type="password"
              aria-label="Password"
              placeholder="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={pending || !username || !password}>
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
      <Notices notices={[]} dismiss={() => undefined} />
    </main>
  );
}
