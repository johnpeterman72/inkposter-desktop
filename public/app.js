const $ = (s) => document.querySelector(s);
const api = {
  get: (p) => fetch(p).then(r => r.json()),
  post: (p, body) => fetch(p, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => ({ ok: r.ok, data: await r.json() })),
};

let FRAMES = [];
let selectedCard = null;
let DRAFT = []; // playlist-in-progress: array of library card objects
let BLE_OK = false; // whether a BLE backend + adapter is available on this PC

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (id) => id ? id.slice(0, 8) + "…" : "—";
const fmtBytes = (n) => (n || n === 0) ? (n / 1048576 >= 1024 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(0) + " MB") : "—";
const fmtInterval = (s) => !s ? "—" : (s % 3600 === 0 ? s / 3600 + " h" : Math.round(s / 60) + " min");
const activeFrame = () => FRAMES.find(f => f.id === $("#target").value) || FRAMES[0];

async function loadToken() {
  const t = await api.get("/api/token");
  const el = $("#token"), full = $("#tokenFull");
  const setFull = (cls, txt) => { if (full) { full.className = "result " + cls; full.textContent = txt; } };
  if (t.expired) {
    el.className = "token err"; el.textContent = "Token expired";
    setFull("err", "Token expired — the server will re-login automatically if your password is in config.local.json.");
    return;
  }
  if (!t.expiresAt) { el.className = "token"; el.textContent = ""; setFull("", ""); return; }
  const days = Math.round((t.expiresAt - Date.now()) / 86400000);
  el.className = days <= 3 ? "token warn" : "token ok";
  el.textContent = `Token valid ~${days}d`;
  setFull("ok", `Signed in · token valid ~${days} day(s), until ${new Date(t.expiresAt).toLocaleDateString()}.`);
}

let STATUS = {}, FW = {};
// Merge the API's array-of-{frameId:val} into a flat {frameId:val} map.
function flatten(arr) { const o = {}; (Array.isArray(arr) ? arr : []).forEach(x => Object.entries(x).forEach(([k, v]) => (o[k] = v))); return o; }

let SELECTED = null;

// Switch the visible view (Device / Library / Playlists / Settings).
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("hidden", v.dataset.view !== name));
  document.querySelectorAll(".navitem").forEach(n => n.classList.toggle("on", n.dataset.view === name));
}

async function loadFrames() {
  const [framesResp, statusResp, fwResp] = await Promise.all([
    api.get("/api/frames"), api.get("/api/status"), api.get("/api/version-check").catch(() => []),
  ]);
  FRAMES = framesResp.frames || [];
  STATUS = flatten(statusResp);
  FW = flatten(fwResp);
  if (!FRAMES.find(f => f.id === SELECTED)) SELECTED = FRAMES[0]?.id || null;

  renderSidebarDevices();
  renderDevice();
  renderPlaylists();
  const tgt = $("#target");
  if (tgt) {
    tgt.innerHTML = (FRAMES.length > 1 ? `<option value="__all__">All displays</option>` : "") +
      FRAMES.map(f => `<option value="${f.id}">${esc(f.frameName)}</option>`).join("");
    if (SELECTED) tgt.value = SELECTED;
  }
}

const selectedFrame = () => FRAMES.find(f => f.id === SELECTED) || FRAMES[0];

// Sidebar list of displays.
function renderSidebarDevices() {
  const el = $("#devlist"); if (!el) return;
  const ink = FRAMES.map(f => {
    const s = STATUS[f.id] || {};
    const bat = s.batteryCapacity != null ? s.batteryCapacity + "%" : "—";
    const link = s.wifiSignalStrength != null ? "on" : "off";
    const on = f.id === SELECTED;
    return `<button class="devitem ${on ? "on" : ""}" data-dev="${f.id}">
      <span class="dot ${link}"></span>
      <span class="dname">${esc(f.frameName)}</span>
      <span class="dbat">${bat}${s.isCharging ? " ⚡" : ""}</span>
    </button>`;
  }).join("");
  if (!ink) { el.innerHTML = `<div class="side-label">Displays</div><div class="muted small">None found</div>`; return; }
  el.innerHTML = `<div class="side-label">Displays</div>` + ink +
    `<button class="devitem pair" title="Pairing a new frame still needs the phone app for now" disabled>+ Pair a device</button>`;
  el.querySelectorAll("[data-dev]").forEach(b => b.addEventListener("click", () => {
    SELECTED = b.dataset.dev; renderSidebarDevices(); renderDevice(); showView("device");
  }));
}

// Sized style for the framed preview: correct aspect for the frame's orientation,
// height-capped so tall portrait frames don't overflow and wide ones stay in-column.
function mountStyle(f) {
  const [a, b] = (f.displayResolution || "1600x2560").split("x").map(Number);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const [w, h] = f.orientation === "portrait" ? [lo, hi] : [hi, lo];
  return `aspect-ratio:${w} / ${h}; width:min(100%, calc(58vh * ${(w / h).toFixed(4)}))`;
}

