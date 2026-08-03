# Web-triggered service updates

Status: implemented baseline.

## Deployment model

Kernel, Perimetr and future head services may run on different VPSs and behind
different SNI names. Every VPS runs its own local `updater` systemd service.
There is no central updater and updater instances never communicate with one
another.

```text
Kernel VPS                           Perimetr VPS
Kernel UI -> /run/.../updater.sock   Perimetr UI -> /run/.../updater.sock
                    |                                    |
              local updater                         local updater
                    |                                    |
              local Docker                          local Docker
```

One updater may serve several heads only when those heads share a VPS. Each
head has a separate registered profile and `UPDATER_CONTROL_TOKEN`. The profile
points to the head's existing `.env`; updater has no service-specific `.env`.
Installing another head registers it with the existing host-wide updater; it
does not create a second daemon, socket, state directory, or systemd unit.

The browser never connects to updater. It uses the authenticated API of its
head service. Kernel and Perimetr never receive the Docker socket.

## Repository discovery

The head's Settings page may check GitHub only after an explicit operator
action. Installing a release is delegated through the local Unix socket.

Updater reads these values from Kernel Register:

- `repositories.kernel.url`
- `repositories.perimetr.url`
- `repositories.updater.url` for manual updater self-update

There are no duplicate repository URLs in local service `.env` files. Updater
validates and caches the last-known-good Register snapshot, so a temporary
Kernel outage does not prevent an already configured service update.

## Release artifact

Kernel and Perimetr publish immutable OCI images and a signed service manifest:

```json
{
  "schema_version": 1,
  "service": "kernel",
  "version": "1.4.0",
  "channel": "stable",
  "image": {
    "reference": "ghcr.io/example/exocortex/kernel",
    "digest": "sha256:..."
  },
  "compose_bundle": {
    "url": "https://github.com/example/exocortex/releases/download/kernel-v1.4.0/kernel-1.4.0-compose.tar.gz",
    "sha256": "..."
  },
  "minimum_updater_version": "1.0.0",
  "database_schema": 3,
  "release_notes_url": "https://github.com/example/exocortex/releases/tag/kernel-v1.4.0"
}
```

Production does not clone or build a repository. The updater verifies the
manifest Sigstore bundle, compose checksum and exact OCI image digest.

## Update flow

1. The operator checks for a release in the head Settings page.
2. The head checks local updater status through the Unix socket. If it is not
   installed, release discovery remains available but installation is blocked
   with a visible notification.
3. The operator confirms an exact version.
4. The head creates a full backup, stores the server copy, starts the browser
   download, calculates its checksum and submits it to updater.
5. Updater authenticates the head with its control token and rejects unknown
   heads, services, URLs, images and shell commands.
6. Updater gets the service repository from current or last-known-good Register,
   resolves the exact signed `<service>-v*` release and verifies all artifacts.
7. It records the current image, pulls the replacement by digest and changes
   only the allow-listed image variable in the head `.env`.
8. It recreates only the target Compose service. Persistent volumes and other
   running services remain untouched.
9. Local and optional public health checks gate completion.
10. On failure updater restores the prior image, recreates the service, imports
    the backup through the local protected restore endpoint and checks health.

Jobs and idempotency keys are persisted under `/var/lib/updater`.

## Availability

Replacing one Compose replica can briefly interrupt new HTTP connections.
Unrelated containers and already running processes are not stopped. Services
using Kernel continue with their last-known-good Register revision. Literal
zero-downtime HTTP requires multiple compatible replicas behind a reverse proxy
and is outside the single-VPS baseline.

## Local API boundary

The API exists only on `/run/exocortex/updater.sock`:

```text
GET  /v1/health
GET  /v1/version
GET  /v1/services
GET  /v1/jobs
GET  /v1/jobs/{job_id}
POST /v1/updates
POST /v1/jobs/{job_id}/rollback
```

Mutation calls require the registered head's `UPDATER_CONTROL_TOKEN`. Unix
socket ownership provides the outer host boundary.

## Installation and self-update

Kernel and Perimetr release archives contain the updater binary, systemd unit
and installer. Their install scripts register the local head and start updater.
Manual installation remains possible.

`updater update [--head <id>]` is the only self-update trigger. It obtains
`repositories.updater.url` from Register, downloads a signed `updater-v*`
release, atomically replaces its binary, restarts itself, checks the socket and
rolls the binary back if health verification fails.
