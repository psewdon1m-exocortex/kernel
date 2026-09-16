# Changelog

This document specializes [Part 00 — system unification specification](https://github.com/psewdon1m-exocortex/general/blob/main/PART_00_SYSTEM_UNIFICATION_SPECIFICATION.md); that central contract remains authoritative.

## Unreleased

## 0.2.14

- Add a persistent Topology Map Focus control that synchronizes with Sidebar
  auto-hide and expands the Excalidraw Canvas across the viewport.

## 0.2.13

- Add a persistent Topology Map grid control that is stored with Excalidraw
  revisions and restored across reloads.
- Refresh the bundled Overview and Constitution for Volt 0.1.7, the Saturn
  storage gateway boundary and the current Updater compatibility context.

## 0.2.12

- Add Laboratory and Chronos to the Kernel availability Dashboard through their
  registered public-readiness contracts without changing the initial
  six-service profile.

## 0.2.11

- Align Register search, in-page headings and bundled Overview/Constitution
  documentation with the current interface and documentation contracts.
- Keep the Documentation workspace bounded to the viewport with independent
  navigation/content scrolling and safe automatic bundled-revision upgrades.
- Treat the operator Access Key as an exact opaque non-empty value across
  bootstrap, startup, login, rotation and recovery, including the staged legacy
  environment fallback.
- Add the revision-bound Part 12 pre-signing/final evidence gate, anonymous
  published-asset verification and `known-problems-report.json` release asset.

## 0.2.10

- Align service-local contracts with the central specifications and use
  standalone links to the canonical documentation repository.
- Rename the internal-services interaction specification to its canonical
  filename.

## 0.2.8

- Include public brand assets in the production image.
- Align Dashboard service monitoring with the deployed Kernel, Saturn and Volt
  endpoints.
- Use Saturn's redacted public readiness contract instead of its private health
  endpoint.

## 0.2.7

- Embed exact-version RSA release trust in the published bootstrap instead of
  downloading a public key beside the manifest.
- Issue one-time root-only bootstrap credential handoffs for Volt and Saturn;
  consuming installers no longer read Kernel's environment file.
- Bundle Updater 0.4.3 with fail-closed release-trust preservation.

## 0.2.6

- Publish the RSA release public key and standalone bootstrap as release assets.
- Bootstrap and pin the first-install public key automatically from the selected
  HTTPS release while preserving an existing host key.

## 0.2.5

- Make the HTTPS login and authenticated UI/API reachable from every client IP.
- Keep health, updater restore, documentation and common probe targets hidden at Nginx.
- Replace the obsolete boolean proxy setting with the explicit trusted-proxy list.

## 0.2.4

- Add operator-guided recovery bootstrap and verified Updater self-update flows.
- Centralize Neptune backup and update controls while aligning Volt service references.
- Unify Kernel service controls and reduce unauthenticated public probing exposure.

## 0.2.3

- Export operator and pre-update Kernel backups as bounded ZIP archives with a
  machine-readable manifest and a verified SHA-256 data-member checksum.
- Keep legacy JSON backup imports available during the ZIP format transition.
- Allow document Nodes with attached files inside Containers while retaining
  their compact file metadata and Open, Download and Replace actions.

## 0.2.2

- Restore detached Sigstore release bundles for compatibility with production
  hosts that still run Updater 0.1.x.
- Embed the signed Updater 0.2.1 transition release in new installations.

## 0.2.1

- Add persistent Topology document Nodes for validated PDF, Markdown, DOCX and
  Open Node graph attachments, with browser open and exact-byte download.
- Validate embedded document type, size, MIME and SHA-256 on the Kernel API.
- Keep contained module text sizing consistent with top-level Nodes.
- Point Kernel documentation to the root unification specification.

## 0.2.0

- Add the one-command Kernel bootstrap and `kernel-install` production command.
- Generate technical secrets while keeping operator credentials user-owned.
- Simplify release verification to HTTPS, SHA-256 and immutable image digests.

## 0.1.1

- Keep the mobile navigation control above the sidebar at narrow viewport widths.
- Validate the published OCI digest before packaging a release.

## 0.1.0

- Initial single-VPS Kernel service.
- Operator Dashboard, documents, Register, Topology and Settings.
- Bounded audit retention, backup restore and operator-triggered release checks.
