# Kernel Internal Services Interaction Specification

**Document status:** Target specification and verification checklist  
**System:** Exocortex  
**Component:** Kernel  
**Version:** 1.1  
**Purpose:** verify the current implementation of Kernel interaction with internal services and define the required changes where the implementation does not match the target model.

---

## 1. Purpose

This document defines how internal Exocortex services must interact with Kernel.

It must be used for:

- architecture review;
- API review;
- implementation verification;
- integration testing;
- security review;
- remediation planning;
- acceptance of the Kernel machine interface.

The document does not describe the Kernel web interface in full. It focuses only on the interaction between Kernel and other internal services.

### 1.1 Current actor boundary (normative amendment)

The following boundary supersedes older Agent and Sindri examples in this
document:

- Perimetr is the only current long-running product service that periodically
  reads Kernel Register.
- Agent Node never contacts Kernel. It communicates only with Perimetr and
  receives its Perimetr endpoint during enrollment.
- A restored Perimetr retains the same public SNI and restores controller
  identity, Agent Registry and endpoint records from a full backup.
- Pod never contacts Kernel; Perimetr injects all required data while assembling
  the Pod.
- Sindri never contacts Kernel and manages only its own release lifecycle.
- Agent and Sindri repository coordinates used for self-update are stored in
  their own signed release manifests.
- `KERNEL_SERVICE_TOKEN` is the local bootstrap trust anchor. Kernel also
  publishes `services.kernel.service_token` for trusted internal services.

---

## 2. Core principle

Kernel is a **read-mostly source of published system configuration and rules**.

```text
Kernel tells services:
- where required resources and services are located;
- which current values must be used;
- which rules govern system operation.

Kernel does not:
- perform the work of other services;
- proxy their ordinary requests;
- participate in every internal operation;
- become a mandatory runtime dependency for every action.
```

Target interaction model:

```text
Local bootstrap
    ↓
Kernel authentication
    ↓
Pull published Register snapshot
    ↓
Pull Constitution snapshot when required
    ↓
Validate
    ↓
Store encrypted last-known-good state
    ↓
Work independently
    ↓
Periodically check for a new revision
```

The source model defines Kernel as a read-mostly configuration and rules source, with revisioned snapshots, local last-known-good caching, pull-based updates and independent operation after synchronization.

---

## 3. Scope

This specification covers:

- service bootstrap;
- machine authentication;
- Register API;
- Constitution API;
- revision and checksum handling;
- pull-based synchronization;
- local caching;
- first-start and degraded behavior;
- publication of changes;
- atomic configuration application;
- storage and delivery of secrets through Register;
- auditing;
- API error contracts;
- verification criteria;
- mandatory integration tests.

This specification does not define:

- business logic of internal services;
- command execution by agents;
- message brokering;
- service-to-service proxying;
- UI design of Overview;
- UI design of Topology Map;
- machine-readable Overview;
- machine-readable Topology Map.

---

## 4. Terms

### 4.1 Kernel

Independent Exocortex service that contains:

- Dashboard;
- Overview;
- Topology Map;
- Register;
- Constitution.

For internal services, only **Register** and **Constitution** are machine interfaces in the current version.

### 4.2 Register

`Register` is the current project name for the former `Register`.

Register is the central published store for:

- endpoints;
- repository URLs;
- repository branches;
- update channels;
- runtime versions;
- feature flags;
- update intervals;
- filesystem paths;
- service names;
- internal URLs;
- configuration values;
- credentials and other secrets.

Register is not a live service-discovery system. It is a revisioned configuration source.

### 4.3 Constitution

`Constitution` is the normative document of Exocortex.

It contains rules for:

- system architecture;
- security;
- data handling;
- secret handling;
- LLM and neural network behavior;
- access;
- logging;
- reversibility;
- inter-module interaction;
- forbidden operations.

The canonical source remains `constitution.md`.

### 4.4 Snapshot

An immutable published representation of Register or Constitution.

A snapshot contains at minimum:

- schema version;
- revision;
- checksum;
- publication time;
- payload.

### 4.5 Last-known-good

The most recent snapshot that:

- was received completely;
- passed checksum verification;
- passed schema validation;
- passed service-specific validation;
- was successfully applied.

### 4.6 Bootstrap

Minimal local configuration required for a service to locate and authenticate to Kernel.

