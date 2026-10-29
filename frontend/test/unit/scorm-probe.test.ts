/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * The SCORM probe's package: the manifest, and a shell that frames and trusts
 * only the app's own origin. `zip.test.ts` covers the archive itself.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { scormPackage, shellHtml } from "@/lib/scorm-probe";
import { unzip } from "@/lib/spreadsheet-file";

describe("scormPackage", () => {
  test("holds a SCORM 1.2 manifest naming index.html, and the shell", () => {
    const files = unzip(scormPackage("https://qa.harnessevents.io/"));
    assert.deepEqual([...files.keys()], ["imsmanifest.xml", "index.html"]);
    const manifest = files.get("imsmanifest.xml")!.toString();
    assert.match(manifest, /<schemaversion>1\.2<\/schemaversion>/);
    assert.match(manifest, /adlcp:scormtype="sco" href="index.html"/);
    assert.match(files.get("index.html")!.toString(), /var APP = "https:\/\/qa\.harnessevents\.io";/);
  });
});

describe("shellHtml", () => {
  test("keeps only the origin of the address it is given", () => {
    assert.match(shellHtml("http://localhost:3100/some/path?x=1"), /var APP = "http:\/\/localhost:3100";/);
  });

  test("checks the sender's origin and window before acting on a message", () => {
    assert.match(shellHtml("https://app.example"), /event\.origin !== APP \|\| event\.source !== frame\.contentWindow/);
  });

  test("refuses an address that is not a URL", () => {
    assert.throws(() => shellHtml("</script><script>alert(1)</script>"));
  });
});
