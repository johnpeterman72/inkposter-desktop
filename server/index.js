// Local web server: serves the browser UI from /public and proxies a small set
// of InkPoster API calls (so the browser never handles the token or hits CORS).
const http = require("http");
const fs = require("fs");
const path = require("path");
const api = require("./inkposter");
const ble = require("./ble");

const PORT = process.env.PORT || 4173;
const PUBLIC = path.join(__dirname, "..", "public");
const CACHE = path.join(__dirname, "cache"); // local thumbnails of our own uploads
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Private (uploaded) items have no thumbnail from the API and their thumbnail
// filename isn't derivable from the itemId, so cache what we upload to show it.
function cacheThumb(itemId, buf) {
  if (!UUID_RE.test(itemId)) return;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, itemId + ".jpg"), buf);
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

// Read a raw binary request body (for image upload). Caps at 40 MB.
function readRawBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("upload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  try {
    // Read routes
    if (req.method === "GET" && url.pathname === "/api/frames") {
      return sendJSON(res, 200, await api.listFrames());
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJSON(res, 200, await api.frameStatus());
    }
    if (req.method === "GET" && url.pathname === "/api/image-status") {
      return sendJSON(res, 200, await api.imageStatus());
    }
    if (req.method === "GET" && url.pathname === "/api/token") {
      return sendJSON(res, 200, api.tokenInfo());
    }
    // Write routes
    if (req.method === "POST" && url.pathname === "/api/show") {
      const { frames, items } = await readBody(req);
      if (!frames?.length || !items?.length)
        return sendJSON(res, 400, { error: "need { frames:[], items:[] }" });
      const result = await api.showOnFrame(frames, items);
      // Nudge the device to pull it now (helps when it's awake/charging).
      try { await api.syncNow(frames); } catch {}
      return sendJSON(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/sync-now") {
      const { frames } = await readBody(req);
      if (!frames?.length) return sendJSON(res, 400, { error: "need { frames:[] }" });
      return sendJSON(res, 200, await api.syncNow(frames));
    }
    if (req.method === "POST" && url.pathname === "/api/set-sync-interval") {
      const { frame, seconds } = await readBody(req);
      if (!frame || !seconds) return sendJSON(res, 400, { error: "need { frame, seconds }" });
      return sendJSON(res, 200, await api.updateFrame(frame, { syncInterval: seconds }));
    }
    if (req.method === "POST" && url.pathname === "/api/report-status") {
      const { frames } = await readBody(req);
      if (!frames?.length) return sendJSON(res, 400, { error: "need { frames:[] }" });
      return sendJSON(res, 200, await api.reportStatus(frames));
    }
    if (req.method === "POST" && url.pathname === "/api/items-exist") {
      const { items } = await readBody(req);
      return sendJSON(res, 200, await api.itemsExist(items || []));
    }
    // Upload a personal photo: raw image bytes in the body, frame id in the
    // query. The browser has already resized it to the frame's exact resolution.
    if (req.method === "POST" && url.pathname === "/api/upload") {
      const frame = url.searchParams.get("frame");
      if (!frame) return sendJSON(res, 400, { error: "need ?frame=<id>" });
      const buf = await readRawBody(req);
      if (!buf.length) return sendJSON(res, 400, { error: "empty upload" });
      const mediaType = req.headers["content-type"] || "image/jpeg";
      const filename = url.searchParams.get("name") || "userimage.jpg";
      const result = await api.uploadAndShow(frame, buf, filename, mediaType);
      try { if (result?.itemId) cacheThumb(result.itemId, buf); } catch {}
      return sendJSON(res, 200, result);
    }
    // Serve a cached thumbnail of a photo we uploaded (private items only).
    if (req.method === "GET" && url.pathname === "/api/thumb") {
      const id = url.searchParams.get("item") || "";
      if (!UUID_RE.test(id)) return sendJSON(res, 400, { error: "bad item id" });
      const file = path.join(CACHE, id + ".jpg");
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end("no cached image"); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=86400" });
      return res.end(fs.readFileSync(file));
    }
    // Library
    if (req.method === "GET" && url.pathname === "/api/categories") {
      return sendJSON(res, 200, await api.categories());
    }
    if (req.method === "POST" && url.pathname === "/api/cards") {
      const { category, collections, limit, lastId } = await readBody(req);
      const body = collections ? { collections } : { category };
      return sendJSON(res, 200, await api.cards(body, limit, lastId));
    }
    // Rotation / frame settings
    if (req.method === "POST" && url.pathname === "/api/rotate") {
      const { frame, orientation } = await readBody(req);
      if (!frame || !orientation) return sendJSON(res, 400, { error: "need { frame, orientation }" });
      return sendJSON(res, 200, await api.updateFrame(frame, { orientation }));
    }
    // Image-transition style (panel-specific)
    if (req.method === "POST" && url.pathname === "/api/transition") {
      const { frame, pipelineSwitchingMode, numberOfDivisions } = await readBody(req);
      if (!frame) return sendJSON(res, 400, { error: "need { frame }" });
      const patch = {};
      if (pipelineSwitchingMode !== undefined) patch.pipelineSwitchingMode = pipelineSwitchingMode;
      if (numberOfDivisions !== undefined) patch.numberOfDivisions = numberOfDivisions;
      return sendJSON(res, 200, await api.setTransition(frame, patch));
    }
    // Full-panel redraw (clear ghosting) over the cloud
    if (req.method === "POST" && url.pathname === "/api/full-refresh") {
      const { frames } = await readBody(req);
      if (!frames?.length) return sendJSON(res, 400, { error: "need { frames:[] }" });
      return sendJSON(res, 200, await api.fullScreenUpdate(frames));
    }
    // Firmware
    if (req.method === "GET" && url.pathname === "/api/version-check") {
      return sendJSON(res, 200, await api.versionCheck());
    }
    if (req.method === "POST" && url.pathname === "/api/firmware/check") {
      const { frames } = await readBody(req);
      if (!frames?.length) return sendJSON(res, 400, { error: "need { frames:[] }" });
      return sendJSON(res, 200, await api.checkFirmware(frames));
    }
    if (req.method === "POST" && url.pathname === "/api/firmware/update") {
      const { frames } = await readBody(req);
      if (!frames?.length) return sendJSON(res, 400, { error: "need { frames:[] }" });
      return sendJSON(res, 200, await api.updateFirmware(frames));
    }
    // Create a playlist (slideshow) and activate it on a frame.
    if (req.method === "POST" && url.pathname === "/api/slideshow") {
      const { items, shuffle, orientation, frame, interval } = await readBody(req);
      if (!frame || !items?.length) return sendJSON(res, 400, { error: "need { frame, items:[{id,weight}] }" });
      return sendJSON(res, 200, await api.createSlideshow({ items, shuffle, orientation, frame, interval }));
    }
    // --- BLE direct device control (optional; needs a BLE backend + adapter) ---
    if (req.method === "GET" && url.pathname === "/api/ble/available") {
      return sendJSON(res, 200, { available: ble.isAvailable() });
    }
    if (req.method === "POST" && url.pathname === "/api/ble/scan") {
      return sendJSON(res, 200, { devices: await ble.scan() });
    }
    if (req.method === "POST" && url.pathname === "/api/ble/status") {
      const sel = await readBody(req);
      return sendJSON(res, 200, await ble.status(sel || {}));
    }
    if (req.method === "POST" && url.pathname === "/api/ble/fetch") {
      const opts = await readBody(req); // { id?, name?, sharedKey? }
      return sendJSON(res, 200, await ble.fetch(opts || {}));
    }
    if (req.method === "POST" && url.pathname === "/api/ble/reboot") {
      const opts = await readBody(req);
      return sendJSON(res, 200, await ble.reboot(opts || {}));
    }
    if (req.method === "POST" && url.pathname === "/api/ble/ghosting-clean") {
      const opts = await readBody(req);
      return sendJSON(res, 200, await ble.ghostingClean(opts || {}));
    }
    if (req.method === "POST" && url.pathname === "/api/ble/set-wifi") {
      const opts = await readBody(req); // { ssid, passwd, id?, name?, sharedKey?, apiEnvType? }
      if (!opts?.ssid) return sendJSON(res, 400, { error: "need { ssid }" });
      return sendJSON(res, 200, await ble.setWifi(opts));
    }
    return sendJSON(res, 404, { error: "unknown api route" });
  } catch (e) {
    return sendJSON(res, e.status || 500, { error: e.message, data: e.data });
  }
}

function serveStatic(res, pathname) {
  let file = path.join(PUBLIC, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  const info = api.tokenInfo();
  console.log(`\n  InkPoster Desktop  →  http://localhost:${PORT}\n`);
  if (info.expiresAt) {
    const days = Math.round((info.expiresAt - Date.now()) / 86400000);
    console.log(info.expired
      ? "  ⚠  Token EXPIRED — re-capture and update server/config.local.json"
      : `  Token valid ~${days} day(s), until ${new Date(info.expiresAt).toLocaleString()}`);
  }
  console.log("  Ctrl+C to stop.\n");
});