### 4.7 Published revision

The only revision visible to internal services.

Draft or incomplete changes must never be returned by machine read endpoints.

---

## 5. Target architecture

```text
                          ┌──────────────────────┐
                          │  Exocortex Kernel    │
                          │                      │
                          │  Register            │
                          │  Constitution        │
                          │  Overview            │
                          │  Topology Map        │
                          └──────────┬───────────┘
                                     │
                       authenticated read-only API
                                     │
             ┌───────────────────────┼───────────────────────┐
             │                       │                       │
             ▼                       ▼                       ▼
        Sindri / Agents        Storage Service        Cognitive Plane
             │                       │                       │
             ▼                       ▼                       ▼
     repos and updates       endpoints and secrets    rules and config
```

Rules:

1. Services pull data from Kernel.
2. Kernel does not push configuration directly in v1.
3. Services do not query Kernel before every internal action.
4. Services keep a local last-known-good snapshot.
5. Register and Constitution are independent revision streams.
6. Overview and Topology Map are human-facing only in v1.
7. Internal services have read-only access.
8. Configuration mutations are available only through the protected Kernel administration interface.

---

## 6. Bootstrap

Each internal service must have a minimal local bootstrap configuration.

### 6.1 Required values

```env
KERNEL_URL=https://kernel.example.com
KERNEL_SERVICE_TOKEN=replace-with-token
```

Optional:

```env
KERNEL_CACHE_PATH=/var/lib/example-service/kernel-cache
KERNEL_REQUEST_TIMEOUT_MS=10000
```

### 6.2 Explicitly excluded value

The following value is not required and must not be part of the current protocol:

```env
SERVICE_ID=...
```

There is no service-specific Register read scope in the current version.

### 6.3 Bootstrap rules

The bootstrap must not duplicate values that belong in Register.

It must not contain:

- other service endpoints;
- repository URLs;
- repository branches;
- update channels;
- feature flags;
- runtime versions;
- ordinary system paths.

The bootstrap contains only what is necessary to find Kernel, authenticate and locate the local cache.

---

## 7. Authentication model for v1

### 7.1 Machine authentication

All internal services use:

```http
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

### 7.2 No service identity header

The following header must not be required:

```http
X-Service-ID
```

Kernel does not divide Register read rights by service in v1.

### 7.3 Rights

A valid machine token grants:

- full read-only access to the published Register;
- full read-only access to Constitution API;
- access to Kernel health endpoint if authentication is required by deployment policy.

It does not grant:

- Register modification;
- Constitution upload;
- revision restore;
- settings modification;
- document deletion;
- Kernel administration.

### 7.4 Temporary limitation

A shared token and unrestricted Register read access are deliberate simplifications for the current version.

Consequences:

- any internal service with the token can read the complete Register;
- any internal service with the token can read Register secrets;
- Kernel cannot reliably attribute a read request to a specific service;
- compromise of one token compromises the machine-readable Register.

This limitation must be documented and kept isolated so that per-service identities and scopes can be added later without changing the Register payload model.

---

## 8. Register data model

### 8.1 Purpose

Register is the primary machine configuration interface of Kernel.

It may contain:

- ordinary configuration;
- internal network coordinates;
- repository coordinates;
- update information;
- operational intervals;
- feature flags;
- credentials;
- tokens;
- passwords;
- private connection strings;
- other secrets required by internal services.

### 8.2 Recommended namespace structure

```yaml
system:
  environment: production
  timezone: Europe/Istanbul

kernel:
  url: https://kernel.example.com
  update_check_interval_sec: 3600

services:
  storage:
    endpoint: https://storage.internal
  perimetr:
    endpoint: https://perimetr.example.com

repositories:
  sindri:
    url: https://github.com/example/sindri
    branch: main
  agents:
    url: https://github.com/example/agents
    branch: main

updates:
  sindri:
    channel: stable
    interval_sec: 3600

features:
  cognitive_plane_enabled: false

secrets:
  github:
    token: "<secret>"
  storage:
    api_token: "<secret>"
  proxy:
    connection_uri: "<secret>"
