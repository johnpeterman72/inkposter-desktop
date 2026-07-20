// Thin client for the InkPoster cloud API.
// All auth/headers live here; the rest of the app just calls these functions.
//
// Auth: the captured access token lasts ~14 days. We refresh it automatically:
//   - proactively when it's within REFRESH_BUFFER of expiry, and
//   - reactively on a 401 (refresh, then retry the request once).
// Refresh (`POST /auth/refresh-token`) needs no request signing — just the
// Bearer token + { deviceId }. A full re-login (`POST /auth/login`) IS signed
// with the Android client secret (the only platform secret we have) and is used
// only as a fallback when refresh fails and email/password are in config.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG_PATH = path.join(__dirname, "config.local.json");
const BASE = "https://api.inkposter.com/api/v1";

// Refresh this long before the token's `exp`. Tokens live ~14 days.
const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // 1 day

// Android platform signing secret (from the decompiled app — see
// docs/reference/CLOUD_API.md). Only auth endpoints require signing, and only
// a full login uses it; refresh does not.
const ANDROID_CLIENT_ID = "android";
const ANDROID_CLIENT_SECRET = "t5L1zS3D5CAZOE66afhWy8oPVEkZaB5p";

// In-memory config, loaded once and mutated on refresh/login.
let _cfg = null;

function loadConfig() {
  if (_cfg) return _cfg;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error("Missing server/config.local.json — needs { token, deviceId }.");
  }
  _cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return _cfg;
}

// Persist the current config back to disk (pretty-printed so it stays editable).
function saveConfig() {
  if (!_cfg) return;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(_cfg, null, 2) + "\n", "utf8");
}

// Which client platform to present. Defaults to whatever minted the stored
// token (ios, from the capture). A fresh android login flips this to "android"
// so login → refresh → normal calls all stay consistent afterward.
function clientId(cfg) {
  return cfg.clientId || "ios";
}

function authHeaders(cfg) {
  const cid = clientId(cfg);
  return {
    "Authorization": "Bearer " + cfg.token,
    "x-header-clientid": cid,
    "x-client-id": cid,
    "x-header-deviceid": cfg.deviceId,
    "x-header-country": cfg.country || "US",
    "x-header-language": cfg.language || "en",
    "User-Agent": cfg.userAgent || "InkposterApp Version:2.1.12 OS:iOS-26.5.2",
    "Accept": "*/*",
  };
}

// Decode JWT expiry (no verification — just to know when to refresh / warn).
function tokenInfo(cfg) {
  cfg = cfg || loadConfig();
  try {
    const p = JSON.parse(Buffer.from(cfg.token.split(".")[1], "base64").toString());
    return { userId: p.sub, expiresAt: p.exp * 1000, expired: Date.now() > p.exp * 1000 };
  } catch { return { userId: null, expiresAt: null, expired: null }; }
}

// --- Auth: refresh + login ---------------------------------------------------

// Apply an /auth/login or /auth/refresh-token response to config and persist.
function applyAuthResponse(cfg, data) {
  if (!data || !data.accessToken) {
    throw new Error("auth response missing accessToken");
  }
  cfg.token = data.accessToken;
  if (data.refreshToken) cfg.refreshToken = data.refreshToken;
  cfg._note = "Auto-managed by server/inkposter.js. token auto-refreshes.";
  saveConfig();
}

