# CLAUDE.md

Guidance for Claude Code working in this repo. This file is loaded into every
session — treat it as the primary handoff / current-state document.

## What this project is

A local web app (Windows 11 host, Node.js) to control e-paper art frames from a
desktop browser, replacing the vendors' phone apps. It started as an **InkPoster**
controller and now also drives a **Samsung EMDX** e-paper frame — two very
different device families in one unified UI.

- **InkPoster** — controlled through an undocumented **PocketBook/InkPoster cloud
  API** (`api.inkposter.com`). Content only changes via the cloud; the frame polls
  the cloud on its `syncInterval`. Additionally reachable directly over **Bluetooth
  LE** for instant wake/fetch.
- **Samsung EMDX** — controlled entirely over the **LAN** via Samsung's **MDC
  protocol** (TCP 1515 → TLS → 6-digit PIN). No cloud.

Architecture: a small **zero-runtime-dep Node HTTP server** (`server/`) serves the
browser UI (`public/`) and proxies `/api/*` to the cloud / BLE / MDC. The browser
never sees tokens, PINs, or shared keys. `npm start` → http://localhost:4173.
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
- `server/samsung.js` — Samsung EMDX MDC client (net/tls/dgram/http, zero deps).

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
  → **rotate** → push) + a full editor at `/modifier.html`. **The 28.5"
  (`sharp_28_5`) mounts inverted — rotate 180° before upload** (the app does this).
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

### Samsung EMDX over the LAN (protocol working; push blocked by the network)
- MDC: TCP 1515 → device sends `MDCSTART<<TLS>>` → TLS upgrade → write the 6-digit
  PIN → `MDCAUTH<<PASS>>`. Frame `AA`-framed commands (battery 0x1B, power 0x11,
  serial 0x0B, software 0x0E, name 0x67, `setContentDownload` 0xC7).
- **Status read works** (battery/power/software/serial). Config lives in a
  `samsungFrames: [{name, host, pin, mac, localIp}]` array in `config.local.json`;
  the PIN stays server-side.
- **Image push**: the PC runs a tiny HTTP server serving `content.json` + the
  image; we send `setContentDownload` pointing at it and the frame pulls over the
  LAN. **BLOCKED on the current Wi-Fi (`GP_Staff`, client-isolated)** — the frame
  can't open a connection back to the PC. Needs a **network without client
  isolation** (home router / phone hotspot). Status/wake work even on the isolated
  net (PC→frame direction is fine).
- ⚠️ Sending `setContentDownload` on an isolated network leaves the EMDX **stuck
  retrying** the unreachable download (it stops answering MDC). It self-recovers or
  needs a power-cycle. Don't test image push until on a non-isolated network.

## UI (redesigned)
Sidebar shell: `Device / Library / Playlists / Settings` nav + a unified DISPLAYS
list (InkPoster + Samsung frames together). Device view centers a large framed
preview. Dark theme. `public/app.js` (main), `public/modifier.js` (full upload
editor), `public/style.css`.

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
- **Samsung PIN:** don't brute-force it (MDC blocks after a few bad tries with
  `FAIL:0x02`). The real PIN was `000000` (default), not the app-shown code.
- To verify UI without live devices, inject mock frames via the browser
  `javascript_tool` and call the render functions.

## Open items / possible next steps
- Samsung **image push**: retry once both PC + EMDX are on a non-isolated network.
- Samsung Device view is status + upload only (no library/playlists — those are
  InkPoster-cloud concepts). Power-state command returns an unmapped value ("?").
- Deferred/nice-to-have: bind the server to `127.0.0.1` + Origin check (currently
  binds all interfaces); "My Images" gallery for private uploads (needs a capture
  of the app's private-images endpoint, `getPrivateImagesWithCropParamsFlow`);
  scheduling/automation; light-mode.

## Commands
- `node --version` → v25.x, `python` → 3.12. `npm start` → http://localhost:4173.
- Capture: ProxyPin/mitmproxy on the iPhone → export HAR into `docs/captures/`.