```

### 8.3 Secret namespace

Secrets should be stored under a dedicated top-level namespace:

```yaml
secrets:
```

This does not restrict access in v1. It exists to:

- make secret values identifiable;
- mask them in the administration UI;
- exclude them from logs;
- simplify later migration to a dedicated secret store;
- support different backup and encryption rules.

### 8.4 Register source of truth

The active published Register revision is the source of truth for values contained in Register.

Services must not silently override Register values with stale local manifests.

Local overrides are permitted only when explicitly documented for emergency recovery.

---

## 9. Register API

### 9.1 Media type

Recommended response content type:

```http
Content-Type: application/vnd.exocortex.register+json; version=1
```

### 9.2 Full snapshot

```http
GET /api/v1/register/snapshot
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Response:

```json
{
  "schema": "exocortex.register.snapshot.v1",
  "revision": "register-000042",
  "checksum": "sha256:92d0...",
  "published_at": "2026-07-27T09:00:00Z",
  "valid_until": null,
  "values": {
    "services": {
      "storage": {
        "endpoint": "https://storage.internal"
      }
    },
    "repositories": {
      "sindri": {
        "url": "https://github.com/example/sindri",
        "branch": "main"
      }
    },
    "secrets": {
      "storage": {
        "api_token": "<actual-secret-value>"
      }
    }
  }
}
```

There is no `scope` field in v1.

### 9.3 Section snapshot

```http
GET /api/v1/register/sections/{section}
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Examples:

```http
GET /api/v1/register/sections/repositories
GET /api/v1/register/sections/services
GET /api/v1/register/sections/secrets
```

Response must still include:

- schema;
- revision;
- checksum or section checksum;
- publication time;
- selected section.

### 9.4 Resolve one key

```http
GET /api/v1/register/resolve?key=services.perimetr.sni
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Example response:

```json
{
  "schema": "exocortex.register.value.v1",
  "revision": "register-000042",
  "key": "services.perimetr.sni",
  "value": "perimetr.example.com"
}
```

The endpoint may return secrets because v1 has no read separation.

### 9.5 Revision check

```http
HEAD /api/v1/register/snapshot
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Response headers:

```http
ETag: "register-000042"
X-Register-Revision: register-000042
X-Register-Checksum: sha256:92d0...
```

### 9.6 Conditional request

```http
GET /api/v1/register/snapshot
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
If-None-Match: "register-000042"
```

If unchanged:

```http
304 Not Modified
```

If changed:

```http
200 OK
ETag: "register-000043"
```

### 9.7 Cache headers

Because Register may contain secrets, responses must use:

```http
Cache-Control: no-store, private
Pragma: no-cache
```

Shared HTTP proxies must not cache Register responses.

Services may create their own encrypted local last-known-good cache after validation.

---

## 10. Constitution API

Constitution must have a format independent from Register.

The Constitution API must not return a Register-style key-value object.

### 10.1 Canonical source

The source of truth is:

```text
constitution.md
```

### 10.2 Raw Markdown endpoint

```http
GET /api/v1/constitution/raw
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
Accept: text/markdown
```

Response:

```http
Content-Type: text/markdown; charset=utf-8
ETag: "constitution-000012"
X-Constitution-Checksum: sha256:...
```

Body: exact published `constitution.md`.

### 10.3 Structured Constitution snapshot

```http
GET /api/v1/constitution/snapshot
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Recommended media type:

```http
Content-Type: application/vnd.exocortex.constitution+json; version=1
```

Response format:

```json
{
  "schema": "exocortex.constitution.snapshot.v1",
  "revision": "constitution-000012",
  "checksum": "sha256:...",
  "published_at": "2026-07-27T09:00:00Z",
  "source": {
    "filename": "constitution.md",
    "format": "markdown"
  },
  "document": {
    "title": "Exocortex Constitution",
    "markdown": "# Exocortex Constitution\n..."
  },
  "sections": [
    {
      "id": "general-principles",
      "title": "General Principles",
      "level": 2,
      "order": 1,
      "content_markdown": "..."
    },
    {
      "id": "ai-llm-rules",
      "title": "AI / LLM Rules",
      "level": 2,
      "order": 2,
      "content_markdown": "..."
    }
  ]
}
```

### 10.4 Constitution parsing rules

The structured output must be deterministic.

Kernel may parse:

- document title;
- heading hierarchy;
- section order;
- Markdown content belonging to each heading.

Kernel must not:

