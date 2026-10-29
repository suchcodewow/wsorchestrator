/**
 * TEMPORARY PROBE: delete with everything else docs/probes.md lists for it.
 *
 * The SCORM package that frames `/scorm-probe` inside Mindtickle: a SCORM 1.2
 * manifest and an `index.html` shell. The shell finds the LMS's SCORM API,
 * initializes it, reads who the learner is and posts that to the framed page,
 * and sets the lesson completed when the page asks. Nothing it posts is
 * signed: the page shows it to find out what Mindtickle passes, not to trust
 * it.
 */

import "server-only";

import { zip } from "@/lib/zip";

export const SCORM_PROBE_PAGE = "/scorm-probe";
export const SCORM_PROBE_COOKIE_PATH = "/api/scorm-probe/cookies";

/** The cookies the page sets and reads back, one for each way a framed page might keep one. */
export const SCORM_PROBE_COOKIES = {
  lax: "scorm_probe_lax",
  none: "scorm_probe_none",
  partitioned: "scorm_probe_partitioned",
} as const;

export const SCORM_PROBE_COOKIE_MAX_AGE = 600;

export function manifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="harness-events-scorm-probe" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Harness Events SCORM probe</title>
      <item identifier="item" identifierref="shell">
        <title>Harness Events SCORM probe</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="shell" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`;
}

/** The shell, framing the probe page at `appOrigin` and talking only to that origin. */
export function shellHtml(appOrigin: string): string {
  const origin = new URL(appOrigin).origin;
  // Inside a <script>, so no "</script>" may survive.
  const literal = JSON.stringify(origin).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness Events SCORM probe</title>
<style>html, body { margin: 0; height: 100%; } iframe { display: block; width: 100%; height: 100%; border: 0; }</style>
</head><body>
<iframe id="app" title="Harness Events" allow="storage-access; clipboard-write"></iframe>
<script>
(function () {
  var APP = ${literal};
  var frame = document.getElementById("app");

  // The SCORM API is on a window above this one, or above the one that opened it.
  function find(name) {
    var starts = [window];
    try { if (window.opener) starts.push(window.opener); } catch (e) {}
    for (var s = 0; s < starts.length; s++) {
      var w = starts[s];
      for (var hops = 0; w && hops < 12; hops++) {
        try { if (w[name]) return w[name]; } catch (e) {}
        if (w.parent === w) break;
        w = w.parent;
      }
    }
    return null;
  }

  var api12 = find("API");
  var api2004 = find("API_1484_11");
  var ctx = {
    type: "scorm-probe/context",
    shellHref: location.href,
    apis: { "1.2": !!api12, "2004": !!api2004 },
    version: api12 ? "1.2" : api2004 ? "2004" : null,
    initialized: false,
    learnerId: null,
    learnerName: null,
    lessonStatus: null,
    error: null
  };

  function ok(v) { return String(v) === "true"; }
  function get(n12, n2004) {
    var v = api12 ? api12.LMSGetValue(n12) : api2004.GetValue(n2004);
    return v === "" || v == null ? null : String(v);
  }
  function lastError() {
    try {
      var code = api12 ? api12.LMSGetLastError() : api2004.GetLastError();
      return code + " " + (api12 ? api12.LMSGetErrorString(code) : api2004.GetErrorString(code));
    } catch (e) { return String(e); }
  }
  function status() { return get("cmi.core.lesson_status", "cmi.completion_status"); }

  if (ctx.version) {
    try {
      ctx.initialized = ok(api12 ? api12.LMSInitialize("") : api2004.Initialize(""));
      if (!ctx.initialized) ctx.error = "Initialize failed: " + lastError();
      ctx.learnerId = get("cmi.core.student_id", "cmi.learner_id");
      ctx.learnerName = get("cmi.core.student_name", "cmi.learner_name");
      ctx.lessonStatus = status();
    } catch (e) { ctx.error = String(e); }
  } else {
    ctx.error = "no SCORM API found";
  }

  function reply(message) { frame.contentWindow.postMessage(message, APP); }

  function complete() {
    if (!ctx.initialized) return { type: "scorm-probe/completed", ok: false, error: ctx.error, lessonStatus: null };
    try {
      var done = api12
        ? ok(api12.LMSSetValue("cmi.core.lesson_status", "completed")) && ok(api12.LMSCommit(""))
        : ok(api2004.SetValue("cmi.completion_status", "completed")) && ok(api2004.Commit(""));
      return { type: "scorm-probe/completed", ok: done, error: done ? null : lastError(), lessonStatus: status() };
    } catch (e) {
      return { type: "scorm-probe/completed", ok: false, error: String(e), lessonStatus: null };
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== APP || event.source !== frame.contentWindow) return;
    var type = event.data && event.data.type;
    if (type === "scorm-probe/ready") reply(ctx);
    else if (type === "scorm-probe/complete") reply(complete());
  });

  var finished = false;
  function finish() {
    if (finished || !ctx.initialized) return;
    finished = true;
    try { api12 ? api12.LMSFinish("") : api2004.Terminate(""); } catch (e) {}
  }
  window.addEventListener("pagehide", finish);
  window.addEventListener("beforeunload", finish);

  frame.src = APP + ${JSON.stringify(SCORM_PROBE_PAGE)};
})();
</script>
</body></html>
`;
}

/** The package to upload to Mindtickle, framing the probe page at `appOrigin`. */
export function scormPackage(appOrigin: string): Buffer {
  return zip([
    { path: "imsmanifest.xml", content: manifestXml() },
    { path: "index.html", content: shellHtml(appOrigin) },
  ]);
}
