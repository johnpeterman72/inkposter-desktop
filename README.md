# InkPoster Desktop

A local web app to control an InkPoster e-ink display from the desktop browser,
replacing the need for the iPhone app.

> **Unofficial & unaffiliated.** This is a personal, reverse-engineered project.
> It is not affiliated with, endorsed by, or supported by InkPoster or PocketBook.
> "InkPoster" and "PocketBook" are trademarks of their respective owners. The API
> and BLE details here were derived from observing the app's own traffic and are
> provided for interoperability and educational purposes; use at your own risk.
> No warranty — see [LICENSE](LICENSE).

## Why it's built this way

InkPoster has **no public API**. The official app talks to an undocumented
PocketBook/InkPoster **cloud backend** over Wi-Fi; the display itself just polls
that cloud on a sync interval. So this project:

1. **Discovers** the cloud API by capturing the iPhone app's own traffic
   (see `docs/01-capture-guide.md`).
2. Runs a **small local Node server** that replicates those cloud calls
   (login, list devices, upload/select art, trigger sync).
3. Serves a **browser UI** that talks to the local server.

A pure-browser app won't work: the cloud API will block cross-origin requests
(CORS) and may require request signing/auth headers we have to replicate
server-side. The local server is the workaround — you still just open a page in
your desktop browser.

## Status

- [x] Capture the app's API traffic (two captures in `docs/captures/`)
- [x] Document the endpoints & auth flow (`docs/02-api-notes.md`)
- [x] Local server (`server/`) + browser UI (`public/`)
- [x] List displays, live status (battery/wifi/storage/firmware)
- [x] **Browse the art library** (categories → thumbnail grid → show on display)
- [x] **Rotate** the display (portrait/landscape)
- [x] **Sync now** (`NEW_IMAGES` action) + adjustable **sync interval**
- [x] Show a specific item by ID (advanced)
- [x] **Upload personal photos** — resized/adjusted on your PC, converted to the
      e-ink format by the cloud (the `.ntx` conversion is server-side). See the
      "Upload a photo" page.
- [x] **Automatic login + token refresh** — HMAC-signed login + refresh-token
      flow (add your InkPoster password to `server/config.local.json`).
- [x] **Direct Bluetooth control** (beta) — fetch/reboot/ghosting-clean without
      the cloud sync wait; needs `npm install @stoprocent/noble`. Untested on
      real hardware yet.

**Note on "sync now":** an *instant* on-wall update isn't possible — the frame is
a battery e-ink device that sleeps and only pulls on its `syncInterval`. The app's
own `request-sync` call 404s. "Sync now" sends the correct `NEW_IMAGES` signal
(takes effect on the device's next wake — promptly if awake/on USB-C); lowering
the sync interval is the real lever for freshness. See `docs/02-api-notes.md`.

## Run it

```powershell
npm start            # or: node server/index.js
```

Then open <http://localhost:4173>. Auth comes from `server/config.local.json`
(gitignored). Put your InkPoster **email + password** there and the server logs
in and refreshes tokens on its own — no more re-capturing. (A captured token
still works too, until it expires in ~14 days.)

## Project layout

```
docs/          Capture guide, API notes, HAR parser (parse-har.js)
docs/captures/ Raw captures — SECRET (contain live tokens), gitignored
server/        Local Node backend: index.js (http), inkposter.js (API client)
public/        Browser UI (index.html / app.js / style.css)
```