- invent rules not present in the source;
- semantically rewrite the Constitution;
- infer permissions from prose;
- generate summaries in place of exact content.

Section IDs are resolved in this order:

1. explicit stable ID in the Markdown source, if supported;
2. deterministic slug generated from the heading;
3. collision suffix if two headings produce the same slug.

Machine-critical sections should use explicit stable IDs.

### 10.5 Metadata endpoint

```http
GET /api/v1/constitution/meta
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

Response:

```json
{
  "schema": "exocortex.constitution.meta.v1",
  "revision": "constitution-000012",
  "checksum": "sha256:...",
  "published_at": "2026-07-27T09:00:00Z",
  "section_count": 10
}
```

### 10.6 Conditional request

Constitution endpoints must support `ETag` and `If-None-Match` in the same manner as Register.

---

## 11. Overview and Topology Map

### 11.1 Human-only status

In v1:

- Overview is for human reading in the Kernel web interface.
- Topology Map is for human understanding in the Kernel web interface.

### 11.2 No machine contract

Internal services must not depend on:

```http
GET /api/v1/overview
GET /api/v1/topology
```

A machine-readable Overview or Topology Map is outside the current scope.

If internal web routes exist for rendering these sections, they are not stable service APIs and must not be documented as such.

### 11.3 Prohibited use

Services must not:

- discover endpoints from Overview;
- parse Topology Map for runtime routes;
- treat node positions as configuration;
- execute links displayed on Topology Map;
- use Overview text as strict policy.

---

## 12. Service startup sequence

A service that depends on Register must follow this sequence:

```text
1. Read local bootstrap.
2. Load local last-known-good Register snapshot, if present.
3. Contact Kernel.
4. Authenticate with KERNEL_SERVICE_TOKEN.
5. Request the published Register snapshot.
6. Verify transport success.
7. Verify checksum.
8. Validate Register schema.
9. Validate service-required values.
10. Write the new snapshot to a temporary encrypted cache file.
11. Atomically replace the previous last-known-good cache.
12. Apply the complete snapshot atomically.
13. Start or continue the main service.
14. Periodically check for a new revision.
```

A service that consumes Constitution repeats the same process using the Constitution revision stream.

---

## 13. Pull synchronization model

### 13.1 Default behavior

Internal services pull updates from Kernel.

They check:

- at startup;
- periodically;
- before an operation that explicitly requires fresh global values;
- after an optional future update notification.

### 13.2 Why pull is required in v1

Pull keeps Kernel independent from service instance locations.

It supports:

- devices behind NAT;
- temporarily offline services;
- simple retry behavior;
- low coupling;
- independent service lifecycle;
- last-known-good fallback.

### 13.3 Future notifications

A future version may add:

- Server-Sent Events;
- WebSocket notifications;
- a message broker event such as `register.updated`;
- a Constitution update event.

Notifications must only indicate that a new revision exists.

The service must still fetch the actual snapshot through the corresponding API.

---

## 14. Kernel must not be a per-action runtime dependency

A service must not require a Kernel request before every normal internal action.

Incorrect model:

```text
Agent wants to execute a local command
    ↓
Agent must ask Kernel
    ↓
Kernel is unavailable
    ↓
All execution stops
```

Correct model:

```text
Service obtains and validates Register
    ↓
Service stores last-known-good
    ↓
Service performs its own responsibilities independently
    ↓
