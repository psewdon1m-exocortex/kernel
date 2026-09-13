import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const config = fs.readFileSync(new URL("../nginx.security.conf", import.meta.url), "utf8");
const releaseBuilder = fs.readFileSync(new URL("../scripts/build-release.sh", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../bootstrap.sh", import.meta.url), "utf8");
const releaseWorkflow = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("public-authenticated Nginx policy has no client IP allow-list", () => {
  assert.doesNotMatch(config, /^\s*(?:allow|deny)\s+/m);
  assert.match(config, /location = \/api\/internal\/updater\/restore\s*\{\s*return 404;/s);
  assert.match(config, /location = \/api\/health\s*\{\s*return 404;/s);
  assert.match(config, /X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
});

test("signed release bundle contains the Nginx policy", () => {
  assert.match(releaseBuilder, /"\$root\/nginx\.security\.conf" "\$stage\/"/);
  for (const service of ["updater", "neptune", "gryphon"]) {
    assert.match(releaseBuilder, new RegExp(`release-trust/${service}\\.pem`));
  }
});

test("Kernel issues consumer credentials without exposing its environment", () => {
  const installer = fs.readFileSync(new URL("../install.sh", import.meta.url), "utf8");
  assert.match(installer, /credential_root=\/etc\/exocortex\/bootstrap-credentials/);
  assert.match(installer, /target_file="\$credential_root\/\$consumer\.env"/);
  assert.match(installer, /chown root:root "\$temporary_file"/);
  assert.match(installer, /chmod 0600 "\$temporary_file"/);
  assert.match(installer, /Replace the example KERNEL_URL before issuing bootstrap credentials/);
});

test("clean-host bootstrap uses exact embedded public release trust", () => {
  assert.match(bootstrap, /KERNEL_BOOTSTRAP_RELEASE_VERSION="__KERNEL_BOOTSTRAP_RELEASE_VERSION__"/);
  assert.match(bootstrap, /KERNEL_BOOTSTRAP_PUBLIC_KEY_B64="__KERNEL_BOOTSTRAP_PUBLIC_KEY_BASE64__"/);
  assert.doesNotMatch(bootstrap, /release_base\/kernel\.pem/);
  assert.doesNotMatch(bootstrap, /api\.github\.com\/repos/);
  assert.match(bootstrap, /Installed Kernel release key differs from this release/);
  assert.doesNotMatch(releaseBuilder, /output\/bootstrap\.sh/);
  assert.match(releaseWorkflow, /--export-public-key release-artifacts\/kernel\.pem/);
  assert.match(releaseWorkflow, /build-bootstrap\.mjs/);
});