// The Device view: big framed current-artwork preview + all device controls.
function renderDevice() {
  const host = $("#device-detail"); if (!host) return;
  const f = selectedFrame();
  if (!f) {
    host.innerHTML = `<div class="empty"><h1>No displays found</h1>
      <p class="muted">Add your InkPoster email + password in <code>server/config.local.json</code> so the server can sign in, then reload.</p></div>`;
    return;
  }
  const s = STATUS[f.id] || {};
  const ci = f.currentItem || {};
  const title = ci.title || (ci.private ? "Your photo" : (ci.itemId ? "Untitled item" : "Nothing set"));
  const author = (ci.authors && (ci.authors[0]?.fullName || ci.authors[0]?.name)) || "";
  const battery = s.batteryCapacity != null ? s.batteryCapacity + "%" : "—";
  const wifi = s.wifiSignalStrength != null ? s.wifiSignalStrength + "%" : "—";
  const rot = (o) => `<button class="pill ${f.orientation === o ? "on" : ""}" data-rot="${f.id}" data-o="${o}">${o}</button>`;
  host.innerHTML = `
    <div class="stage-head">
      <div>
        <h1>${esc(f.frameName)}</h1>
        <div class="statusline">
          <span class="chip2 ${s.wifiSignalStrength != null ? "ok" : ""}">Wi-Fi · ${wifi}</span>
          <span class="chip2">Battery ${battery}${s.isCharging ? " ⚡" : ""}</span>
          <span class="chip2" data-cell="fw-${f.id}">${esc(s.firmwareVersion || "—")}</span>
        </div>
      </div>
      <div class="head-actions">
        <a class="btn" href="/modifier.html">Send a photo…</a>
        <button class="ghost" data-report="${f.id}">Refresh</button>
      </div>
    </div>
    <div class="device-grid">
      <div class="hero">
        <div class="frame-mount" style="${mountStyle(f)}">
          <span class="ph">current artwork</span>
          ${ci.thumbnail ? `<img src="${esc(ci.thumbnail)}" alt="" />`
            : ci.itemId ? `<img src="/api/thumb?item=${encodeURIComponent(ci.itemId)}" alt="" onerror="this.remove()" />`
            : ""}
        </div>
        <div class="hero-cap">
          <span class="muted">${f.orientation} · ${f.displayResolution} · ${esc(f.modelName)}</span>
          <span class="now">Now showing: <b>${esc(title)}</b>${author ? " · " + esc(author) : ""}</span>
        </div>
        <div class="progress hidden" data-progress="${f.id}"></div>
      </div>
      <div class="side">
        <div class="sendcard" id="sendcard">
          <div class="drop" id="dropzone">
            <b>Send new artwork</b>
            <span class="muted small">Drop a photo (JPEG/PNG/HEIC/RAW) or <label class="link">browse<input type="file" id="quickfile" accept="image/*,.heic,.heif,.dng" hidden></label></span>
            <span class="muted small">Auto-resized & rotated to ${f.orientation} ${f.displayResolution}. <a href="/modifier.html">Full editor →</a></span>
          </div>
          <div id="quickMsg" class="result"></div>
        </div>
        <div class="stats">
          <div class="stat battery"><div class="k">Battery${s.isCharging ? " ⚡" : ""}</div><div class="v" data-cell="battery-${f.id}">${battery}</div></div>
          <div class="stat"><div class="k">Wi-Fi</div><div class="v" data-cell="wifi-${f.id}">${wifi}</div></div>
          <div class="stat"><div class="k">Free storage</div><div class="v" data-cell="storage-${f.id}">${fmtBytes(s.storageFreeVolume)}</div></div>
          <div class="stat"><div class="k">Sync interval</div><div class="v">${fmtInterval(f.syncInterval)}</div></div>
        </div>
        <div class="actions"><span class="lbl">Orientation:</span> ${rot("landscape")} ${rot("portrait")}</div>
        <div class="actions">
          <button data-sync="${f.id}">Sync now</button>
          ${BLE_OK ? `<button data-blefetch="${f.id}" title="Wake the frame over Bluetooth and pull now — instant, like tapping it in the phone app">⚡ Fetch now (BLE)</button>` : ""}
          <button class="ghost" data-refresh="${f.id}" title="Full-panel redraw to clear e-ink ghosting">Clear ghosting</button>
          <label class="inline">Sync every <select data-interval="${f.id}">${intervalOptions(f.syncInterval)}</select></label>
        </div>
        ${transitionRow(f)}
        ${fwRow(f)}
        ${slideshowRow(f)}
        <div class="hint" data-hint="${f.id}"></div>
      </div>
    </div>`;
  wireFrameHandlers(host);
  wireQuickSend(f);
}

// --- Inline "quick send": drop/pick a photo, resize to the frame, push ---
let UPLOAD = null; // { img, deg }
// Panels the app rotates 180° before conversion (else images land upside-down).
const needs180 = (f) => !!f && f.modelAlias === "sharp_28_5";

function wireQuickSend(f) {
  const file = $("#quickfile"), drop = $("#dropzone");
  if (!file) return;
  const handle = (fl) => { if (fl) startQuickSend(f, fl); };
  file.addEventListener("change", e => handle(e.target.files[0]));
  if (drop) {
    ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "dragend"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files[0]); });
  }
}

// Load the photo and show a preview with rotate/push (no blind pushes).
// loadImageFile (imageload.js) also decodes iPhone HEIC/HEIF and RAW (.dng).
async function startQuickSend(f, file) {
  const msg = $("#quickMsg");
  const status = (t) => { if (msg) { msg.className = "result"; msg.textContent = t; } };
  status("Reading photo…");
  try {
    const img = await loadImageFile(file, status);
    UPLOAD = { img, deg: needs180(f) ? 180 : 0 };
    showUploadPreview(f);
  } catch (e) {
    if (msg) { msg.className = "result err"; msg.textContent = "Could not read that image: " + e.message; }
  }
}