Service periodically refreshes Register
```

Kernel supplies configuration and rules. It does not perform ordinary service decisions unless a future dedicated policy-validation API is explicitly added.

---

## 15. Behavior when Kernel is unavailable

### 15.1 First start without cache

```text
Kernel unavailable
+ no valid last-known-good snapshot
= service start blocked
```

The service must report the reason clearly.

### 15.2 Restart with valid cache

```text
Kernel unavailable
+ valid last-known-good snapshot
= service starts in degraded mode
```

The service must:

- log a warning without secret values;
- expose degraded status;
- continue retries;
- keep the valid snapshot;
- never apply a partial response.

### 15.3 Snapshot expiry

Register and Constitution snapshots may contain `valid_until`.

After expiry, each service follows its documented local policy:

```text
continue_degraded
stop
disable_selected_features
require_operator
```

The policy must not be improvised at runtime.

---

## 16. Publication model

Register and Constitution must use separate draft and published states.

### 16.1 Register publication

```text
1. Operator edits Register draft.
2. Kernel validates syntax and schema.
3. Kernel shows a diff.
4. Secret values are masked in the diff.
5. Operator publishes.
6. Kernel creates a new immutable revision.
7. The new revision becomes active.
8. Machine API starts returning the new revision.
```

### 16.2 Constitution publication

```text
1. Operator uploads constitution.md.
2. Kernel validates file type and size.
3. Kernel renders a preview.
4. Kernel builds the structured section index.
5. Operator confirms publication.
6. Kernel creates a new immutable revision.
7. Raw and structured Constitution APIs switch atomically.
```

### 16.3 Draft isolation

Internal services must never receive drafts.

---

## 17. Revision and checksum rules

### 17.1 Independent revision streams

Examples:

```text
register-000042
constitution-000012
```

A Register update must not change the Constitution revision.

A Constitution update must not change the Register revision.

### 17.2 Immutable revisions

Published revisions must not be modified in place.

Restore creates a new revision containing the restored content.

Example:

```text
register-000042 active
register-000043 published
register-000044 restored from register-000039
```

### 17.3 Checksum

Checksum must be calculated from a canonical serialized representation of the published payload.

The service must verify it before application.

---

## 18. Validation on the service side

Kernel validates its stored data, but each service must validate received data again.

Required validation:

1. response schema;
2. revision format;
3. checksum;
4. required keys;
5. expected data types;
6. supported enum values;
7. required secrets are present;
8. endpoint syntax;
9. repository URL syntax;
10. interval ranges;
11. compatibility with the service version.

If validation fails:

```text
do not apply new snapshot
keep current last-known-good
record error without secret values
continue retrying or require operator according to policy
```

---

## 19. Atomic application

A service must never apply a snapshot field by field.

Incorrect:

```text
new endpoint applied
old branch still active
new token already active
old update channel still active
```

Correct:

```text
download complete snapshot
    ↓
validate complete snapshot
    ↓
prepare new runtime configuration
    ↓
atomically switch active revision
```

At any time, a service has exactly one active Register revision and, if used, one active Constitution revision.

---

## 20. Local cache

### 20.1 Required cache files

Recommended structure:

```text
kernel-cache/
├─ register/
│  ├─ active.snapshot.enc
│  └─ metadata.json
└─ constitution/
   ├─ active.snapshot.json
   └─ metadata.json
```

### 20.2 Secret-aware cache

Because Register contains secrets:

- Register cache must be encrypted at rest;
- cache files must be readable only by the service account;
- temporary files must be protected;
- old secret-bearing cache files must be removed securely where supported;
- cache contents must never be printed to logs;
- crash dumps must not include Register values.

### 20.3 Atomic cache write

Recommended flow:

```text
write temporary file
    ↓
fsync
    ↓
validate written file
    ↓
atomic rename
    ↓
update active metadata
```

---

## 21. Secret handling in Register

### 21.1 Current rule

For the current simplified architecture, secrets are stored in Register and returned through Register API to authenticated internal services.

### 21.2 Required protections

Kernel must:

- encrypt Register secret values at rest;
- keep the encryption master key outside Register;
- never commit the master key to Git;
- never include secret values in audit logs;
- never include secret values in error messages;
- mask secrets in the web interface;
- mask secrets in revision diffs;
- encrypt backups containing Register;
- protect Register API with HTTPS;
- use constant-time token comparison;
- use `Cache-Control: no-store`;
- prevent service token exposure in logs.

### 21.3 Bootstrap secrets

At minimum, these values remain outside Register because they are needed to access or decrypt Register:

```env
KERNEL_SERVICE_TOKEN=...
KERNEL_REGISTER_MASTER_KEY=...
```

The Kernel administration credential also remains outside Register.

### 21.4 Audit limitation

Because all services use the same token and there is no `SERVICE_ID`, Kernel can record:

- request time;
- endpoint;
- result;
- source network metadata where available.

It cannot reliably state which logical service made the request.

---

## 22. API error contract

All JSON API errors should use one format:

```json
{
  "error": {
    "code": "REGISTER_REVISION_NOT_FOUND",
    "message": "Requested Register revision was not found.",
    "request_id": "req_01J..."
  }
}
```

Required status behavior:

| Status | Meaning |
|---|---|
| `200` | Snapshot or value returned |
| `304` | Requested revision has not changed |
| `400` | Invalid key, query or request |
| `401` | Missing or invalid machine token |
| `403` | Token valid but operation is not available to machine clients |
| `404` | Resource or key not found |
| `409` | Revision or publication conflict |
| `413` | Uploaded Constitution is too large |
| `422` | Register or Constitution validation failed |
| `429` | Rate limit exceeded |
| `500` | Internal Kernel error |
| `503` | Kernel temporarily unavailable |

Errors must not reveal:

- secret values;
- full tokens;
- database paths;
- stack traces in production;
- encryption keys.

---

## 23. API summary for v1

### 23.1 Machine endpoints

```http
GET  /api/v1/health

