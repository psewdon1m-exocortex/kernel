const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value) {
  const match = String(value ?? "").trim().match(SEMVER);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function parseGitHubRepository(repositoryUrl) {
  let parsed;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw Object.assign(new Error("Repository URL is invalid"), { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw Object.assign(new Error("Updater currently supports HTTPS GitHub repositories"), { status: 400 });
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw Object.assign(new Error("Repository URL must identify a GitHub owner and repository"), { status: 400 });
  }
  return {
    owner: segments[0],
    repository: segments[1].replace(/\.git$/i, ""),
  };
}

function releaseVersion(tagName, service) {
  const tag = String(tagName ?? "");
  const prefixed = tag.match(new RegExp(`^${service}-v(.+)$`, "i"));
  const candidate = prefixed?.[1] ?? tag.replace(/^v/i, "");
  return parseVersion(candidate) ? candidate : null;
}

export async function checkGitHubRelease({
  repositoryUrl,
  service,
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
}) {
  const { owner, repository } = parseGitHubRepository(repositoryUrl);
  const response = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `exocortex-${service}-updater`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) {
    throw Object.assign(
      new Error(`GitHub release check failed with HTTP ${response.status}`),
      { status: response.status === 404 ? 404 : 502 },
    );
  }
  const releases = await response.json();
  if (!Array.isArray(releases)) {
    throw Object.assign(new Error("GitHub returned an invalid releases response"), { status: 502 });
  }
  const prefixed = releases.filter(
    (release) => !release.draft
      && String(release.tag_name ?? "").toLowerCase().startsWith(`${service.toLowerCase()}-v`),
  );
  const candidates = prefixed.length
    ? prefixed
    : releases.filter(
      (release) => !release.draft && /^v\d+\.\d+\.\d+/.test(String(release.tag_name ?? "")),
    );
  const available = candidates
    .map((release) => ({ release, version: releaseVersion(release.tag_name, service) }))
    .filter((item) => item.version)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  return {
    service,
    repository_url: repositoryUrl,
    installed_version: currentVersion,
    available_version: available?.version ?? null,
    update_available: available ? compareVersions(available.version, currentVersion) > 0 : false,
    tag: available?.release.tag_name ?? null,
    release_url: available?.release.html_url ?? null,
    published_at: available?.release.published_at ?? null,
    prerelease: Boolean(available?.release.prerelease),
    apply_via: "updater",
    backup_required: true,
  };
}
