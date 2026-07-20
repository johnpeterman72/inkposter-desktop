// Show detail for a specific set of endpoints, masking secrets.
const fs = require("fs");
const har = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const TARGETS = [
  "/api/v1/auth/login",
  "/api/v1/auth/is-email-exists",
  "/api/v1/user/frame/",        // .../update (rotation)
  "/api/v1/item/upload-converted",
  "/api/v1//item/slideshow-to-frame",
  "/api/v1/slideshow/save",
  "/api/v1/user/profile",
];

function mask(text) {
  if (!text) return text;
  return text
    .replace(/("password"\s*:\s*)"[^"]*"/gi, '$1"***MASKED***"')
    .replace(/("(?:access|refresh)?[_]?token"\s*:\s*)"[^"]{10,}"/gi, '$1"***JWT***"')
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, "***JWT***");
}
const trunc = (s, n = 1500) => (s && s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);

for (const e of har.log.entries) {
  let u; try { u = new URL(e.request.url); } catch { continue; }
  if (!/inkposter/i.test(u.host)) continue;
  if (!TARGETS.some(t => u.pathname.startsWith(t))) continue;

  const ct = (e.request.headers.find(h => /content-type/i.test(h.name)) || {}).value || "";
  let reqBody = e.request.postData && e.request.postData.text;
  if (/image|octet|multipart/i.test(ct) || (reqBody && reqBody.length > 3000))
    reqBody = `<${ct || "binary"} ${e.request.bodySize} bytes>`;
  const resBody = e.response.content && e.response.content.text;

  console.log("\n" + "=".repeat(70));
  console.log(e.request.method + " " + u.pathname + u.search + "  -> " + e.response.status + (ct ? "  [" + ct + "]" : ""));
  // Show any non-standard request headers (content-type etc.)
  const interesting = e.request.headers.filter(h => /content-type|content-length/i.test(h.name));
  interesting.forEach(h => console.log("  hdr  " + h.name + ": " + h.value));
  if (reqBody) console.log("  REQ  " + mask(trunc(reqBody)));
  if (resBody) console.log("  RESP " + mask(trunc(resBody)));
}
