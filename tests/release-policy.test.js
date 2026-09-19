import assert from "node:assert/strict";
import test from "node:test";
import { checkGitHubRelease } from "../server/updater.js";
test("legacy discovery also excludes unqualified, draft and prerelease versions", async t => {
 const service="kernel";
 const releases=[{tag_name:service+"-v1.0.9"},{tag_name:"v99.0.0"},{tag_name:service+"-v90.0.0",draft:true},{tag_name:service+"-v89.0.0",prerelease:true},{tag_name:service+"-v99.0.0-rc.1"},{tag_name:service+"-v01.2.0"},{tag_name:service+"-v1.0.10"}];
 const fetchImpl=async()=>new Response(JSON.stringify(releases),{headers:{"Content-Type":"application/json"}});

 const result=await checkGitHubRelease({ repositoryUrl: "https://github.com/example/kernel", service, currentVersion: "1.0.9", fetchImpl });
 assert.equal(result.available_version,"1.0.10");assert.equal(result.update_available,true);
});