async function refreshToken(cfg) {
  if (!cfg.refreshToken) throw new Error("no refreshToken in config");
  // Refresh presents the REFRESH token as the Bearer (verified against the live
  // API — the endpoint reads the Bearer as a refresh token) plus { deviceId }.
  // No request signing. The refresh token outlives the access token (~90d vs
  // ~14d), so this keeps the session alive unattended between full logins.
  const res = await fetch(BASE + "/auth/refresh-token", {
    method: "POST",
    headers: { ...authHeaders(cfg), "Authorization": "Bearer " + cfg.refreshToken, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: cfg.deviceId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`refresh-token failed (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  applyAuthResponse(cfg, data);
  return data;
}

async function login(cfg) {
  if (!cfg.email || !cfg.password) {
    throw new Error("cannot login: add { email, password } to config.local.json");
  }
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", ANDROID_CLIENT_SECRET)
    .update(ANDROID_CLIENT_ID + ts).digest("hex");
  const url = `${BASE}/auth/login?timestamp=${ts}&signature=${sig}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-header-clientid": ANDROID_CLIENT_ID,
      "x-client-id": ANDROID_CLIENT_ID,
      "x-header-deviceid": cfg.deviceId,
      "x-header-country": cfg.country || "US",
      "x-header-language": cfg.language || "en",
      "Content-Type": "application/json",
      "Accept": "*/*",
    },
    body: JSON.stringify({ email: cfg.email, password: cfg.password, deviceId: cfg.deviceId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`login failed (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  // A successful android login means every subsequent call should be android.
  cfg.clientId = "android";
  applyAuthResponse(cfg, data);
  return data;
}

// Serialize refreshes so concurrent calls don't stampede the auth endpoint.
let _refreshing = null;
function refreshOrLogin(cfg) {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      await refreshToken(cfg);
    } catch (e) {
      // Refresh failed — fall back to a full login if we have credentials.
      if (cfg.email && cfg.password) await login(cfg);
      else throw e;
    }
  })().finally(() => { _refreshing = null; });
  return _refreshing;
}

// Ensure the token is valid (proactively refresh if near expiry).
async function ensureToken(cfg) {
  const info = tokenInfo(cfg);
  if (info.expiresAt && info.expiresAt - Date.now() > REFRESH_BUFFER_MS) return;
  try { await refreshOrLogin(cfg); } catch { /* let the actual call surface it */ }
}

// --- Core request ------------------------------------------------------------

async function rawCall(cfg, method, endpoint, body, extraHeaders) {
  const headers = { ...authHeaders(cfg), ...(extraHeaders || {}) };
  const opts = { method, headers };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) {
      opts.body = body; // caller set Content-Type (e.g. multipart)
    } else {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  return fetch(BASE + endpoint, opts);
}

async function call(method, endpoint, body, extraHeaders) {
  const cfg = loadConfig();
  await ensureToken(cfg);

  let res = await rawCall(cfg, method, endpoint, body, extraHeaders);
  if (res.status === 401) {
    // Token rejected mid-flight — refresh (or re-login) and retry once.
    try { await refreshOrLogin(cfg); } catch { /* handled below */ }
    res = await rawCall(cfg, method, endpoint, body, extraHeaders);
    if (res.status === 401 && !cfg.password) {
      const err = new Error(
        "Session expired and can't auto-recover. Add your InkPoster { email, password } " +
        "to server/config.local.json so the server can log in automatically.");
      err.status = 401;
      err.needsLogin = true;
      throw err;
    }
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`InkPoster API ${res.status} on ${method} ${endpoint}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// --- Multipart upload for /item/convert -------------------------------------
// Zero-dep multipart/form-data builder. The convert endpoint wants the image at
// the frame's EXACT resolution (it rejects others: "Model not detected by image
// resolution"); the cloud then does the proprietary .ntx panel conversion.
function buildMultipart(fields, file) {
  const boundary = "----inkposter" + crypto.randomBytes(12).toString("hex");
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`));
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function convert(frameId, imageBuffer, filename = "userimage.jpg", mediaType = "image/jpeg") {
  const { body, contentType } = buildMultipart(
    { "frames[]": frameId },
    { filename, contentType: mediaType, buffer: imageBuffer });
  return call("POST", "/item/convert", body, {
    "Content-Type": contentType,
    "Upload-Draft-Interop-Version": "6",
    "Upload-Complete": "?1",
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Upload → poll conversion → assign to frame → nudge a sync. Returns the item id.
async function uploadAndShow(frameId, imageBuffer, filename, mediaType, onProgress) {
  const note = (m) => { try { onProgress && onProgress(m); } catch {} };
  note("uploading");
  const { queueId } = await convert(frameId, imageBuffer, filename, mediaType);
  if (!queueId) throw new Error("convert did not return a queueId");

  note("converting");
  let itemId = null;
  for (let i = 0; i < 40; i++) { // ~40 * 1.5s = 60s max
    const st = await call("POST", "/item/is-converted", { queueId });
    if (st.status === "converted") { itemId = st.item; break; }
    if (st.status === "failed") throw new Error("conversion failed: " + (st.message || "unknown"));
    await sleep(1500);
  }
  if (!itemId) throw new Error("conversion timed out");

  note("showing");
  await call("POST", "/item/show-on-frame", { frames: [frameId], items: [itemId] });
  try { await api.syncNow([frameId]); } catch {}
  return { itemId };
}

// --- API surface (see docs/reference/CLOUD_API.md) ---------------------------
const api = {
  tokenInfo: () => tokenInfo(loadConfig()),
  listFrames: () => call("GET", "/user/frames?limit=100"),
  frameStatus: () => call("GET", "/frame/status"),
  imageStatus: () => call("GET", "/frame/image-status"),
  showOnFrame: (frameIds, itemIds) =>
    call("POST", "/item/show-on-frame", { frames: frameIds, items: itemIds }),
  itemsExist: (itemIds) => call("POST", "/item/is-exists", { items: itemIds }),
  frameActions: (frameIds, actions) =>
    call("POST", "/frame/actions", { frames: frameIds, actions }),
  reportStatus: (frameIds) =>
    call("POST", "/frame/actions", { frames: frameIds, actions: ["REPORT_FRAME_STATUS"] }),
  // "Sync now": tell the device to pull new images. Takes effect on the device's
  // next wake (immediately if it's awake/charging) — e-ink frames sleep between syncs.
  syncNow: (frameIds) =>
    call("POST", "/frame/actions", { frames: frameIds, actions: ["NEW_IMAGES"] }),

  // --- Personal photo upload ---
  uploadAndShow,

  // --- Slideshows / playlists ---
  // Create a slideshow then activate it on the frame. `items` is [{id, weight}].
  // (The activate path really does have a double slash — matches the app.)
  saveSlideshow: (body) => call("POST", "/slideshow/save", body),
  slideshowToFrame: (id) => call("POST", "//item/slideshow-to-frame", { id }),
  createSlideshow: async ({ items, shuffle = false, orientation, frame, interval }) => {
    const saved = await call("POST", "/slideshow/save", {
      items, shuffle, orientation,
      frames: [{ id: frame, slideshowInterval: interval }],
    });
    if (saved && saved.id) await call("POST", "//item/slideshow-to-frame", { id: saved.id });
    return saved;
  },

  // --- Library browsing ---
  categories: () => call("GET", "/categories"),
  cards: (body, limit = 60, lastId) =>
    call("POST", `/item/cards?limit=${limit}${lastId ? "&last_id=" + lastId : ""}`, body),
  cardDetail: (cardId) => call("GET", "/item/card/" + cardId),

  // --- Firmware ---
  versionCheck: () => call("GET", "/frame/version-check"),
  checkFirmware: (frameIds) =>
    call("POST", "/frame/actions", { frames: frameIds, actions: ["CHECK_FW_UPDATE"] }),
  updateFirmware: (frameIds) =>
    call("POST", "/frame/actions", { frames: frameIds, actions: ["UPDATE_FW"] }),

  // Full-panel redraw over the cloud — clears e-ink ghosting.
  fullScreenUpdate: (frameIds) =>
    call("POST", "/frame/actions", { frames: frameIds, actions: ["FULL_SCREEN_UPDATE"] }),

  // Image-transition style (panel-specific: pipelineSwitchingMode / numberOfDivisions).
  // Patch the settings, then push the EPD-type change to the device.
  setTransition: async (frameId, patch) => {
    const r = await api.updateFrame(frameId, patch);
    await api.frameActions([frameId], ["CHANGE_EPD_TYPE_UPDATE"]);
    return r;
  },

  // --- Frame settings / rotation ---
  // Reads the current frame, merges a patch, and sends the full settings object
  // the update endpoint expects (name maps from frameName). The update REPLACES
  // the whole object, so every settings field the frame reports must be echoed
  // back — including panel-specific ones (pipelineSwitchingMode/numberOfDivisions,
  // present on the 28.5", absent on the 31.5") — or the device resets them.
  updateFrame: async (frameId, patch) => {
    const { frames } = await call("GET", "/user/frames?limit=100");
    const f = (frames || []).find((x) => x.id === frameId);
    if (!f) throw new Error("frame not found: " + frameId);
    const settings = {
      name: f.frameName,
      orientation: f.orientation,
      slideshowInterval: f.slideshowInterval,
      syncInterval: f.syncInterval,
      fullScreenUpdateHour: f.fullScreenUpdateHour,
      fullScreenUpdateMinute: f.fullScreenUpdateMinute,
    };
    if (f.pipelineSwitchingMode !== undefined) settings.pipelineSwitchingMode = f.pipelineSwitchingMode;
    if (f.numberOfDivisions !== undefined) settings.numberOfDivisions = f.numberOfDivisions;
    Object.assign(settings, patch);
    return call("POST", `/user/frame/${frameId}/update`, settings);
  },
};

module.exports = api;