GET  /api/v1/register/snapshot
HEAD /api/v1/register/snapshot
GET  /api/v1/register/sections/{section}
GET  /api/v1/register/resolve?key={key}

GET  /api/v1/constitution/raw
GET  /api/v1/constitution/snapshot
GET  /api/v1/constitution/meta
```

### 23.2 Not part of machine API v1

```text
Overview machine API
Topology Map machine API
Dashboard metrics API for internal service logic
```

### 23.3 Machine client restrictions

Machine token endpoints are read-only.

Mutation endpoints must be under a separate protected administration namespace.

---

## 24. Example: Sindri startup

```text
Sindri starts
    ↓
reads KERNEL_URL and KERNEL_SERVICE_TOKEN
    ↓
loads encrypted last-known-good Register cache
    ↓
GET /api/v1/register/snapshot
    ↓
receives:
- Sindri repository URL
- branch
- update channel
- update interval
- required credentials
    ↓
verifies checksum and schema
    ↓
atomically stores new Register revision
    ↓
checks and applies Sindri updates independently
```

Kernel does not clone the repository for Sindri and does not execute Sindri commands.

---

## 25. Example: Cognitive Plane startup

```text
Cognitive Plane starts
    ↓
reads Kernel bootstrap
    ↓
gets Register snapshot
    ↓
gets Constitution snapshot
    ↓
validates both revision streams
    ↓
stores last-known-good state
    ↓
Context Broker uses the published Constitution sections
    ↓
Cognitive Plane works independently
```

The Cognitive Plane may receive secrets from Register in v1.

It must not automatically include all Register contents in an LLM context. Secret exposure to a model remains governed by Constitution and Cognitive Plane implementation.

---

## 26. Example: Storage service startup

```text
Storage service starts
    ↓
gets complete Register snapshot
    ↓
reads storage endpoints, paths, backup configuration and credentials
    ↓
validates required directories and values
    ↓
stores encrypted last-known-good Register
    ↓
runs independently
```

---

## 27. What Kernel must not do

Kernel must not:

- act as an API gateway for Exocortex;
- proxy ordinary traffic between services;
- execute commands on devices;
- start agents;
- store agent runtime state;
- become a message broker;
- participate in every tool call;
- require a live request for every service action;
- derive runtime configuration from Overview;
- derive runtime configuration from Topology Map;
- silently rewrite Constitution semantics;
- return drafts through machine APIs.

Kernel may store secrets in Register in v1, but it must not expose them through logs, UI previews or unauthenticated endpoints.

---

## 28. Verification procedure

The reviewer must verify four layers:

### 28.1 Source review

Check:

- route definitions;
- authentication middleware;
- Register serialization;
- Constitution parser;
- checksum implementation;
- revision storage;
- secret encryption;
- cache headers;
- logging filters;
- error handling.

### 28.2 Runtime API review

Run requests against all machine endpoints.

Verify:

- status codes;
- headers;
- media types;
- payload schemas;
- ETag behavior;
- secret delivery;
- absence of drafts;
- absence of `SERVICE_ID` requirement.

### 28.3 Integration review

Connect at least two test services.

Verify:

- startup from Kernel;
- encrypted local cache;
- last-known-good fallback;
- revision update;
- invalid snapshot rejection;
- atomic application;
- independent operation while Kernel is offline.

### 28.4 Security review

Verify:

- HTTPS requirement;
- Register encryption at rest;
- masked secrets in UI and diff;
- no secrets in logs;
- no secrets in error responses;
- protected backups;
- token rotation procedure;
- no machine write access.

---