function showUploadPreview(f) {
  const card = $("#sendcard"); if (!card || !UPLOAD) return;
  card.innerHTML = `
    <div class="uprev"><canvas id="uprevCanvas"></canvas></div>
    <div class="row" style="justify-content:center">
      <button class="ghost" id="urotate">Rotate 90°</button>
      <button id="upush">Push to display</button>
      <button class="ghost" id="ucancel">Cancel</button>
    </div>
    <div id="quickMsg" class="result"></div>`;
  drawUploadPreview(f);
  $("#urotate").addEventListener("click", () => { UPLOAD.deg = (UPLOAD.deg + 90) % 360; drawUploadPreview(f); });
  $("#upush").addEventListener("click", () => pushUpload(f));
  $("#ucancel").addEventListener("click", () => { UPLOAD = null; renderDevice(); });
}

function drawUploadPreview(f) {
  const dst = $("#uprevCanvas"); if (!dst || !UPLOAD) return;
  const full = processToCanvas(UPLOAD.img, f, UPLOAD.deg);
  const maxW = 300, scale = Math.min(1, maxW / full.width);
  dst.width = Math.round(full.width * scale); dst.height = Math.round(full.height * scale);
  const ctx = dst.getContext("2d"); ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, dst.width, dst.height);
}

async function pushUpload(f) {
  const msg = $("#quickMsg");
  $("#upush").disabled = true; $("#urotate").disabled = true;
  msg.className = "result"; msg.textContent = "Uploading & converting on the cloud (~10–30s)…";
  try {
    const full = processToCanvas(UPLOAD.img, f, UPLOAD.deg);
    const blob = await new Promise((res, rej) => full.toBlob(b => b ? res(b) : rej(new Error("encode failed")), "image/jpeg", 0.92));
    const r = await fetch(`/api/upload?frame=${encodeURIComponent(f.id)}&name=photo.jpg`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `upload failed (${r.status})`);
    msg.className = "result ok"; msg.textContent = "Sent! Delivering to the display…";
    UPLOAD = null;
    pollProgress(f.id);
    setTimeout(loadFrames, 1600);
  } catch (e) { msg.className = "result err"; msg.textContent = "Error: " + e.message; $("#upush").disabled = false; $("#urotate").disabled = false; }
}

// Cover-crop + rotate an image onto the frame's exact resolution, apply the
// app's e-ink adjustment recipe. Returns a full-res canvas (cloud does .ntx).
function processToCanvas(img, f, deg) {
  const [a, b] = (f.displayResolution || "1600x2560").split("x").map(Number);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const [W, H] = f.orientation === "portrait" ? [lo, hi] : [hi, lo];
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const swap = deg === 90 || deg === 270;
  const tw = swap ? H : W, th = swap ? W : H;
  const ir = img.width / img.height, tr = tw / th; let dw, dh;
  if (ir > tr) { dh = th; dw = th * ir; } else { dw = tw; dh = tw / ir; }
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data, sat = 1.45, bri = -4 * 2.55, con = 0.07, cf = (1 + con) / (1 - con), gamma = 0.6;
  const cl = (v) => v < 0 ? 0 : v > 255 ? 255 : v, c01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] + bri, g = d[i + 1] + bri, bl = d[i + 2] + bri;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; bl = cf * (bl - 128) + 128;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; bl = lum + (bl - lum) * sat;
    d[i] = cl(255 * Math.pow(c01(r / 255), gamma));
    d[i + 1] = cl(255 * Math.pow(c01(g / 255), gamma));
    d[i + 2] = cl(255 * Math.pow(c01(bl / 255), gamma));
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// Playlists view: a builder (from the Library draft) + existing slideshows.
function renderPlaylists() {
  const el = $("#playlists"); if (!el) return;
  el.innerHTML = playlistBuilderHTML() + existingSlideshowsHTML();
  const create = $("#pl-create"); if (create) create.addEventListener("click", createPlaylist);
  const clear = $("#pl-clear"); if (clear) clear.addEventListener("click", () => { DRAFT = []; renderPlaylists(); });
  el.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { DRAFT.splice(+b.dataset.rm, 1); renderPlaylists(); }));
  const fs = $("#pl-frame"); if (fs && SELECTED) fs.value = SELECTED;
}

function playlistBuilderHTML() {
  if (!FRAMES.length) return "";
  const frameOpts = FRAMES.map(f => `<option value="${f.id}">${esc(f.frameName)}</option>`).join("");
  const ivOpts = [60, 120, 180, 300, 600, 1800, 3600].map(s => `<option value="${s}">${fmtInterval(s)}</option>`).join("");
  const draft = DRAFT.length
    ? `<div class="ss-thumbs">${DRAFT.map((c, i) => {
        const th = c.items && c.items[0] && c.items[0].thumbnail;
        return `<span class="ss-thumb draft" title="${esc(c.shortTitle || "")}">${th ? `<img src="${esc(th)}" alt="" />` : ""}<button class="rm" data-rm="${i}" title="Remove">×</button></span>`;
      }).join("")}</div>`
    : `<p class="muted small">Empty. Open an artwork in the <b>Library</b> and choose “Add to playlist,” then come back here.</p>`;
  return `<div class="panel">
    <h2>New playlist</h2>
    ${draft}
    <div class="row">
      <label>Play on <select id="pl-frame">${frameOpts}</select></label>
      <label>Every <select id="pl-interval">${ivOpts}</select></label>
      <label class="inline"><input type="checkbox" id="pl-shuffle" /> Shuffle</label>
      <button id="pl-create" ${DRAFT.length ? "" : "disabled"}>Create playlist</button>
      ${DRAFT.length ? `<button class="ghost" id="pl-clear">Clear draft</button>` : ""}
    </div>
    <div id="pl-msg" class="result"></div>
  </div>`;
}

