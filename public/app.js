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

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (id) => id ? id.slice(0, 8) + "…" : "—";
const fmtBytes = (n) => (n || n === 0) ? (n / 1048576 >= 1024 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(0) + " MB") : "—";
const fmtInterval = (s) => !s ? "—" : (s % 3600 === 0 ? s / 3600 + " h" : Math.round(s / 60) + " min");
const activeFrame = () => FRAMES.find(f => f.id === $("#target").value) || FRAMES[0];

async function loadToken() {
  const t = await api.get("/api/token");
  const el = $("#token");
  if (t.expired) { el.className = "token err"; el.textContent = "Token expired — re-capture needed"; return; }
  if (!t.expiresAt) { el.className = "token"; el.textContent = ""; return; }
  const days = Math.round((t.expiresAt - Date.now()) / 86400000);
  el.className = days <= 3 ? "token warn" : "token ok";
  el.textContent = `Token valid ~${days} day(s)`;
}

async function loadFrames() {
  const [framesResp, statusResp] = await Promise.all([api.get("/api/frames"), api.get("/api/status")]);
  FRAMES = framesResp.frames || [];
  const status = {};
  (Array.isArray(statusResp) ? statusResp : []).forEach(o => Object.entries(o).forEach(([k, v]) => (status[k] = v)));

  const container = $("#frames");
  if (!FRAMES.length) { container.innerHTML = '<p class="muted">No displays found.</p>'; return; }

  container.innerHTML = FRAMES.map(f => {
    const s = status[f.id] || {};
    const battery = s.batteryCapacity != null ? s.batteryCapacity + "%" : "—";
    const wifi = s.wifiSignalStrength != null ? s.wifiSignalStrength + "%" : "—";
    const rot = (o) => `<button class="pill ${f.orientation === o ? "on" : ""}" data-rot="${f.id}" data-o="${o}">${o}</button>`;
    return `
    <div class="card">
      <h3>${esc(f.frameName)}</h3>
      <div class="sub">${esc(f.modelName)} · ${f.displayResolution} · SN ${esc(f.serialNumber)}</div>
      <div class="stats">
        <div class="stat battery"><div class="k">Battery${s.isCharging ? " ⚡" : ""}</div><div class="v">${battery}</div></div>
        <div class="stat"><div class="k">Wi-Fi</div><div class="v">${wifi}</div></div>
        <div class="stat"><div class="k">Sync interval</div><div class="v">${fmtInterval(f.syncInterval)}</div></div>
        <div class="stat"><div class="k">Free storage</div><div class="v">${fmtBytes(s.storageFreeVolume)}</div></div>
        <div class="stat"><div class="k">Firmware</div><div class="v">${esc(s.firmwareVersion || "—")}</div></div>
        <div class="stat"><div class="k">Current item</div><div class="v" title="${esc(f.currentItem?.itemId || "")}">${short(f.currentItem?.itemId)}</div></div>
      </div>
      <div class="actions">
        <span class="lbl">Orientation:</span> ${rot("landscape")} ${rot("portrait")}
        <button data-sync="${f.id}">Sync now</button>
        <button class="ghost" data-report="${f.id}">Refresh status</button>
        <label class="inline">Sync every
          <select data-interval="${f.id}">${intervalOptions(f.syncInterval)}</select>
        </label>
      </div>
      <div class="hint" data-hint="${f.id}"></div>
    </div>`;
  }).join("");

  $("#target").innerHTML = FRAMES.map(f => `<option value="${f.id}">${esc(f.frameName)}</option>`).join("");
  container.querySelectorAll("[data-report]").forEach(b => b.addEventListener("click", () => reportStatus(b.dataset.report, b)));
  container.querySelectorAll("[data-rot]").forEach(b => b.addEventListener("click", () => rotate(b.dataset.rot, b.dataset.o, b)));
  container.querySelectorAll("[data-sync]").forEach(b => b.addEventListener("click", () => syncNow(b.dataset.sync, b)));
  container.querySelectorAll("[data-interval]").forEach(sel => sel.addEventListener("change", () => setInterval2(sel.dataset.interval, +sel.value, sel)));
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
}

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

