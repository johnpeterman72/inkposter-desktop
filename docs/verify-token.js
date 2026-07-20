// Read-only check that the captured token + headers still work against the live API.
// Pulls token + deviceId straight from the HAR so nothing is hardcoded.
const fs = require("fs");
const har = JSON.parse(fs.readFileSync("docs/captures/ProxyPin07-17_15_03_20.har", "utf8"));
const req = har.log.entries.map(e => e.request).find(r => /inkposter/i.test(r.url));
const h = Object.fromEntries(req.headers.map(x => [x.name.toLowerCase(), x.value]));

const headers = {
  "Authorization": h["authorization"],
  "x-header-clientid": "ios",
  "x-client-id": "ios",
  "x-header-deviceid": h["x-header-deviceid"],
  "x-header-country": "US",
  "x-header-language": "en",
  "User-Agent": h["user-agent"],
  "Accept": "*/*",
};

// Decode JWT expiry for info
const payload = JSON.parse(Buffer.from(h["authorization"].split(".")[1].replace("Bearer ", ""), "base64").toString());
console.log("Token sub(user):", payload.sub);
console.log("Token exp:", new Date(payload.exp * 1000).toISOString(), "(", Math.round((payload.exp*1000 - Date.parse("2026-07-17T20:04:00Z"))/86400000), "days from capture )");

(async () => {
  const r = await fetch("https://api.inkposter.com/api/v1/user/frames?limit=100", { headers });
  console.log("\nGET /user/frames ->", r.status, r.statusText);
  const body = await r.text();
  console.log(body.slice(0, 1200));
})().catch(e => console.error("ERROR:", e.message));