function existingSlideshowsHTML() {
  const withSs = FRAMES.filter(f => (f.slideshows || []).length);
  if (!withSs.length) return "";
  return `<h2 class="section-h">On your displays</h2>` + withSs.map(f => `
    <div class="panel">
      <h2>${esc(f.frameName)} <span class="muted">· every ${fmtInterval(f.slideshowInterval)}</span></h2>
      ${(f.slideshows || []).map(ss => {
        const on = ss.id === f.currentSlideshowId; const items = ss.items || [];
        return `<div class="ss ${on ? "active" : ""}">
          <div class="ss-head">${on ? "▶ active · " : ""}${items.length} slides · ${ss.orientation}${ss.shuffle ? " · shuffle" : ""}</div>
          <div class="ss-thumbs">${items.slice(0, 16).map(i => `<span class="ss-thumb">${i.thumbnail ? `<img src="${esc(i.thumbnail)}" alt="" loading="lazy" />` : ""}</span>`).join("")}</div>
        </div>`;
      }).join("")}
    </div>`).join("");
}

function addToDraft(card) {
  if (card && !DRAFT.find(c => c.id === card.id)) DRAFT.push(card);
}

// Create a playlist from the draft: resolve each card to the item variant that
// matches the target frame's model, then save + activate.
async function createPlaylist() {
  const frameId = $("#pl-frame").value;
  const f = FRAMES.find(x => x.id === frameId);
  const interval = +$("#pl-interval").value;
  const shuffle = $("#pl-shuffle").checked;
  const msg = $("#pl-msg");
  if (!f || !DRAFT.length) return;
  const items = []; let missing = 0;
  DRAFT.forEach((card, i) => {
    const it = pickItem(card, f);
    if (it) items.push({ id: it.id, weight: i }); else missing++;
  });
  if (!items.length) { msg.className = "result err"; msg.textContent = "None of these artworks have a variant for this display."; return; }
  const btn = $("#pl-create"); btn.disabled = true; btn.textContent = "Creating…";
  const res = await api.post("/api/slideshow", { items, shuffle, orientation: f.orientation, frame: frameId, interval });
  if (res.ok) {
    msg.className = "result ok";
    msg.textContent = `Playlist created — ${items.length} slide${items.length > 1 ? "s" : ""} on ${f.frameName}, every ${fmtInterval(interval)}${missing ? ` (${missing} skipped — no variant for this display)` : ""}.`;
    DRAFT = [];
    setTimeout(loadFrames, 1200);
  } else {
    msg.className = "result err"; msg.textContent = "Failed: " + (res.data?.error || "unknown");
    btn.disabled = false; btn.textContent = "Create playlist";
  }
}

// Firmware row: shows an update banner (charging-gated) or an up-to-date line.
function fwRow(f) {
  const v = FW[f.id];
  if (v && v.newVersionAvailable) {
    const charging = (STATUS[f.id] || {}).isCharging;
    return `<div class="subrow" data-fwrow="${f.id}">
      <span class="badge warn">Firmware ${esc(v.version)} available</span>
      ${v.releaseNotes ? `<span class="muted">${esc(v.releaseNotes)}</span>` : ""}
      <button data-fwupdate="${f.id}" ${charging ? "" : "disabled"}>Update firmware</button>
      ${charging ? "" : `<span class="muted">connect to power to update</span>`}
    </div>`;
  }
  return `<div class="subrow" data-fwrow="${f.id}">
    <span class="muted">Firmware up to date</span>
    <button class="ghost" data-fwcheck="${f.id}">Check for update</button>
  </div>`;
}

// Image-transition control — only for panels that expose it (e.g. the 28.5").
// pipelineSwitchingMode 0-4 = refresh effect; numberOfDivisions 1/2/4/8/16 = bands.
function transitionRow(f) {
  if (f.pipelineSwitchingMode === undefined) return "";
  const modeOpts = [0, 1, 2, 3, 4].map(m =>
    `<option value="${m}" ${f.pipelineSwitchingMode === m ? "selected" : ""}>${m === 0 ? "Off (full flash)" : "Mode " + m}</option>`).join("");
  const divOpts = [1, 2, 4, 8, 16].map(d =>
    `<option value="${d}" ${f.numberOfDivisions === d ? "selected" : ""}>${d === 1 ? "whole panel" : d + " bands"}</option>`).join("");
  return `<div class="subrow">
    <span class="lbl">Transition:</span>
    <select data-transmode="${f.id}" title="Panel refresh effect">${modeOpts}</select>
    <select data-transdiv="${f.id}" title="How many bands the panel reveals in">${divOpts}</select>
  </div>`;
}

