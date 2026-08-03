# Kernel releases

Kernel releases use tags in the form `kernel-vMAJOR.MINOR.PATCH`.

## Create a release

1. Update `kernel/package.json`, `KERNEL_VERSION` examples and `CHANGELOG.md`.
2. Run `npm test`, `npm run build` and `npm run test:browser` from `kernel/`.
3. Set `.release/updater.version` to an existing signed release from the
   independent Updater repository.
4. Commit the release state and push `kernel-vX.Y.Z` to the Kernel repository.
5. `.github/workflows/release.yml` downloads and verifies the pinned Updater
   bundle, then builds and publishes the OCI image, SBOM,
   provenance, Compose bundle, release manifest, checksums and Sigstore bundles.
6. Verify the GitHub release and image digest before changing production.

Kernel discovers only `kernel-v*` releases from the URL stored in
`repositories.kernel.url`.

Kernel CI does not read a sibling Updater source directory. Public Updater
releases work with the repository token; private repositories require a
read-only `RELEASE_READ_TOKEN`. The optional `UPDATER_REPOSITORY` repository
variable overrides the documented default.

Production update application belongs to the VPS-local `updater`. Kernel
creates and downloads a backup before handing the signed release to it. The
updater pulls by digest, preserves the data volume, runs health checks and
automatically restores the old image and backup on failure. Kernel never
receives the Docker socket.

## Rollback

Use the rollback action for the persisted updater job. It restores the previous
image digest and, when persisted state changed, imports the pre-update Kernel
backup through the protected local restore endpoint.
