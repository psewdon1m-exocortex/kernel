import { isValidElement, useMemo, useState, type ReactNode } from "react";

interface DocumentationSection {
  id: string;
  group: "Get Started" | "Operate" | "Maintain";
  title: string;
  search: string;
  content: ReactNode;
}

const SECTIONS: DocumentationSection[] = [
  {
    id: "docs-introduction",
    group: "Get Started",
    title: "Introduction",
    search: "purpose passive kernel architecture one vps internal services last-known-good cached verified snapshot unavailable",
    content: (
      <>
        <p>Kernel is the passive configuration and governance service for one Exocortex VPS. It accepts requests from authenticated operators and internal services, returns versioned data, and never initiates calls to external systems.</p>
        <div className="documentation-note">Kernel availability is not a runtime dependency. Every consumer must cache a verified snapshot and continue with its last-known-good revision while Kernel is unavailable.</div>
      </>
    ),
  },
  {
    id: "docs-requirements",
    group: "Get Started",
    title: "System Requirements",
    search: "requirements docker compose nginx https tls cpu ram disk ports",
    content: (
      <>
        <ul>
          <li>Linux VPS with Docker Engine and Docker Compose v2.</li>
          <li>An HTTPS hostname terminated by the host Nginx reverse proxy.</li>
          <li>A writable persistent data directory for SQLite, revisions, backups, and bounded audit logs.</li>
          <li>A modern browser for the operator interface.</li>
        </ul>
        <p>Only the reverse proxy should expose the public HTTPS endpoint. The application port remains a host-local service port.</p>
      </>
    ),
  },
  {
    id: "docs-installation",
    group: "Get Started",
    title: "Installation",
    search: "installation env docker compose nginx login username password token",
    content: (
      <>
        <h3>1. Configure Environment</h3>
        <p>Set the operator login, password, session secret, service token, local application port, canonical public URL, and persistent paths in <code>kernel/.env</code>. TLS certificates and the public SNI belong to the shared host Nginx configuration, not to Kernel.</p>
        <h3>2. Start Kernel</h3>
        <pre>{`cd kernel
docker compose up -d --build
docker compose ps`}</pre>
        <h3>3. Verify</h3>
        <p>Route the Kernel SNI to its loopback port through the shared host Nginx, open the HTTPS hostname, sign in, and confirm that Dashboard telemetry and Register are available.</p>
      </>
    ),
  },
  {
    id: "docs-first-run",
    group: "Get Started",
    title: "First Run",
    search: "first run appearance credentials register backup documents",
    content: (
      <ol>
        <li>Sign in with the username and password from the environment.</li>
        <li>Confirm the dark, light, and accent colors in Settings.</li>
        <li>Review Register values and publish only non-secret shared configuration.</li>
        <li>Upload the current Overview and Constitution from the local device.</li>
        <li>Create and download a complete backup before production use.</li>
      </ol>
    ),
  },
  {
    id: "docs-documents",
    group: "Operate",
    title: "Documents",
    search: "overview constitution markdown upload revision history restore device",
    content: (
      <>
        <p>Overview and Constitution are human-readable Markdown documents. The active revision is rendered in its page; changes are accepted only through a file upload from the operator device.</p>
        <p>Every upload and restore creates a new immutable revision. Restore never overwrites historical content.</p>
      </>
    ),
  },
  {
    id: "docs-register",
    group: "Operate",
    title: "Register",
    search: "register key value snapshot etag checksum revision 304 service token",
    content: (
      <>
        <p>Register stores shared, changeable configuration such as repository addresses, service SNI names, and client-facing service ports. It must not contain ordinary local settings or general-purpose secrets.</p>
        <table className="documentation-table">
          <thead><tr><th>Consumer</th><th>Request behavior</th><th>Failure behavior</th></tr></thead>
          <tbody>
            <tr><td>Operator</td><td>Reads and edits entries through the web interface.</td><td>The UI reports the request error and preserves entered values.</td></tr>
            <tr><td>Internal service</td><td>Uses the service token and conditional ETag refresh.</td><td>Continues with a checksum-verified last-known-good snapshot.</td></tr>
          </tbody>
        </table>
        <p>A successful edit publishes a new Register revision. A conditional request returns <code>304 Not Modified</code> when the revision has not changed.</p>
      </>
    ),
  },
  {
    id: "docs-topology",
    group: "Operate",
    title: "Topology Map",
    search: "topology map open node conceptual visual containers nodes drag save",
    content: (
      <>
        <p>Topology Map is a conceptual drawing surface based on the visual layer of Open Node. It does not discover infrastructure, represent live state, or execute nodes.</p>
        <ul>
          <li>The initial Library contains one editable white module Node and one empty Container.</li>
          <li>Resize a module to resize its empty free-text canvas with it.</li>
          <li>Place persistent shapes, arrows, brush strokes, and text annotations anywhere on the Canvas.</li>
          <li>Drag nodes and containers to arrange the conceptual architecture.</li>
          <li>Place nodes inside containers to establish visual containment.</li>
          <li>Use the map controls or <code>Ctrl+S</code> to save a new revision.</li>
        </ul>
      </>
    ),
  },
  {
    id: "docs-machine",
    group: "Operate",
    title: "Machine And Service Access",
    search: "dashboard metrics cpu ram disk uptime api service authentication",
    content: (
      <>
        <p>Dashboard reads local VPS CPU, RAM, disk, and system uptime. These metrics remain operator-only and are not part of the Register snapshot.</p>
        <p>Internal services authenticate with the shared service token and receive read-only published data. Operator endpoints require the browser session and never accept the service token as a substitute.</p>
      </>
    ),
  },
  {
    id: "docs-settings",
    group: "Maintain",
    title: "Settings",
    search: "settings appearance sidebar documents backup updater logger security",
    content: (
      <ul>
        <li><strong>Appearance:</strong> dark, light, and accent colors plus Sidebar behavior.</li>
        <li><strong>Documents:</strong> local upload, revision history, and restore.</li>
        <li><strong>Backup:</strong> complete archive creation, download, and restore.</li>
        <li><strong>Updater:</strong> repository refresh and release availability check.</li>
        <li><strong>Logger:</strong> revision request logging, bounded retention, and diagnostic export.</li>
      </ul>
    ),
  },
  {
    id: "docs-backup",
    group: "Maintain",
    title: "Backup And Restore",
    search: "backup archive zip download restore recovery revision database",
    content: (
      <>
        <p>Create Backup produces a downloadable ZIP containing the persistent system state and a machine-readable manifest. Store the archive as sensitive operational material.</p>
        <p>Import Backup validates the archive before replacing live state. Always preserve a separate copy and verify the restored Dashboard, documents, Register revision, and settings.</p>
      </>
    ),
  },
  {
    id: "docs-api",
    group: "Maintain",
    title: "API And Logger",
    search: "api logger audit retention zip errors json manifest request 304",
    content: (
      <>
        <p>Logger shows compact operator and internal-service events. Retention is simultaneously bounded by age, event count, and disk usage.</p>
        <p><code>Download Logs Zip</code> exports raw events, a manifest, and a separate detailed error document. The web stream intentionally shows a shorter error summary.</p>
      </>
    ),
  },
  {
    id: "docs-troubleshooting",
    group: "Maintain",
    title: "Troubleshooting",
    search: "troubleshooting unavailable 401 403 stale last known good logs health",
    content: (
      <>
        <h3>Kernel Does Not Open</h3>
        <pre>{`docker compose ps
docker compose logs --tail=200 kernel`}</pre>
        <h3>Service Receives 401 Or 403</h3>
        <p>Confirm that the service uses the current Kernel service token and requests a read-only service endpoint. Operator endpoints require a browser session.</p>
        <h3>Consumer Uses An Old Revision</h3>
        <p>Check the consumer cache checksum and its last successful refresh. A valid cached revision is expected during Kernel downtime; a checksum failure must prevent the new snapshot from replacing it.</p>
      </>
    ),
  },
];