// Slideshow display (read-only): existing playlists on the frame.
function slideshowRow(f) {
  const list = f.slideshows || [];
  if (!list.length) return "";
  return `<div class="subrow">
    <span class="lbl">Slideshow:</span>
    ${list.map(ss => {
      const on = ss.id === f.currentSlideshowId;
      const n = (ss.items || []).length;
      return `<span class="chip ${on ? "on" : ""}" title="${ss.orientation}${ss.shuffle ? " · shuffle" : ""}">${on ? "▶ " : ""}${n} slides · every ${fmtInterval(f.slideshowInterval)}</span>`;
    }).join("")}
  </div>`;
}

function wireFrameHandlers(container) {
  container.querySelectorAll("[data-report]").forEach(b => b.addEventListener("click", () => reportStatus(b.dataset.report, b)));
  container.querySelectorAll("[data-rot]").forEach(b => b.addEventListener("click", () => rotate(b.dataset.rot, b.dataset.o, b)));
  container.querySelectorAll("[data-sync]").forEach(b => b.addEventListener("click", () => syncNow(b.dataset.sync, b)));
  container.querySelectorAll("[data-interval]").forEach(sel => sel.addEventListener("change", () => setInterval2(sel.dataset.interval, +sel.value, sel)));
  container.querySelectorAll("[data-refresh]").forEach(b => b.addEventListener("click", () => fullRefresh(b.dataset.refresh, b)));
  container.querySelectorAll("[data-fwcheck]").forEach(b => b.addEventListener("click", () => checkFw(b.dataset.fwcheck, b)));
  container.querySelectorAll("[data-fwupdate]").forEach(b => b.addEventListener("click", () => updateFw(b.dataset.fwupdate, b)));
  container.querySelectorAll("[data-transmode],[data-transdiv]").forEach(s => s.addEventListener("change", () => applyTransition(s.dataset.transmode || s.dataset.transdiv)));
  container.querySelectorAll("[data-blefetch]").forEach(b => b.addEventListener("click", () => bleFetchFrame(b.dataset.blefetch, b)));
}

// Instant push over Bluetooth: wake the selected frame and pull now. Targets the
// frame's own BLE device (InkP-<serial>) and signs with its shared key.
async function bleFetchFrame(frameId, btn) {
  const f = FRAMES.find(x => x.id === frameId); if (!f) return;
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Connecting…";
  hint(frameId, "Waking the frame over Bluetooth (scan + connect takes ~15–20s)…");
  const res = await api.post("/api/ble/fetch", { name: "InkP-" + f.serialNumber, sharedKey: f.sharedKey });
  hint(frameId, res.ok
    ? `Fetch sent over Bluetooth (${res.data.usedKey} key). The frame wakes and pulls its current image now.`
    : "Bluetooth fetch failed: " + (res.data?.error || "unknown") + (/unreachable/i.test(res.data?.error || "") ? " — make sure the frame isn't paired in Windows Bluetooth." : ""));
  if (res.ok) pollProgress(frameId);
  btn.disabled = false; btn.textContent = t;
}

const INTERVALS = [[300, "5 min"], [600, "10 min"], [900, "15 min"], [1800, "30 min"], [3600, "1 hour"], [7200, "2 hours"], [21600, "6 hours"], [43200, "12 hours"], [86400, "24 hours"]];
function intervalOptions(current) {
  const opts = INTERVALS.slice();
  if (!opts.find(([s]) => s === current)) opts.unshift([current, Math.round(current / 60) + " min"]);
  return opts.map(([s, l]) => `<option value="${s}" ${s === current ? "selected" : ""}>${l}</option>`).join("");
}
function hint(frameId, text) { const el = document.querySelector(`[data-hint="${frameId}"]`); if (el) el.textContent = text; }

async function syncNow(frameId, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Syncing…";
  const res = await api.post("/api/sync-now", { frames: [frameId] });
  hint(frameId, res.ok
    ? "Sync signal sent. The panel updates on the device's next wake — promptly if it's awake or on USB-C, otherwise by the next sync interval."
    : "Sync failed: " + (res.data?.error || "unknown"));
  btn.disabled = false; btn.textContent = t;
  if (res.ok) pollProgress(frameId);
}

// Poll image-transfer progress after a show/sync until the panel has it.
async function pollProgress(frameId) {
  for (let i = 0; i < 24; i++) {
    const el = document.querySelector(`[data-progress="${frameId}"]`);
    if (el) el.classList.remove("hidden");
    await new Promise(r => setTimeout(r, 3000));
    const p = flatten(await api.get("/api/image-status").catch(() => []))[frameId];
    const cur = document.querySelector(`[data-progress="${frameId}"]`);
    if (!cur || !p) continue;
    if (p.error) { cur.innerHTML = `<span class="result err">Transfer error on the panel.</span>`; return; }
    const pct = p.progress ?? 0;
    cur.innerHTML = `<div class="bar"><div class="fill" style="width:${pct}%"></div></div>` +
      `<span class="muted">Transferring to panel… ${pct}%${p.sentToEpd ? " · drawing" : ""}</span>`;
    if (pct >= 100 && p.sentToEpd) {
      cur.innerHTML = `<span class="result ok">Delivered to the panel.</span>`;
      setTimeout(() => cur.classList.add("hidden"), 5000);
      return;
    }
  }
}

// Clear ghosting via the cloud (full-panel redraw).
async function fullRefresh(frameId, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Clearing…";
  const res = await api.post("/api/full-refresh", { frames: [frameId] });
  hint(frameId, res.ok
    ? "Full-panel redraw sent — clears ghosting on the device's next wake."
    : "Failed: " + (res.data?.error || "unknown"));
  btn.disabled = false; btn.textContent = t;
}

