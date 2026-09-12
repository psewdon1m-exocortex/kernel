import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const config = fs.readFileSync(new URL("../nginx.security.conf", import.meta.url), "utf8");
const releaseBuilder = fs.readFileSync(new URL("../scripts/build-release.sh", import.meta.url), "utf8");

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
