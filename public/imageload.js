// Shared photo loader for both upload paths (Device quick-send + modifier).
// Handles what a plain <img> can't: iPhone HEIC/HEIF (decoded in-browser with
// the vendored heic2any/libheif — loaded lazily, only when a HEIC is opened)
// and iPhone RAW / Apple ProRAW (.dng) — we extract the full-size JPEG preview
// embedded in the DNG instead of demosaicing the raw data; ProRAW previews are
// full-resolution, which is far beyond what the e-ink panel needs anyway.
// Exposes window.loadImageFile(file, onStatus?) → Promise<HTMLImageElement|canvas>.
(function () {
  "use strict";

  const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

  const extOf = (name) => (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  const isHeicFile = (f) => /image\/hei[cf]/.test(f.type) || ["heic", "heif"].includes(extOf(f.name));
  const isDngFile = (f) => /dng/.test(f.type) || extOf(f.name) === "dng";

  function isHeicBytes(u8) {
    if (u8.length < 12) return false;
    if (String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) !== "ftyp") return false;
    return HEIC_BRANDS.includes(String.fromCharCode(u8[8], u8[9], u8[10], u8[11]));
  }

  // --- generic blob → HTMLImageElement (browser applies EXIF orientation) ---
  function decodeBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("not a decodable image")); };
      img.src = url;
    });
  }

  // --- HEIC: lazy-load the vendored decoder, convert to JPEG, decode that ---
  let heicLibPromise = null;
  function ensureHeicLib() {
    if (window.heic2any) return Promise.resolve();
    if (!heicLibPromise) heicLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/heic2any.min.js";
      s.onload = () => resolve();
      s.onerror = () => { heicLibPromise = null; reject(new Error("could not load the HEIC decoder")); };
      document.head.appendChild(s);
    });
    return heicLibPromise;
  }

  async function decodeHeic(blob, onStatus) {
    // Some browsers (Safari) decode HEIC natively — try that first, it's instant.
    try { return await decodeBlob(blob); } catch {}
    onStatus?.("Converting HEIC photo…");
    await ensureHeicLib();
    let out = await window.heic2any({ blob, toType: "image/jpeg", quality: 0.95 });
    if (Array.isArray(out)) out = out[0]; // burst/multi-image HEIC → first frame
    return decodeBlob(out);
  }

  // --- DNG / TIFF: walk the IFD tree and pull out the embedded JPEG previews ---
  // Tags: 0x0103 Compression (6/7 = JPEG), 0x0111/0x0117 strips,
  // 0x0201/0x0202 old-style JPEG offset/length, 0x014A SubIFDs, 0x0112 Orientation.
  function parseTiff(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const bom = dv.getUint16(0);
    if (bom !== 0x4949 && bom !== 0x4d4d) return null;
    const le = bom === 0x4949;
    if (dv.getUint16(2, le) !== 42) return null;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const TYPE_SIZE = { 1: 1, 3: 2, 4: 4, 13: 4 };

    const candidates = [];
    let orientation = 0;
    const queue = [{ off: u32(4), ifd0: true }], seen = new Set();
    while (queue.length) {
      const { off, ifd0 } = queue.shift();
      if (!off || off + 2 > u8.length || seen.has(off)) continue;
      seen.add(off);
      const n = u16(off);
      if (off + 2 + n * 12 + 4 > u8.length) continue;
      const entry = {};
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const size = (TYPE_SIZE[type] || 0) * count;
        if (!size) continue;
        const at = size <= 4 ? e + 8 : u32(e + 8);
        if (at + size > u8.length) continue;
        const vals = [];
        for (let k = 0; k < count && k < 4096; k++)
          vals.push(type === 1 ? u8[at + k] : type === 3 ? u16(at + k * 2) : u32(at + k * 4));
        entry[tag] = vals;
      }
      if (ifd0 && entry[0x0112]) orientation = entry[0x0112][0] || 0;
      (entry[0x014a] || []).forEach((sub) => queue.push({ off: sub }));
      if (entry[0x8769]) queue.push({ off: entry[0x8769][0] }); // Exif IFD
      const next = u32(off + 2 + n * 12);
      if (next) queue.push({ off: next });

      const comp = entry[0x0103] && entry[0x0103][0];
      if ((comp === 7 || comp === 6) && entry[0x0111] && entry[0x0117] && entry[0x0111].length === 1)
        candidates.push({ off: entry[0x0111][0], len: entry[0x0117][0] });
      if (entry[0x0201] && entry[0x0202])
        candidates.push({ off: entry[0x0201][0], len: entry[0x0202][0] });
    }
    const jpegs = candidates.filter((c) =>
      c.len > 4 && c.off + c.len <= u8.length && u8[c.off] === 0xff && u8[c.off + 1] === 0xd8);
    jpegs.sort((a, b) => b.len - a.len);
    return { orientation, jpeg: jpegs[0] ? u8.subarray(jpegs[0].off, jpegs[0].off + jpegs[0].len) : null };
  }

  // Last-resort: scan the raw bytes for the largest FFD8…FFD9 JPEG span.
  function scanForJpeg(u8) {
    const starts = [];
    for (let i = 0; i < u8.length - 2; i++)
      if (u8[i] === 0xff && u8[i + 1] === 0xd8 && u8[i + 2] === 0xff) starts.push(i);
    let best = null;
    for (let s = 0; s < starts.length; s++) {
      const bound = s + 1 < starts.length ? starts[s + 1] : u8.length;
      for (let j = bound - 2; j > starts[s]; j--) {
        if (u8[j] === 0xff && u8[j + 1] === 0xd9) {
          const len = j + 2 - starts[s];
          if (!best || len > best.len) best = { off: starts[s], len };
          break;
        }
      }
    }
    return best ? u8.subarray(best.off, best.off + best.len) : null;
  }

  // Does this JPEG carry its own EXIF orientation? (If so the browser applies it
  // and we must NOT also apply the DNG's orientation tag — no double-rotating.)
  function jpegExifOrientation(u8) {
    let i = 2;
    while (i + 4 < u8.length && u8[i] === 0xff) {
      const marker = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
      if (marker === 0xda || marker === 0xd9) break; // image data — no more headers
      if (marker === 0xe1 && String.fromCharCode(...u8.subarray(i + 4, i + 10)) === "Exif\0\0") {
        const t = parseTiff(u8.subarray(i + 10, i + 2 + len));
        return (t && t.orientation) || 0;
      }
      i += 2 + len;
    }
    return 0;
  }

  // Bake an EXIF orientation (2–8) into a canvas so downstream drawImage is upright.
  function bakeOrientation(img, o) {
    if (!o || o === 1) return img;
    const w = img.width, h = img.height, swap = o >= 5;
    const c = document.createElement("canvas");
    c.width = swap ? h : w; c.height = swap ? w : h;
    const ctx = c.getContext("2d");
    const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
      5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] };
    ctx.setTransform(...(T[o] || [1, 0, 0, 1, 0, 0]));
    ctx.drawImage(img, 0, 0);
    return c;
  }

  async function decodeDng(file, onStatus) {
    onStatus?.("Reading RAW photo…");
    const u8 = new Uint8Array(await file.arrayBuffer());
    const tiff = parseTiff(u8) || { orientation: 0, jpeg: null };
    const jpeg = tiff.jpeg || scanForJpeg(u8);
    if (!jpeg) throw new Error("no embedded preview found in this RAW file");
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    const img = await decodeBlob(blob);
    // The browser already honours EXIF inside the extracted JPEG; only apply the
    // DNG's own orientation tag when the preview doesn't carry one.
    return jpegExifOrientation(jpeg) > 1 ? img : bakeOrientation(img, tiff.orientation);
  }

  async function loadImageFile(file, onStatus) {
    if (isHeicFile(file)) return decodeHeic(file, onStatus);
    if (isDngFile(file)) return decodeDng(file, onStatus);
    try {
      return await decodeBlob(file);
    } catch (e) {
      // Wrong/missing extension? Sniff for HEIC before giving up.
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (isHeicBytes(head)) return decodeHeic(file, onStatus);
      throw e;
    }
  }

  if (typeof window !== "undefined") window.loadImageFile = loadImageFile;
  if (typeof module !== "undefined" && module.exports)
    module.exports = { parseTiff, scanForJpeg, jpegExifOrientation };
})();