async function checkFw(frameId, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Checking…";
  hint(frameId, "Asking the frame to check for firmware…");
  await api.post("/api/firmware/check", { frames: [frameId] });
  await new Promise(r => setTimeout(r, 4500)); // let the device report back to the cloud
  await loadFrames();
  const v = FW[frameId];
  hint(frameId, v && v.newVersionAvailable ? `Update available: ${v.version}` : "Firmware is up to date.");
}

async function updateFw(frameId, btn) {
  if (!confirm("Update firmware now? The frame will download the update and reboot to apply it — keep it connected to power. This can take several minutes.")) return;
  btn.disabled = true; btn.textContent = "Starting…";
  const res = await api.post("/api/firmware/update", { frames: [frameId] });
  hint(frameId, res.ok
    ? "Firmware update started. The frame downloads and reboots to apply it (several minutes). Status refreshes automatically."
    : "Failed to start update: " + (res.data?.error || "unknown"));
}

// Image-transition style (panel-specific): pipelineSwitchingMode 0-4 + divisions.
async function applyTransition(frameId) {
  const f = FRAMES.find(x => x.id === frameId); if (!f) return;
  const mode = +document.querySelector(`[data-transmode="${frameId}"]`).value;
  const div = +document.querySelector(`[data-transdiv="${frameId}"]`).value;
  const res = await api.post("/api/transition", { frame: frameId, pipelineSwitchingMode: mode, numberOfDivisions: div });
  if (res.ok) { f.pipelineSwitchingMode = mode; f.numberOfDivisions = div; }
  hint(frameId, res.ok
    ? `Transition set: ${mode === 0 ? "off (full flash)" : "mode " + mode}, ${div === 1 ? "whole panel" : div + " bands"}. Applies on the next image change.`
    : "Failed: " + (res.data?.error || "unknown"));
}

// Light background poll: refresh live telemetry cells without a full re-render.
async function refreshLive() {
  if (document.hidden) return;
  const st = flatten(await api.get("/api/status").catch(() => []));
  for (const [id, s] of Object.entries(st)) {
    STATUS[id] = s;
    const set = (k, val) => { const el = document.querySelector(`[data-cell="${k}-${id}"]`); if (el) el.textContent = val; };
    if (s.batteryCapacity != null) set("battery", s.batteryCapacity + "%");
    if (s.wifiSignalStrength != null) set("wifi", s.wifiSignalStrength + "%");
    if (s.firmwareVersion) set("fw", s.firmwareVersion);
    if (s.storageFreeVolume != null) set("storage", fmtBytes(s.storageFreeVolume));
  }
}
function startAutoPoll() { window.setInterval(refreshLive, 45000); }

async function setInterval2(frameId, seconds, sel) {
  sel.disabled = true;
  const res = await api.post("/api/set-sync-interval", { frame: frameId, seconds });
  hint(frameId, res.ok ? `Sync interval set to ${sel.options[sel.selectedIndex].text}. (Shorter = fresher, more battery use.)` : "Failed: " + (res.data?.error || "unknown"));
  sel.disabled = false;
  const f = FRAMES.find(x => x.id === frameId); if (f) f.syncInterval = seconds;
}

async function rotate(frameId, orientation, btn) {
  if (FRAMES.find(f => f.id === frameId)?.orientation === orientation) return;
  btn.disabled = true;
  const res = await api.post("/api/rotate", { frame: frameId, orientation });
  if (res.ok) { await loadFrames(); } else { alert("Rotate failed: " + (res.data?.error || "unknown")); btn.disabled = false; }
}

async function reportStatus(frameId, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Requesting…";
  await api.post("/api/report-status", { frames: [frameId] });
  setTimeout(async () => { await loadFrames(); }, 2500);
  setTimeout(() => { btn.disabled = false; btn.textContent = t; }, 2600);
}

// ---- Library ----
async function loadCategories() {
  const data = await api.get("/api/categories");
  const cats = data.categories || [];
  const el = $("#cats");
  if (!cats.length) { el.innerHTML = '<span class="muted">No categories.</span>'; return; }
  el.innerHTML = cats.map((c, i) => `<button class="chip ${i === 0 ? "on" : ""}" data-cat="${c.id}">${esc(c.title)}</button>`).join("");
  el.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => {
    el.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    loadCards(b.dataset.cat);
  }));
  if (cats[0]) loadCards(cats[0].id);
}

let LIB = { category: null, cards: [], lastId: null, loading: false, done: false };

async function loadCards(categoryId) {
  LIB = { category: categoryId, cards: [], lastId: null, loading: false, done: false };
  if ($("#libSearch")) $("#libSearch").value = "";
  $("#cards").innerHTML = '<p class="muted">Loading…</p>';
  await loadMoreCards();
}

async function loadMoreCards() {
  if (LIB.loading || LIB.done) return;
  LIB.loading = true;
  const more = $("#libMore"); if (more) { more.disabled = true; more.textContent = "Loading…"; }
  const res = await api.post("/api/cards", { category: LIB.category, limit: 120, lastId: LIB.lastId });
  const page = (res.data && res.data.itemCards) || [];
  LIB.cards.push(...page);
  LIB.lastId = page.length ? page[page.length - 1].id : LIB.lastId;
  if (page.length < 120) LIB.done = true;
  LIB.loading = false;
  renderCards();
}

