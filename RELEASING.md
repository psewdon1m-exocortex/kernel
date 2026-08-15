# Kernel releases

Kernel releases use tags in the form `kernel-vMAJOR.MINOR.PATCH`.

## Create a release

1. Update `kernel/package.json`, `KERNEL_VERSION` examples and `CHANGELOG.md`.
2. Run `npm test`, `npm run build` and `npm run test:browser` from `kernel/`.
3. Set `.release/updater.version` to an existing checksummed release from the
   independent Updater repository.
4. Commit the release state and push `kernel-vX.Y.Z` to the Kernel repository.
5. `.github/workflows/release.yml` downloads and verifies the pinned Updater
   bundle, then builds and publishes the OCI image, SBOM,
   provenance, Compose bundle, release manifest, checksums and keyless Sigstore
   bundles retained for Updater 0.1.x compatibility.
6. Verify the GitHub release and image digest before changing production.

Kernel discovers only `kernel-v*` releases from the URL stored in
`repositories.kernel.url`.

Kernel CI does not read a sibling Updater source directory. Public Updater
releases work with the repository token; private repositories require a
read-only `RELEASE_READ_TOKEN`. The optional `UPDATER_REPOSITORY` repository
variable overrides the documented default.

Production update application belongs to the VPS-local `updater`. Kernel
creates and downloads a backup before handing the checksummed release to it. The
updater pulls by digest, preserves the data volume, runs health checks and
automatically restores the old image and backup on failure. Kernel never
receives the Docker socket.

Production hosts on Updater 0.1.x must first run `sudo updater update --head
kernel`. The signed Updater transition release makes that self-update possible;
afterward the normal Kernel update can consume the simplified manifest format.

## Rollback

Use the rollback action for the persisted updater job. It restores the previous
image digest and, when persisted state changed, imports the pre-update Kernel
backup through the protected local restore endpoint.
