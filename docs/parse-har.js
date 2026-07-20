// Summarize a HAR capture: endpoints, methods, status, auth, bodies.
// Usage: node docs/parse-har.js docs/captures/<file>.har
const fs = require("fs");
const path = process.argv[2] || "docs/captures/ProxyPin07-17_15_03_20.har";
const har = JSON.parse(fs.readFileSync(path, "utf8"));
const entries = har.log.entries;

// Hosts we consider "noise" (analytics / telemetry / OS)
const NOISE = /analytics|crashlytics|firebase|google|gstatic|apple|icloud|sentry|bugsnag|doubleclick|facebook|app-measurement/i;

const hosts = {};
for (const e of entries) {
  try { const u = new URL(e.request.url); hosts[u.host] = (hosts[u.host] || 0) + 1; } catch {}
}
console.log("=== HOSTS ===");
Object.entries(hosts).sort((a, b) => b[1] - a[1]).forEach(([h, c]) =>
  console.log(String(c).padStart(4), NOISE.test(h) ? "(noise) " + h : h));

console.log("\n=== INKPOSTER ENDPOINTS (unique method+path -> statuses) ===");
const eps = {};
for (const e of entries) {
  let u; try { u = new URL(e.request.url); } catch { continue; }
  if (!/inkposter/i.test(u.host)) continue;
  const key = e.request.method + " " + u.pathname;
  (eps[key] ||= { statuses: {}, sampleQuery: u.search, reqBodies: new Set(), resBodies: new Set() });
  eps[key].statuses[e.response.status] = (eps[key].statuses[e.response.status] || 0) + 1;
  const rb = e.request.postData && e.request.postData.text;
  if (rb) eps[key].reqBodies.add(rb.slice(0, 400));
  const sb = e.response.content && e.response.content.text;
  if (sb) eps[key].resBodies.add(sb.slice(0, 800));
}
for (const [k, v] of Object.entries(eps)) {
  console.log("\n" + k + "   " + JSON.stringify(v.statuses) + (v.sampleQuery ? "  q=" + v.sampleQuery : ""));
  for (const b of v.reqBodies) console.log("   REQ  " + b);
  for (const b of v.resBodies) console.log("   RESP " + b);
}

console.log("\n=== AUTH / REQUIRED HEADERS (from first inkposter request) ===");
const first = entries.find(e => /inkposter/i.test(e.request.url));
if (first) for (const h of first.request.headers) {
  const v = /authorization/i.test(h.name) ? h.value.slice(0, 24) + "...[redacted]" : h.value;
  console.log("  " + h.name + ": " + v);
}
