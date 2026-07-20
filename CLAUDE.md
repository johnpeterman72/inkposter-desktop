# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A local web app to control an **InkPoster e-ink display** from a desktop browser,
replacing the official iPhone app. Windows 11 host; Node.js for the app.

## Critical constraint: there is no public InkPoster API

InkPoster has no documented/public API. The official app drives the display
through an **undocumented PocketBook/InkPoster cloud backend** — the display
itself only polls that cloud on a sync interval; it does not take direct commands
over the LAN. Every capability in this app must be reverse-engineered from the
cloud API the phone app uses.

Consequences that shape all design decisions:

- **Not a pure-browser app.** The cloud API blocks cross-origin (CORS) requests
  and likely needs auth headers / request signing replicated server-side. The
  architecture is therefore a **small local Node server** (talks to the cloud
  API) + a **browser UI** (talks only to the local server). "Open it in my
  browser" still holds — there's just a local backend.
- **Discovery before code.** Endpoints, auth flow, and payloads come from
  capturing the app's own traffic. Do not invent endpoints or guess the auth
  scheme — build from real captured requests. The auth shape (bearer token vs
  OAuth vs signed requests) determines the server design, so wait for capture
  data before scaffolding the server.

## Current status

Working v1. First capture done; API documented in `docs/02-api-notes.md`.

- **API base:** `https://api.inkposter.com/api/v1/`, Bearer JWT + `x-header-*`
  headers. See `server/inkposter.js` for the exact header set.
- **Architecture:** `server/index.js` (zero-dep Node http server) serves
  `public/` and proxies a small set of `/api/*` routes to the cloud API via
  `server/inkposter.js`. The browser never sees the token.
- **Auth:** `server/config.local.json` (gitignored) holds `{ email, password,
  token, refreshToken, deviceId }`. The server now **logs in and refreshes
  automatically** — see below. Access token lasts ~14 days, refresh token ~90.
- **Run:** `npm start` → http://localhost:4173

Done: list frames, live status, **library browse** (categories → cards →
show-on-frame, matching the frame's `modelAlias` variant), **rotation**
(`/user/frame/{id}/update`), show-by-item-id, status refresh.

Newer (built from the APK decompile in `docs/reference/`, superseding the two
"hard, deferred gaps" the old notes listed):

- **Auto login + refresh** (`server/inkposter.js`). Login is HMAC-signed with the
  Android client secret (`docs/reference/CLOUD_API.md`); refresh presents the
  **refresh token as the Bearer** + `{deviceId}` (no signing). `ensureToken()`
  refreshes proactively ~1 day before expiry; `call()` also refreshes+retries on
  a 401, falling back to a full login. Verified live: the signature is accepted
  and the account exists (a wrong-password login returns "password were not
  correct"; a bad signature returns 403 "Wrong signature for client android").
  Needs the real `password` in config to activate.
- **Personal-photo upload** — the `.ntx` conversion happens **server-side**, so
  no on-device encoder is needed. Flow: resize to the frame's exact resolution →
  multipart `POST /item/convert` (plain JPEG) → poll `POST /item/is-converted` →
  `POST /item/show-on-frame`. Browser resize/adjust lives in `public/modifier.js`
  ("Send to display"); server orchestration is `api.uploadAndShow`.
- **BLE direct control** (`server/ble.js`, optional) — fetch/reboot/ghosting over
  Bluetooth per `docs/reference/BLE_PROTOCOL.md` (HMAC-framed commands, default
  vs per-device shared key by `secureMode`). Lazy-loads `@stoprocent/noble`
  (optionalDependency) and degrades to an "unavailable" message if absent.
  **Not yet tested against real hardware** — treat as beta.

Known live-state caveat: the captured tokens currently in config are **dead**
(the session was superseded server-side — both access and refresh 401 with
"Device … token is invalid"). Everything cloud-side is locked out until a real
`password` is added so the server can mint a fresh session.

HAR parsers in `docs/`: `parse-har.js` (summary), `parse-har2.js` (endpoint list
+ mutations), `parse-har3.js` (targeted detail with secret masking).
Captures are large (2nd is 171 MB) — parse with `node --max-old-space-size=4096`.

## Traffic capture workflow

`docs/01-capture-guide.md` is the authoritative walkthrough (mitmproxy on the PC,
iPhone routed through it, cert installed, app actions recorded). Captures land in
`docs/captures/` as `.mitm` or `.har` files.

- These captures contain **live auth tokens** — treat `docs/captures/` as secret;
  never commit its contents.
- The main risk that can block the project is **TLS certificate pinning** in the
  app. If a capture shows failed/errored TLS flows to the InkPoster host, that's
  pinning — flag it rather than working around it silently; the fallbacks are
  heavier (Android emulator + Frida SSL-unpin, or probing the display on the LAN).

## Commands

- `node --version` → v25.x, `python --version` → 3.12 (both preinstalled).
- Capture: `pip install mitmproxy`, then `mitmweb --listen-port 8080` (web UI) or
  `mitmdump -w docs/captures/inkposter_capture.mitm` (headless to file).

No build/test tooling exists yet; add it alongside the first `server/` code.
