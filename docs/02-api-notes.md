# InkPoster cloud API — reverse-engineered notes

Source: `docs/captures/ProxyPin07-17_15_03_20.har` (iOS app v2.1.12, iOS 26.5.2).
Verified live 2026-07-17 (`GET /user/frames` → 200).

## Base

```
https://api.inkposter.com/api/v1/
```

Server: nginx. Responses include `Access-Control-Allow-Origin: *`.

## Auth & required headers

Every request carries a **Bearer JWT** plus client headers:

```
Authorization: Bearer <JWT>
x-header-clientid: ios
x-client-id: ios
x-header-deviceid: <iOS identifierForVendor UUID>
x-header-country: US
x-header-language: en
User-Agent: InkposterApp Version:2.1.12 OS:iOS-26.5.2
Accept: */*
```

JWT payload: `{ sub: <userId>, device: <appDeviceId>, iat, exp }`.
Lifetime observed: **14 days**. Note `device` in the JWT differs from the
`x-header-deviceid` header (JWT `device` = registered app install; header =
iOS vendor id).

**Not yet captured:** the login endpoint that mints the JWT. Until we capture it,
refresh the token by re-capturing after the app logs in (see `03-todo-capture.md`).

## Identifiers

- **frameId** (UUID, e.g. `6367428c-…`) — used in almost all calls. From `/user/frames`.
- **serialNumber** (e.g. `NX4F1000006321U000E2`) — hardware serial; *not* used as
  the id in working calls (a `/frame/{serial}/request-sync` attempt 404'd).
- **itemId** (UUID) — an image/artwork. `currentItem.itemId` = what's on screen now.
- **modelId / modelAlias** (e.g. `spectra_31_5`) — e-paper model, drives color profile.

## Endpoints

### `GET /user/frames?limit=100`
List the account's displays. Returns per frame: `id`, `frameName`,
`serialNumber`, `slideshowInterval`, `syncInterval`, `orientation`, `modelId`,
`modelName`, `modelAlias`, `displayResolution` (`2560x1440`), `aspectRatio`,
`screenSize`, `currentItem {itemId, private}`, `slideshows[]`, `sharedKey`.

### `GET /frame/status`
Array keyed by frameId → live telemetry:
`isCharging, syncInterval, batteryCapacity (%), batteryVoltage,
storageFreeVolume, storageVolume, firmwareVersion, lastFirmwareCheck,
displayedItems[], wifiSignalStrength, timestamp`.

### `POST /item/show-on-frame`  → 201, body `ok`
Set an image on one or more displays. **This is the core "change art" call.**
```json
{ "frames": ["<frameId>"], "items": ["<itemId>"] }
```
The display fetches it on its next sync (or trigger a sync via actions).

### `POST /item/is-exists` → 200
```json
{ "items": ["<itemId>"] }        →  [ { "<itemId>": true } ]
```

### `POST /frame/actions` → 201
Send actions to a frame. Body `{ "frames": ["<frameId>"], "actions": ["..."] }`.
Full valid action enum (leaked via a 400 on an invalid action):
```
NEW_IMAGES, UPDATE_IMAGES, CHANGE_SYNC_INTERVAL, CHANGE_SLIDESHOW_INTERVAL,
CHANGE_EPD_TYPE_UPDATE, CHECK_FW_UPDATE, UPDATE_FW, REPORT_FRAME_STATUS,
FACTORY_RESET, FULL_SCREEN_UPDATE, CHANGE_FULL_SCREEN_UPDATE_TIME
```
- `NEW_IMAGES` — "there are new images, pull them" — the **sync-now** signal.
- `REPORT_FRAME_STATUS` — device phones home with fresh telemetry.
- `FULL_SCREEN_UPDATE` — full-panel redraw (clears ghosting).
- ⚠️ `FACTORY_RESET`, `UPDATE_FW` — destructive; never send casually.

### Sync / "show it now" reality (important)
There is **no working instant-refresh** for a battery e-ink frame:
- The app's own `POST /frame/{serialNumber}/request-sync` returns **404**
  (broken in the app; UUID variant, `/sync`, `/frame/sync` all 404 too).
- `show-on-frame` sets the cloud's `currentItem`; the **panel** only updates
  when the device next checks in (its `syncInterval`, e.g. 900s) — verified by
  `currentItem` != `frame/status.displayedItems` between syncs.
- `NEW_IMAGES` is accepted immediately but a **sleeping** device can't act on it;
  it takes effect on the next wake (or promptly if awake / charging).
- **Real lever for faster updates:** lower `syncInterval` via
  `POST /user/frame/{id}/update` (battery tradeoff), and/or keep it on USB-C.

### `GET /frame/image-status`
Progress of an image being pushed to the e-paper panel:
`{ "<frameId>": { item, attemptNo, progress (0-100), sentToEpd, error, timestamp } }`.

### `GET /models/{modelId|alias}/epaper-converter-profile`
Color-conversion profile for a given e-paper model (used client-side to dither
uploaded images to the panel's palette). `unknown` model → 404.

## Endpoints (2nd capture — library, rotation, login, upload)

### `GET /categories`
`{ categories: [{ id, title, thumbnail, tags: [{id, title, weight}] }] }`.

### `POST /item/cards?limit=&last_id=`
Browse the catalog. Body is `{ "category": "<id>" }` or
`{ "collections": ["<id>"] }`. Returns `{ itemCards: [...], ... }`. Each card:
`{ id, shortTitle, typeOfContent, countItems, orientation, authors[], published,
items: [{ id, orientation, thumbnail, modelAlias }] }`.
**Key:** a card has one `item` per display model. To show a card on a frame, pick
the item whose `modelAlias` matches the frame's model (e.g. `spectra_31_5`) and
send that item's `id` to `show-on-frame`. Thumbnails are **public** (no auth).

### `GET /item/card/{cardId}`
Full card detail (title, author, description, `items[]` incl. per-model ids).

Also: `GET /item/art-of-day`, `POST /collections`, `GET /user/profile`
(`{id,name,email,language}`).

### `POST /user/frame/{frameId}/update` → 201 `{acknowledged:true}`
Change a display's settings — **this is how orientation/rotation is set**. Send
the whole settings object (missing fields may reset):
```json
{ "name": "Affresco 31.5\"", "orientation": "portrait|landscape",
  "slideshowInterval": 60, "syncInterval": 3600,
  "fullScreenUpdateHour": 4, "fullScreenUpdateMinute": 0 }
```
Note `name` here maps to `frameName` from `/user/frames`.

### `POST /item/upload-converted` → 201 `{itemId}`
`multipart/form-data`, single field `file` = **`converted_image.ntx`**
(`application/octet-stream`). The app converts the photo to PocketBook's
proprietary **`.ntx`** e-paper format *client-side* first (high-entropy /
compressed; no clean magic bytes). **Reproducing `.ntx` is the hard open problem
for personal-photo upload** — deferred.

### Auth (login is request-signed)
- `POST /auth/is-email-exists?timestamp=&signature=` → `{isEmailExists}`
- `POST /auth/login?timestamp=&signature=` body `{email,password,deviceId}` →
  `{ tokenType:"Bearer", expiresIn, accessToken, refreshToken }`.
- **Auth endpoints require an HMAC query signature** (`timestamp` + `signature`,
  SHA-256) that the app computes with a secret baked into the binary. Non-auth
  endpoints need only the Bearer token. So automated re-login needs the signing
  secret reversed from the app — **deferred**; we store the `refreshToken` and
  rely on the 14-day access token for now.

### Slideshow (bonus)
- `POST /slideshow/save` `{orientation, items:[{id,weight}], frames:[{id,slideshowInterval}], shuffle}` → `{id}`
- `POST //item/slideshow-to-frame` (note double slash) `{id}` → `ok`

## Still-open gaps

1. **Personal-photo upload** — needs the `.ntx` conversion reproduced (hard).
2. **Automated login/refresh** — needs the auth HMAC signing secret (hard).
3. **List *my* uploaded items** — no distinct endpoint seen (`/item/my` etc. 404).