function renderCards() {
  const grid = $("#cards");
  const q = ($("#libSearch") ? $("#libSearch").value : "").trim().toLowerCase();
  const list = LIB.cards.map((c, i) => ({ c, i })).filter(({ c }) =>
    !q || (c.shortTitle || "").toLowerCase().includes(q) ||
    (c.authors || []).some(a => (a.fullName || a.name || "").toLowerCase().includes(q)));
  if (!LIB.cards.length) grid.innerHTML = '<p class="muted">No artwork in this category.</p>';
  else if (!list.length) grid.innerHTML = '<p class="muted">No matches in the loaded set — try “Load more.”</p>';
  else {
    grid.innerHTML = list.map(({ c, i }) => {
      const thumb = c.items?.[0]?.thumbnail || "";
      const author = c.authors?.[0]?.fullName || c.authors?.[0]?.name || "";
      return `<figure class="tile" data-i="${i}">
        <img loading="lazy" src="${esc(thumb)}" alt="${esc(c.shortTitle)}" />
        <figcaption><b>${esc(c.shortTitle)}</b>${author ? "<br>" + esc(author) : ""}</figcaption>
      </figure>`;
    }).join("");
    grid.querySelectorAll(".tile").forEach(t => t.addEventListener("click", () => openPreview(LIB.cards[+t.dataset.i])));
  }
  const more = $("#libMore");
  if (more) { more.classList.toggle("hidden", LIB.done || !LIB.cards.length); more.disabled = false; more.textContent = "Load more"; }
}

// ---- Preview + show ----
function openPreview(card) {
  selectedCard = card;
  const f = activeFrame();
  const item = pickItem(card, f);
  $("#previewImg").src = (item?.thumbnail) || card.items?.[0]?.thumbnail || "";
  $("#previewTitle").textContent = card.shortTitle || "Artwork";
  const author = card.authors?.[0]?.fullName || card.authors?.[0]?.name || "";
  const warn = item ? "" : `  ⚠ no ${f?.modelAlias} variant`;
  $("#previewSub").textContent = [author, card.orientation, warn].filter(Boolean).join(" · ");
  $("#previewMsg").className = "result"; $("#previewMsg").textContent = "";
  $("#previewShow").disabled = !item;
  $("#preview").classList.remove("hidden");
}
function closePreview() { $("#preview").classList.add("hidden"); selectedCard = null; }

// Pick the item variant matching the frame's model (and orientation if possible)
function pickItem(card, frame) {
  if (!frame) return card.items?.[0];
  const byModel = (card.items || []).filter(i => i.modelAlias === frame.modelAlias);
  return byModel.find(i => i.orientation === frame.orientation) || byModel[0] || null;
}

async function showCard() {
  const msg = $("#previewMsg");
  const targets = $("#target").value === "__all__" ? FRAMES : [activeFrame()];
  // Resolve the model-matched item variant per target frame.
  const jobs = targets.map(f => ({ f, item: pickItem(selectedCard, f) })).filter(j => j.item);
  if (!jobs.length) { msg.className = "result err"; msg.textContent = "No matching variant for the selected display(s)."; return; }
  $("#previewShow").disabled = true; $("#previewShow").textContent = "Sending…";
  let ok = 0;
  for (const j of jobs) {
    const res = await api.post("/api/show", { frames: [j.f.id], items: [j.item.id] });
    if (res.ok) { ok++; pollProgress(j.f.id); }
  }
  if (ok) {
    msg.className = "result ok";
    msg.textContent = `Sent to ${ok} display${ok > 1 ? "s" : ""}. Updates on next sync — or hit Refresh on the display.`;
    setTimeout(loadFrames, 1500); setTimeout(closePreview, 1600);
  } else { msg.className = "result err"; msg.textContent = "Failed to send."; }
  $("#previewShow").disabled = false; $("#previewShow").textContent = "Show now";
}

// ---- Advanced: show by ID ----
async function showById() {
  const btn = $("#showBtn"), out = $("#showResult");
  const itemId = $("#itemId").value.trim();
  out.className = "result"; out.textContent = "";
  if (!itemId) { out.className = "result err"; out.textContent = "Enter an item ID."; return; }
  btn.disabled = true; btn.textContent = "Sending…";
  const exists = await api.post("/api/items-exist", { items: [itemId] });
  const ok = Array.isArray(exists.data) && exists.data[0] && exists.data[0][itemId];
  if (!ok) { out.className = "result err"; out.textContent = "That item ID doesn't exist on your account."; btn.disabled = false; btn.textContent = "Show on display"; return; }
  const f = activeFrame();
  const res = await api.post("/api/show", { frames: [f.id], items: [itemId] });
  out.className = res.ok ? "result ok" : "result err";
  out.textContent = res.ok ? "Sent!" : "Error: " + (res.data?.error || "unknown");
  if (res.ok) { setTimeout(loadFrames, 1500); pollProgress(f.id); }
  btn.disabled = false; btn.textContent = "Show on display";
}

$("#showBtn").addEventListener("click", showById);
$("#previewShow").addEventListener("click", showCard);
$("#previewAdd").addEventListener("click", () => {
  addToDraft(selectedCard);
  renderPlaylists();
  const m = $("#previewMsg"); m.className = "result ok";
  m.textContent = `Added to playlist draft (${DRAFT.length}). Open Playlists to finish.`;
});
$("#previewClose").addEventListener("click", closePreview);
$("#preview").addEventListener("click", (e) => { if (e.target.id === "preview") closePreview(); });
$("#libSearch")?.addEventListener("input", renderCards);
$("#libMore")?.addEventListener("click", () => loadMoreCards());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePreview(); });

