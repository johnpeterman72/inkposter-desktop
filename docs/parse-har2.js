// Targeted extraction for the big 2nd capture: list all endpoints, then show
// detail for auth/login/upload/frame-mutation flows (truncating binary bodies).
const fs = require("fs");
const har = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const entries = har.log.entries;

const trunc = (s, n = 500) => {
  if (!s) return s;
  if (s.length > n) return s.slice(0, n) + `…[+${s.length - n} chars]`;
  return s;
};

// 1) All inkposter endpoints (method+path) with counts + statuses
const eps = {};
for (const e of entries) {
  let u; try { u = new URL(e.request.url); } catch { continue; }
  if (!/inkposter/i.test(u.host)) continue;
  const key = e.request.method + " " + u.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/{uuid}");
  (eps[key] ||= { n: 0, statuses: {} });
  eps[key].n++;
  eps[key].statuses[e.response.status] = (eps[key].statuses[e.response.status] || 0) + 1;
}
console.log("=== ALL INKPOSTER ENDPOINTS ===");
Object.entries(eps).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) =>
  console.log(String(v.n).padStart(4), JSON.stringify(v.statuses).padEnd(20), k));

// 2) Detail for the flows we need
const WANT = /(auth|login|logout|sign|token|refresh|register|upload|\/item$|\/items$|orientation|rotate|\/frame\/|user\/frames)/i;
console.log("\n\n=== DETAIL: auth / upload / frame-mutation ===");
for (const e of entries) {
  let u; try { u = new URL(e.request.url); } catch { continue; }
  if (!/inkposter/i.test(u.host)) continue;
  const line = e.request.method + " " + u.pathname + u.search;
  // Only non-GET or matching-name, to focus on mutations/auth
  if (e.request.method === "GET" && !WANT.test(u.pathname)) continue;
  if (!WANT.test(u.pathname) && e.request.method !== "POST" && e.request.method !== "PUT" && e.request.method !== "PATCH") continue;

  const ct = (e.request.headers.find(h => /content-type/i.test(h.name)) || {}).value || "";
  let reqBody = e.request.postData && e.request.postData.text;
  if (/image|octet|multipart|binary/i.test(ct) || (reqBody && reqBody.length > 2000)) reqBody = `<${ct || "binary"} ${e.request.bodySize} bytes>`;
  const resBody = e.response.content && e.response.content.text;

  console.log("\n" + line + "  -> " + e.response.status + (ct ? "  [" + ct + "]" : ""));
  if (reqBody) console.log("  REQ  " + trunc(reqBody));
  if (resBody) console.log("  RESP " + trunc(resBody, 700));
}