async function loadCards(categoryId) {
  const grid = $("#cards");
  grid.innerHTML = '<p class="muted">Loading…</p>';
  const res = await api.post("/api/cards", { category: categoryId, limit: 60 });
  const cards = (res.data && res.data.itemCards) || [];
  if (!cards.length) { grid.innerHTML = '<p class="muted">No artwork in this category.</p>'; return; }
  grid.innerHTML = cards.map((c, i) => {
    const thumb = c.items?.[0]?.thumbnail || "";
    const author = c.authors?.[0]?.fullName || c.authors?.[0]?.name || "";
    return `<figure class="tile" data-i="${i}">
      <img loading="lazy" src="${esc(thumb)}" alt="${esc(c.shortTitle)}" />
      <figcaption><b>${esc(c.shortTitle)}</b>${author ? "<br>" + esc(author) : ""}</figcaption>
    </figure>`;
  }).join("");
  grid.querySelectorAll(".tile").forEach(t => t.addEventListener("click", () => openPreview(cards[+t.dataset.i])));
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
  const f = activeFrame();
  const item = pickItem(selectedCard, f);
  const msg = $("#previewMsg");
  if (!item) { msg.className = "result err"; msg.textContent = "No matching item for this display."; return; }
  $("#previewShow").disabled = true; $("#previewShow").textContent = "Sending…";
  const res = await api.post("/api/show", { frames: [f.id], items: [item.id] });
  if (res.ok) {
    msg.className = "result ok";
    msg.textContent = "Sent! Updates on next sync — or hit \"Refresh status\" on the display.";
    setTimeout(loadFrames, 1500);
    setTimeout(closePreview, 1600);
  } else {
    msg.className = "result err"; msg.textContent = "Error: " + (res.data?.error || "unknown");
  }
  $("#previewShow").disabled = false; $("#previewShow").textContent = "Show on display";
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
  const res = await api.post("/api/show", { frames: [activeFrame().id], items: [itemId] });
  out.className = res.ok ? "result ok" : "result err";
  out.textContent = res.ok ? "Sent!" : "Error: " + (res.data?.error || "unknown");
  if (res.ok) setTimeout(loadFrames, 1500);
  btn.disabled = false; btn.textContent = "Show on display";
}

$("#showBtn").addEventListener("click", showById);
$("#previewShow").addEventListener("click", showCard);
$("#previewClose").addEventListener("click", closePreview);
$("#preview").addEventListener("click", (e) => { if (e.target.id === "preview") closePreview(); });

// ---- BLE direct control (optional) ----
function bleMsg(text, cls) { const el = $("#bleMsg"); el.className = "result " + (cls || ""); el.textContent = text; }
function bleSelected() { return $("#bleDevice").value; }
// The per-frame shared key (only used when the device is in secure mode).
function bleSharedKey() { return FRAMES.length === 1 ? FRAMES[0].sharedKey : undefined; }

async function bleInit() {
  const btns = ["bleScan", "bleStatus", "bleFetch", "bleGhost", "bleReboot"];
  let avail = false;
  try { avail = (await api.get("/api/ble/available")).available; } catch {}
  if (!avail) {
    const warn = $("#bleUnavailable");
    warn.classList.remove("hidden");
    warn.textContent = "No BLE backend detected. Run `npm install @stoprocent/noble` and turn on Bluetooth, then reload.";
    btns.forEach(id => { const b = $("#" + id); if (b) b.disabled = true; });
  }
}

async function bleScan() {
  const btn = $("#bleScan"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Scanning…";
  bleMsg("Scanning for InkPoster frames over Bluetooth…");
  const res = await api.post("/api/ble/scan", {});
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
}

(async () => { await loadFrames(); loadToken(); loadCategories(); bleInit(); })();
