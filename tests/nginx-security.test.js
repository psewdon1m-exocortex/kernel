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
});

test("clean-host bootstrap provisions only the public release key", () => {
  assert.match(bootstrap, /release_base\/kernel\.pem/);
  assert.match(bootstrap, /bootstrap_trust=true/);
  assert.match(bootstrap, /install -o root -g root -m 0644 "\$candidate_trust_file" "\$trust_file"/);
  assert.match(releaseBuilder, /output\/bootstrap\.sh/);
  assert.match(releaseWorkflow, /--export-public-key release-artifacts\/kernel\.pem/);
});
