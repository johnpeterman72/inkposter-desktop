# CLAUDE.md

Guidance for Claude Code working in this repo. This file is loaded into every
session — treat it as the primary handoff / current-state document.

## What this project is

A local web app (Windows 11 host, Node.js) to control **InkPoster** e-paper art
frames from a desktop browser, replacing the vendor's phone app.

- **InkPoster** — controlled through an undocumented **PocketBook/InkPoster cloud
  API** (`api.inkposter.com`). Content only changes via the cloud; the frame polls
  the cloud on its `syncInterval`. Additionally reachable directly over **Bluetooth
  LE** for instant wake/fetch.
- **Samsung EMDX support was removed** (Aug 2026, "abandon the samsung display").
  The MDC client, `/api/samsung/*` routes, and Samsung UI are gone — recover from
  git history (commits ≤ `05b6286`) if ever needed. Leftover `samsungFrames` in
  `config.local.json` is ignored; the stray `samsung_EMDX_784r.md` in the root and
  the MDC research notes were part of that effort.

Architecture: a small **zero-runtime-dep Node HTTP server** (`server/`) serves the
browser UI (`public/`) and proxies `/api/*` to the cloud / BLE. The browser
never sees tokens or shared keys. `npm start` → http://localhost:4173.
The one optional dependency is `@stoprocent/noble` for BLE.

## Reverse-engineering discipline

Everything was reverse-engineered from captures + the decompiled Android APK.
**Do not invent endpoints or auth schemes — build from real captured requests.**
HAR captures live in `docs/captures/` (gitignored — they contain live tokens;
some are 150+ MB, parse with `node --max-old-space-size=4096`). Parsers:
`docs/parse-har.js` (summary + bodies), `parse-har2.js` (endpoints + mutations),
`parse-har3.js`. Protocol writeups: `docs/reference/CLOUD_API.md`,
`BLE_PROTOCOL.md`, `APK_ANALYSIS.md`. The decompiled APK + androguard scripts are
in `docs/reference/apk/` (gitignored, kept for re-analysis).

## Server modules

- `server/index.js` — HTTP server + all `/api/*` routes (zero deps).
- `server/inkposter.js` — InkPoster cloud client (auth, frames, library, upload, firmware, transition, slideshow).
- `server/ble.js` — InkPoster BLE control (lazy-loads `@stoprocent/noble`).

## Current status — what works

### InkPoster over the cloud (fully working; session is live)
- **Auto login + refresh.** `config.local.json` has `{email, password}`; the server
  logs in (HMAC-signed with the Android client secret) and refreshes automatically.
  IMPORTANT: `deviceId` MUST be unique to this server (a fresh UUID) — it was
  originally the phone's vendor id, which caused the server and phone to fight over
  one session slot (mutual logout). Now uses its own device id.
- **Library** browse (categories → cards → show-on-frame, picking the item variant
  whose `modelAlias` matches the frame). Search filter + `last_id` pagination.
- **Photo upload** — cloud does the `.ntx` conversion, so we just resize to the
  frame's exact resolution and `POST /item/convert` (plain JPEG) → poll
  `/item/is-converted` → `show-on-frame`. Inline "Send new artwork" (drop → preview
  → **rotate** → push) + a full editor at `/modifier.html`.
- **Panel rotation quirks (`panelFix`)** — two independent +180°s, applied ONLY at
  upload time (previews and the PNG download always show wall-view, upright):
  (1) the 28.5" `sharp_28_5` mounts inverted (+180, matches the official app);
  (2) **portrait-shaped uploads are drawn 180° off vs landscape** by the
  cloud/panel `.ntx` pipeline (+180) — found Aug 3 2026 when the first-ever
  portrait upload landed upside-down on the 31.5"; verified by re-pushing the same
  image flipped. Net effect: 31.5" portrait → 180; 28.5" landscape → 180;
  28.5" portrait → net 0 (**this combination is predicted, not yet observed**).
- **iPhone HEIC + RAW input** — both upload paths load files through
  `public/imageload.js` (`window.loadImageFile`). HEIC/HEIF decodes in-browser via
  the vendored `public/vendor/heic2any.min.js` (libheif WASM, lazy-loaded on first
  HEIC; native decode tried first for Safari). RAW/ProRAW `.dng` is NOT demosaiced —
  we parse the TIFF/DNG IFD tree and extract the largest embedded JPEG preview
  (ProRAW previews are full-resolution 4032×3024; brute FFD8-scan as fallback).
  Orientation: the browser applies the extracted JPEG's own EXIF; the DNG's IFD0
  orientation tag is baked in only when the preview lacks EXIF (no double-rotate).
  Older third-party-app DNGs may only embed a small preview (e.g. 852×640) — known
  soft-output limitation. Verified live with a real ProRAW (iPhone 12 Pro) + HEIC.
