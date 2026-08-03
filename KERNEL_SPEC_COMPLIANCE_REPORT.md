# Kernel internal-services specification compliance report

Date: 2026-07-27  
Specification: `KERNEL_INTERNAL_SERVICES_INTERACTION_SPEC(1).md`

## Executive conclusion

Kernel is a passive single-VPS authority for published Register and
Constitution revisions. Perimetr is currently the only long-running product
service that reads Register periodically. Agent Node communicates only with
Perimetr. Sindri is a local CLI. Pods communicate only with Perimetr.

The original interaction specification still describes direct Agent/Sindri
Kernel access in several examples; that part is intentionally superseded by
the current architecture.

## Active Register contract

| Key | Consumer |
|---|---|
| `repositories.kernel.url` | future host update actor |
| `repositories.perimetr.url` | Perimetr and future host update actor |
| `repositories.agent.url` | provenance/operator reference |
| `repositories.pod.url` | Perimetr Pod assembly |
| `repositories.sindri.url` | provenance/operator reference |
| `repositories.updater.url` | VPS-local Updater self-update and head release dependency |
| `services.kernel.sni` | Perimetr as a Kernel client |
| `services.kernel.port` | Perimetr as a Kernel client |
| `services.kernel.service_token` | distribution to trusted internal services |
| `services.perimetr.sni` | Perimetr canonical public/internal identity |
| `services.perimetr.port` | clients other than Agent; listener remains manual |
| `intervals.kernel.refresh_sec` | Perimetr refresh loop |

`KERNEL_SERVICE_TOKEN` remains the initial local bootstrap credential. Kernel
seeds `services.kernel.service_token` on first start and accepts both the
bootstrap and current distributed value. This avoids a circular lockout when a
service must authenticate before it can read Register.

## Service boundaries

| Service | Kernel relationship |
|---|---|
| Kernel | owns Register, documents, revisions, audit and UI |
| Perimetr | conditional GET + checksum validation + atomic last-known-good cache |
| Agent Node | none; only Perimetr endpoint and heartbeat established at enrollment |
| Sindri | none; own update manifest only |
| Pod | none; receives configuration material from Perimetr |

Agent and Sindri keep their own repository coordinates in their product release
manifests. Neither stores Kernel bootstrap variables. Sindri cannot install,
update or uninstall Agent; Agent refuses to install Sindri when it is absent.

## Revision requests and outage behavior

Perimetr sends `If-None-Match`; unchanged Register revisions return `304
Not Modified`. Kernel Settings contains `revision_request_logging`: when
enabled, every internal-service request is audited, including `304`, source
address, request ID, path and revision.

If Kernel is unavailable, Perimetr continues using its validated atomic
last-known-good snapshot. Kernel never calls another service or repository.

## Perimetr move and Agent recovery

A full Perimetr backup contains Agent Registry, assignments, endpoints,
certificate history, heartbeat/state history, denylist and encrypted controller
identity. Restore keeps command trust and enrollment. The public Perimetr SNI
must remain stable: change DNS to the new VPS, restore the backup, and existing
Agent Nodes resume heartbeat without Kernel or re-enrollment.

## Release lifecycle

- Agent: `agent-node update-check` and `sudo agent-node update`, using
  `agent-release-manifest.json`.
- Sindri: `sindri update`, using `sindri-release-manifest.json`.
- Kernel/Perimetr web updates: separate restricted host updater, signed OCI
  image digests and automatic rollback; see
  `WEB_SERVICE_UPDATE_ARCHITECTURE.md`.

Kernel and Perimetr must not clone and build the full repository on the VPS for
production updates.

## Remaining specification gaps

- The source interaction specification needs a new revision that removes direct
  Agent/Sindri actors and documents the bootstrap/distributed token pair.
- TLS termination is required before any private one-VPS endpoint is exposed.
