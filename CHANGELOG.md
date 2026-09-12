# Changelog

## Unreleased

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