- **Firmware update** (`CHECK_FW_UPDATE` → poll `version-check` → `UPDATE_FW`,
  charging-gated), **image transition** (`pipelineSwitchingMode` 0-4 +
  `numberOfDivisions` 1/2/4/8/16, pushed via `CHANGE_EPD_TYPE_UPDATE`),
  **slideshows** (create via `/slideshow/save` + `//item/slideshow-to-frame`, and
  display), **now-showing** thumbnail, **image-transfer progress** (poll
  `image-status`), **clear ghosting** (`FULL_SCREEN_UPDATE`), rotation, sync-now.
- ⚠️ `updateFrame` must echo back ALL settings fields (incl. panel-specific
  `pipelineSwitchingMode`/`numberOfDivisions`) or the device resets them.

### InkPoster over BLE (working; needs setup)
- **`Fetch now (BLE)`** on the Device view = instant sync (wakes the frame + pulls
  now, exactly what the phone does when you tap it). The cloud can't wake a
  sleeping frame — BLE is the only instant path.
- Requires: `npm install @stoprocent/noble` (installed), Bluetooth on, and the
  frame **NOT paired in Windows Bluetooth** (a Windows bond makes GATT service
  discovery fail "unreachable"). Scans are an **active scan (allowDuplicates=true)
  for ~13s** — passive scans on Windows never get the device name, and frames
  advertise their name slowly.
- `secureMode: true` frames need the per-device `sharedKey` (from `/user/frames`);
  the UI matches the BLE device (`InkP-<serial>`) to its frame by serial.

## UI (redesigned)
Sidebar shell: `Device / Library / Playlists / Settings` nav + a DISPLAYS list.
Device view centers a large framed preview. Dark theme. `public/app.js` (main),
`public/modifier.js` (full upload editor), `public/imageload.js` (shared
HEIC/DNG-capable photo loader), `public/style.css`.

## GitHub
Private repo **github.com/johnpeterman72/inkposter-desktop** (`gh` authed as
johnpeterman72). Push after committing. `config.local.json`, `docs/captures/`,
`docs/reference/apk/`, `*.apk`, `node_modules/`, `.claude/settings.local.json`,
and `server/cache/` are gitignored. There are stray `Gemini_Generated_Image_*.png`
and `samsung_EMDX_784r.md` files in the root — always stage files explicitly
(`git add <paths>`), never `git add -A` (it once swept in unintended files).

## How to work here (gotchas learned this session)
- **Git commit messages:** write the message to `"$TEMP/msg.txt"` then
  `git commit -F` — `$TMPDIR` is often unset in a fresh Git-Bash shell. `git push`
  sometimes lingers past the tool timeout but still succeeds — verify with
  `git status -sb`. CRLF warnings are harmless.
- **Network/BLE tests buffer stdout** through the tool — run them **backgrounded**
  writing to a file (`node x.js > out 2>&1 &`), then Read the file. Foreground
  `sleep` is blocked.
- **After code changes:** restart `npm start` (server) AND hard-refresh the browser
  (Ctrl+Shift+R) — `public/*` is cached.
- **KILL any server you background before ending the session** (`netstat -ano |
  grep :4173` → `taskkill //PID <pid> //F`). A leftover instance holds the port and
  John's `start-inkposter.bat` hits EADDRINUSE (now a friendly message, but still
  confusing). John normally runs the server himself via the .bat.
- To verify UI without live devices, inject mock frames via the browser
  `javascript_tool` and call the render functions. To test file uploads without a
  native picker, `fetch` a file staged in `public/`, wrap it in a `File` +
  `DataTransfer`, assign to the input's `.files`, and dispatch `change`.
- Test assets for the image loader (real ProRAW .dng from raw.pixls.us — JSON
  index at `/json/getrepository.php?set=all` — and HEIC from nokiatech's gh-pages)
  download fine with curl.
- **Debugging what actually went to a frame:** `server/cache/<itemId>.jpg` holds
  the exact uploaded bytes of every photo push — first thing to inspect for
  orientation/quality complaints. `/api/image-status` shows per-frame transfer
  progress (`progress`, `sentToEpd`). A server-side re-push + `/api/ble/fetch`
  (name `InkP-<serial>` + sharedKey from `/api/frames`) makes a test visible on
  the wall in ~1 min without touching the UI.

## Open items / possible next steps
- **28.5" Tela in portrait**: `panelFix` predicts net 0° (inverted mount + portrait
  180 cancel) — never observed. If a portrait push to the Tela lands upside-down,
  that prediction is the thing to fix.
- Older third-party-app DNGs may embed only a small preview (~850px) → soft
  output. Upgrade path if it ever matters: LibRaw WASM demosaic.
- Deferred/nice-to-have: bind the server to `127.0.0.1` + Origin check (currently
  binds all interfaces); "My Images" gallery for private uploads (needs a capture
  of the app's private-images endpoint, `getPrivateImagesWithCropParamsFlow`);
  scheduling/automation; light-mode.

## Commands
- `node --version` → v25.x, `python` → 3.12. `npm start` → http://localhost:4173.
- Capture: ProxyPin/mitmproxy on the iPhone → export HAR into `docs/captures/`.
