// Client-side image conditioning for the InkPoster Spectra 6-colour e-ink panel.
// Runs in-browser on <canvas>: resize to the frame's exact resolution, apply the
// app's adjustment recipe, and (optionally) preview the 6-colour dither. The
// "Send to display" button uploads the ADJUSTED (non-dithered) image — the cloud
// does its own .ntx panel conversion, so uploading a pre-dithered image would
// double-quantize. The dither view is a preview of the final look only.
const $ = (s) => document.querySelector(s);

// E Ink Spectra 6 (E6) primary colours — muted, as they render on the panel.
const PALETTE = [
  [30, 30, 30],     // black
  [235, 235, 230],  // white
  [150, 40, 40],    // red
  [200, 175, 55],   // yellow
  [55, 105, 70],    // green
  [45, 65, 130],    // blue
];

let img = null;
let FRAMES = [];

// Base (landscape) dimensions of the selected frame, e.g. [2560, 1440].
function baseDims() {
  const f = FRAMES.find((x) => x.id === $("#frame")?.value);
  if (f && f.displayResolution) {
    const [a, b] = f.displayResolution.split("x").map(Number);
    if (a && b) return [Math.max(a, b), Math.min(a, b)];
  }
  return [2560, 1440]; // fallback: 31.5" frame
}

function targetSize() {
  const [W, H] = baseDims();
  return $("#orient").value === "portrait" ? [H, W] : [W, H];
}

function drawFitted(srcCanvasCtx, W, H) {
  // Draw `img` into a WxH canvas using cover/contain.
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const ir = img.width / img.height, tr = W / H;
  let dw, dh;
  const deg = +($("#rot") ? $("#rot").value : 0);
  const swap = deg === 90 || deg === 270;
  const tw = swap ? H : W, th = swap ? W : H; // target dims in the image's frame of reference
  const irr = ir, trr = tw / th;
  const cover = $("#fit").value === "cover";
  if ((irr > trr) === cover) { dh = th; dw = th * irr; } else { dw = tw; dh = tw / irr; }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return { c, ctx };
}

// Apply saturation / brightness / contrast / gamma to ImageData in place.
function applyAdjust(data) {
  const sat = 1 + (+$("#sat").value) / 100;
  const bri = (+$("#bri").value) * 2.55;
  const con = (+$("#con").value) / 100;
  const cf = (1 + con) / (1 - con === 0 ? 0.0001 : 1 - con); // contrast factor
  const gamma = (+$("#gam").value) / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    // brightness
    r += bri; g += bri; b += bri;
    // contrast around 128
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    // saturation (toward luma)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
    // gamma
    r = 255 * Math.pow(clamp01(r / 255), gamma);
    g = 255 * Math.pow(clamp01(g / 255), gamma);
    b = 255 * Math.pow(clamp01(b / 255), gamma);
    data[i] = clamp(r); data[i + 1] = clamp(g); data[i + 2] = clamp(b);
  }
}
const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

function nearest(r, g, b) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < PALETTE.length; k++) {
    const p = PALETTE[k], dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = k; }
  }
  return PALETTE[best];
}

// Floyd–Steinberg dither to the 6-colour palette.
function dither(imgData, W, H) {
  const d = imgData.data;
  const at = (x, y) => (y * W + x) * 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      const or = d[i], og = d[i + 1], ob = d[i + 2];
      const np = nearest(or, og, ob);
      const er = or - np[0], eg = og - np[1], eb = ob - np[2];
      d[i] = np[0]; d[i + 1] = np[1]; d[i + 2] = np[2];
      spread(d, at, x + 1, y, W, H, er, eg, eb, 7 / 16);
      spread(d, at, x - 1, y + 1, W, H, er, eg, eb, 3 / 16);
      spread(d, at, x, y + 1, W, H, er, eg, eb, 5 / 16);
      spread(d, at, x + 1, y + 1, W, H, er, eg, eb, 1 / 16);
    }
  }
}
function spread(d, at, x, y, W, H, er, eg, eb, f) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = at(x, y);
  d[i] = clamp(d[i] + er * f); d[i + 1] = clamp(d[i + 1] + eg * f); d[i + 2] = clamp(d[i + 2] + eb * f);
}

