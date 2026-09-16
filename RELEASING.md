# Kernel releases

This document specializes [Part 05 — CI/CD and release
security](https://github.com/psewdon1m-exocortex/general/blob/main/PART_05_CI_RELEASES_AND_LOCAL_UPDATES.md) for this service. If
the two documents differ, Part 05 is authoritative.

The [Part 12 known-problem gate](https://github.com/psewdon1m-exocortex/general/blob/main/PART_12_KNOWN_DEPLOYMENT_AND_OPERATIONS_PROBLEMS.md) is also mandatory for every qualified release. Its revision-bound
`known-problems-report.json` is release evidence, not an optional checklist.

Kernel releases use tags in the form `kernel-vMAJOR.MINOR.PATCH`. The version
sequence starts at `0.0.1`. A plain tag such as `v0.0.1` invokes
verification-only CI and must not publish or mutate a release; only the
service-qualified `kernel-v...` namespace may invoke the release workflow.

## Create a release

1. Update `kernel/package.json`, `KERNEL_VERSION` examples and `CHANGELOG.md`.
2. Run `npm test`, `npm run build` and `npm run test:browser` from `kernel/`.
3. Set `.release/updater.version` to an existing checksummed release from the
   independent Updater repository.
4. Commit the release state and push `kernel-vX.Y.Z` to the Kernel repository.
5. `.github/workflows/release.yml` downloads and verifies the pinned Updater,
   publishes and smoke-tests one immutable candidate image, and revalidates the
   Part 12 pre-signing receipts before the protected signing job can read
   Kernel's private release key. The signing job builds the Compose bundle and
   canonical manifest from that exact digest, signs them, derives the public
   counterpart and embeds only that public key in the versioned `bootstrap.sh`.
   Signed assets are staged as a prerelease and verified anonymously. The final
   97-ID report, SBOM, provenance and compatibility Sigstore bundles are
   attached before stable release and image aliases are promoted. The embedded
   Updater bundle must contain its independently trusted
   `release-trust/updater.pem`, `release-trust/neptune.pem` and
   `release-trust/gryphon.pem`.
6. Verify the GitHub release and image digest before changing production.

Kernel discovers only `kernel-v*` releases from the URL stored in
`repositories.kernel.url`.

Kernel CI does not read a sibling Updater source directory. Public Updater
releases work with the repository token; private repositories require a
read-only `RELEASE_READ_TOKEN`. The optional `UPDATER_REPOSITORY` repository
variable overrides the documented default.

The clean-host trust path is
`/etc/exocortex/release-trust/kernel.pem`. It is created by Kernel's bootstrap
from its embedded public key before the bootstrap verifies the manifest. Do
not distribute the release key with `scp`, ask an operator to compare a
fingerprint, or teach bootstrap to trust a public key downloaded beside the
manifest.

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