// ---- BLE direct control (optional) ----
function bleMsg(text, cls) { const el = $("#bleMsg"); el.className = "result " + (cls || ""); el.textContent = text; }
function bleSelected() { return $("#bleDevice").value; }
let BLE_DEVICES = [];
// The per-frame shared key (required in secure mode). Match the selected BLE
// device (named "InkP-<serial>") to its cloud frame by serial number.
function bleSharedKey() {
  const dev = BLE_DEVICES.find(d => d.id === bleSelected());
  const serial = dev && dev.name ? dev.name.replace(/^InkP-/, "") : null;
  const f = serial && FRAMES.find(x => x.serialNumber === serial);
  if (f) return f.sharedKey;
  return FRAMES.length === 1 ? FRAMES[0].sharedKey : undefined;
}

async function bleInit() {
  const btns = ["bleScan", "bleStatus", "bleFetch", "bleGhost", "bleReboot"];
  let avail = false;
  try { avail = (await api.get("/api/ble/available")).available; } catch {}
  BLE_OK = avail;
  if (!avail) {
    const warn = $("#bleUnavailable");
    warn.classList.remove("hidden");
    warn.textContent = "No BLE backend detected. Run `npm install @stoprocent/noble` and turn on Bluetooth, then reload.";
    btns.forEach(id => { const b = $("#" + id); if (b) b.disabled = true; });
  } else {
    renderDevice(); // now that BLE is confirmed, show the Device-view "Fetch now (BLE)" button
  }
}

async function bleScan() {
  const btn = $("#bleScan"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Scanning…";
  bleMsg("Scanning for InkPoster frames over Bluetooth…");
  const res = await api.post("/api/ble/scan", {});
  BLE_DEVICES = (res.ok && res.data.devices) || [];
  if (res.ok && res.data.devices?.length) {
    $("#bleDevice").innerHTML = res.data.devices.map(d => `<option value="${d.id}">${esc(d.name)} (${d.rssi} dBm)</option>`).join("");
    bleMsg(`Found ${res.data.devices.length} frame(s).`, "ok");
  } else {
    $("#bleDevice").innerHTML = '<option value="">(none found)</option>';
    bleMsg(res.ok ? "No InkPoster frames found nearby." : "Scan failed: " + (res.data?.error || "unknown"), "err");
  }
  btn.disabled = false; btn.textContent = t;
}

async function bleReadStatus() {
  bleMsg("Reading status over Bluetooth…");
  const res = await api.post("/api/ble/status", { id: bleSelected() || undefined });
  if (!res.ok) return bleMsg("Status failed: " + (res.data?.error || "unknown"), "err");
  const s = res.data;
  bleMsg(`${s.name || s.deviceId} · ${s.model} · fw ${s.firmware} · battery ${s.battery}% · wifi ${s.wifiQuality}% · ` +
    `${s.launcherCmdReady ? "ready" : "NOT ready"}${s.secureMode ? " · secure" : ""}`, "ok");
}

async function bleAction(path, label, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Sending…";
  bleMsg(`Sending ${label} over Bluetooth…`);
  const res = await api.post(path, { id: bleSelected() || undefined, sharedKey: bleSharedKey() });
  bleMsg(res.ok ? `${label} sent (msgSeq ${res.data.msgSeq}, ${res.data.usedKey} key).` : `${label} failed: ` + (res.data?.error || "unknown"), res.ok ? "ok" : "err");
  btn.disabled = false; btn.textContent = t;
}

if ($("#bleScan")) {
  $("#bleScan").addEventListener("click", bleScan);
  $("#bleStatus").addEventListener("click", bleReadStatus);
  $("#bleFetch").addEventListener("click", (e) => bleAction("/api/ble/fetch", "Fetch now", e.target));
  $("#bleGhost").addEventListener("click", (e) => bleAction("/api/ble/ghosting-clean", "Ghosting clean", e.target));
  $("#bleReboot").addEventListener("click", (e) => bleAction("/api/ble/reboot", "Reboot", e.target));
  $("#wifiSend").addEventListener("click", async (e) => {
    const ssid = $("#wifiSsid").value.trim(), passwd = $("#wifiPass").value;
    if (!ssid) { bleMsg("Enter a Wi-Fi network name (SSID).", "err"); return; }
    e.target.disabled = true; const t = e.target.textContent; e.target.textContent = "Sending…";
    bleMsg("Sending Wi-Fi credentials to the frame over Bluetooth…");
    const res = await api.post("/api/ble/set-wifi", { ssid, passwd, id: bleSelected() || undefined, sharedKey: bleSharedKey() });
    bleMsg(res.ok ? "Wi-Fi settings sent — the frame will reconnect." : "Failed: " + (res.data?.error || "unknown"), res.ok ? "ok" : "err");
    e.target.disabled = false; e.target.textContent = t;
  });
}

document.querySelectorAll(".navitem").forEach(n => n.addEventListener("click", () => showView(n.dataset.view)));
(async () => { await loadFrames(); loadToken(); loadCategories(); bleInit(); startAutoPoll(); showView("device"); })();