function render() {
  if (!img) return;
  const [W, H] = targetSize();
  $("#dim").textContent = `${W}×${H}`;
  const { c } = drawFitted(null, W, H);
  const ctx = c.getContext("2d");
  const id = ctx.getImageData(0, 0, W, H);
  applyAdjust(id.data);
  ctx.putImageData(id, 0, 0);
  blit($("#adj"), c);          // adjusted (pre-dither)
  window.__adjusted = c;       // full-res, colour — this is what we upload

  const eink = $("#eink").checked;
  const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
  const ctx2 = c2.getContext("2d"); ctx2.putImageData(id, 0, 0);
  if (eink) { const id2 = ctx2.getImageData(0, 0, W, H); dither(id2, W, H); ctx2.putImageData(id2, 0, 0); }
  blit($("#eout"), c2);
  window.__out = c2;           // for download
  $("#download").disabled = false;
  $("#send").disabled = false;
  $("#msg").textContent = `Rendered at ${W}×${H}. ${eink ? "E-ink preview shows the 6-colour dither." : "Palette simulation off."}`;
}

// Draw a full-res canvas into a display canvas scaled down for the page.
function blit(dst, src) {
  const maxW = 460, scale = Math.min(1, maxW / src.width);
  dst.width = Math.round(src.width * scale);
  dst.height = Math.round(src.height * scale);
  const ctx = dst.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
}

const canvasToBlob = (canvas, type, q) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, q));

// Upload the adjusted (non-dithered) image to the selected frame.
async function sendToDisplay() {
  const frame = $("#frame").value;
  const btn = $("#send");
  if (!frame) { setMsg("Pick a display first.", true); return; }
  if (!window.__adjusted) { setMsg("Load a photo first.", true); return; }
  btn.disabled = true; const label = btn.textContent;
  try {
    setMsg("Preparing image…");
    const blob = await canvasToBlob(window.__adjusted, "image/jpeg", 0.92);
    btn.textContent = "Uploading…";
    setMsg("Uploading & converting on the cloud (this can take ~10–30s)…");
    const res = await fetch(`/api/upload?frame=${encodeURIComponent(frame)}&name=photo.jpg`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
    setMsg("Sent! Assigned to the display — it updates on the next wake/sync (promptly if awake or on USB-C).");
  } catch (e) {
    setMsg("Error: " + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}
function setMsg(text, isErr) {
  const el = $("#msg");
  el.textContent = text;
  el.className = isErr ? "err" : "muted";
}

// Populate the frame selector; each frame drives target resolution + orientation.
async function loadFrames() {
  try {
    const r = await fetch("/api/frames").then((x) => x.json());
    FRAMES = r.frames || [];
  } catch { FRAMES = []; }
  const sel = $("#frame");
  if (!FRAMES.length) {
    sel.innerHTML = '<option value="">(server offline — download only)</option>';
    $("#send").disabled = true;
    return;
  }
  sel.innerHTML = FRAMES.map((f) =>
    `<option value="${f.id}">${f.frameName} — ${f.displayResolution}</option>`).join("");
  syncOrientToFrame();
}
function syncOrientToFrame() {
  const f = FRAMES.find((x) => x.id === $("#frame").value);
  if (f && f.orientation) $("#orient").value = f.orientation;
  // Sensible default: the 28.5" mounts inverted, so start at 180° (overridable
  // live in the preview). Every other frame starts at 0°.
  if ($("#rot")) $("#rot").value = (f && f.modelAlias === "sharp_28_5") ? "180" : "0";
  render();
}

$("#file").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); render(); };
  img.src = url;
});
["orient", "fit", "rot", "sat", "bri", "con", "gam", "eink"].forEach(id =>
  $("#" + id).addEventListener("input", render));
$("#frame").addEventListener("change", syncOrientToFrame);
$("#download").addEventListener("click", () => {
  if (!window.__out) return;
  const a = document.createElement("a");
  a.download = "inkposter_" + targetSize().join("x") + ".png";
  a.href = window.__out.toDataURL("image/png");
  a.click();
});
$("#send").addEventListener("click", sendToDisplay);

loadFrames();