const GROUPS: DocumentationSection["group"][] = ["Get Started", "Operate", "Maintain"];

function documentationText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(documentationText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return documentationText(node.props.children);
  return "";
}

export function DocumentationPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleIds = useMemo(() => new Set(
    SECTIONS
      .filter((section) => (
        !normalizedQuery
        || `${section.title} ${section.search} ${documentationText(section.content)}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      ))
      .map((section) => section.id),
  ), [normalizedQuery]);

  return (
    <div className="documentation-page">
      <aside className="documentation-nav">
        <div className="documentation-nav-inner">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder="Search documentation"
            aria-label="Search documentation"
          />
          {GROUPS.map((group) => (
            <div className="documentation-nav-group" key={group}>
              <strong>{group}</strong>
              {SECTIONS.filter((section) => section.group === group && visibleIds.has(section.id)).map((section) => (
                <button
                  type="button"
                  className="documentation-link"
                  onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  key={section.id}
                >
                  {section.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="documentation-content">
        <header>
          <span className="documentation-kicker">Kernel / Operator Guide</span>
          <h2>Welcome To Kernel</h2>
          <p>A practical guide to installing, configuring, operating, backing up, and diagnosing the passive Exocortex registry.</p>
        </header>
        {SECTIONS.filter((section) => visibleIds.has(section.id)).map((section) => (
          <article id={section.id} data-doc-title={`${section.title} ${section.search}`} key={section.id}>
            <h2>{section.title}</h2>
            {section.content}
          </article>
        ))}
        {visibleIds.size === 0 && <div className="documentation-empty">No documentation sections match this search.</div>}
      </div>
    </div>
  );
}
