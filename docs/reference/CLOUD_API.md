# InkPoster Cloud API (reverse-engineered)

This document describes the InkPoster HTTP API (`api.inkposter.com`),
reverse-engineered from the Android APK and validated via Proxyman captures
and the ha-inkposter Home Assistant integration by mcuelenaere:
<https://github.com/mcuelenaere/ha-inkposter>.

See also `BLE_PROTOCOL.md` for the Bluetooth protocol.

## Base URL

```
https://api.inkposter.com/api/v1/
```

## Client identification

Every request carries two headers that identify the client platform:

| Header              | Value       |
|---------------------|-------------|
| `x-client-id`      | `android`   |
| `x-header-clientid` | `android`  |

The iOS app uses `ios` for both. Each platform has its own signing secret.

## Request signing

Auth endpoints require `timestamp` and `signature` query parameters.

### Algorithm

```
clientId     = "android"
clientSecret = "t5L1zS3D5CAZOE66afhWy8oPVEkZaB5p"
timestamp    = current time in milliseconds since Unix epoch
message      = clientId + str(timestamp)        // e.g. "android1703001234567"
signature    = HMAC-SHA256(clientSecret, message) → lowercase hex (64 chars)
```

### Python example

```python
import hmac, hashlib, time

CLIENT_ID     = "android"
CLIENT_SECRET = "t5L1zS3D5CAZOE66afhWy8oPVEkZaB5p"

def generate_signature():
    ts  = int(time.time() * 1000)
    msg = f"{CLIENT_ID}{ts}"
    sig = hmac.new(CLIENT_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return ts, sig
```

The values are appended as query parameters:

```
POST /api/v1/auth/login?timestamp=1703001234567&signature=abc123…
```

## Common headers

All requests to `api.inkposter.com` include:

```
x-header-country:  US
x-header-language: en
x-client-id:       android
x-header-clientid: android
x-header-deviceid: <device-uuid>
Content-Type:      application/json        (for JSON bodies)
Authorization:     Bearer <accessToken>    (for authenticated endpoints)
```

## Authentication

### Endpoints that require signing

These endpoints need `timestamp` + `signature` query params:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/is-email-exists`
- `POST /api/v1/auth/registration`
- `POST /api/v1/auth/send-confirm-email`
- `POST /api/v1/auth/confirm-email`
- `POST /api/v1/auth/send-forgot-password`
- `POST /api/v1/auth/verify-forgot-password`

### Endpoints that do NOT require signing

- `POST /api/v1/auth/refresh-token` — Bearer token in `Authorization` header
- All non-auth endpoints — Bearer token only

### Login

```
POST /api/v1/auth/login?timestamp={ts}&signature={sig}
```

Request body:

```json
{
  "email": "user@example.com",
  "password": "…",
  "deviceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Response (200):

```json
{
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…",
  "expiresIn": 1772364318
}
```

> **Note:** `expiresIn` is a **Unix timestamp** (seconds since epoch), not a
> duration. Tokens expire ~14 days after issuance.

### Refresh

```
POST /api/v1/auth/refresh-token
Authorization: Bearer <accessToken>
```

Request body:

```json
{
  "deviceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Response: same shape as login. Does **not** require request signing.

### Token lifecycle

- Tokens expire after ~14 days (`expiresIn` is a Unix timestamp).
- Refresh proactively before expiry (e.g. 1 hour before).
- On 401 from any API call: attempt refresh, then retry the request.
- If refresh itself fails: fall back to a fresh login.

### Device ID

The `deviceId` is a UUID that identifies the client installation. Generate a
random UUID v4 on first run and persist it alongside the tokens.

## API Endpoints

### User

#### GET /api/v1/user/profile

Returns user profile information.

```json
{
  "id": "b119c889-1881-431c-9ad3-18b7c737adcf",
  "name": "User Name",
  "email": "user@example.com",
  "language": "en",
  "updated": 1771186395068
}
```

#### GET /api/v1/user/frames?limit=100

Returns the list of frames registered to the user's account.

```json
{
  "frames": [
    {
      "id": "00000000-0000-0000-0000-000000000000",
      "frameName": "InkPoster 31.5\"",
      "serialNumber": "NX00000000000000W00000",
      "slideshowInterval": 60,
      "syncInterval": 3600,
      "orientation": "landscape",
      "modelId": "00000000-0000-0000-0000-000000000000",
      "modelName": "Affresco 31.5\"",
      "modelAlias": "spectra_31_5",
      "displayResolution": "2560x1440",
      "aspectRatio": "16:9",
      "screenSize": "31.5",
      "currentItem": {"itemId": "...", "private": true},
      "currentSlideshowId": null,
      "sharedKey": "<32-char-hex-string>",
      "sharedKeySequence": "ec",
      "numberOfImageDisplayed": 76,
      "slideshows": []
    }
  ],
  "totalCount": 1
}
```

**Important fields:**
- `sharedKey`: per-device BLE HMAC key (hex string, 16 bytes). Used for authenticating BLE commands.
- `sharedKeySequence`: key index (hex). Should match the `keySeq` byte from BLE status.
- `modelAlias`: maps to frame model (e.g. `spectra_31_5` → `Frame_31_5`).
- `displayResolution`: target resolution for image uploads (e.g. `2560x1440`).

### Frame status

#### GET /api/v1/frame/status

Returns status for all user frames. Response is an array of `{frame_uuid: status}` objects.

```json
[{
  "1c23ee16-...": {
    "isCharging": false,
    "syncInterval": 3600,
    "batteryCapacity": 68,
    "batteryVoltage": 4.17625,
    "storageFreeVolume": 62309248,
    "storageVolume": 62365696,
    "firmwareVersion": "W3150.1.1.706",
    "lastFirmwareCheck": 1771189636000,
    "displayedItems": [{"itemId": "...", "cardId": null, "private": true}],
    "wifiSignalStrength": 67,
    "timestamp": 1771189638289
  }
}]
```

#### GET /api/v1/frame/image-status

Returns image transfer progress for all user frames.

```json
[{
  "1c23ee16-...": {
    "item": {"itemId": "...", "cardId": null, "private": true},
    "attemptNo": 1,
    "progress": 100,
    "sentToEpd": 1,
    "error": 0,
    "timestamp": 1771187333244
  }
}]
```

#### GET /api/v1/frame/version-check

Returns firmware update availability for all user frames.

```json
[{
  "1c23ee16-...": {
    "newVersionAvailable": false,
    "version": "",
    "date": 1771189636000,
    "releaseNotes": "",
    "fwSize": 0,
    "timestamp": 1771189637233
  }
}]
```

### Frame actions

#### POST /api/v1/frame/actions

Send cloud-side commands to frames.

```json
{"frames": ["<frame-uuid>"], "actions": ["<ACTION_NAME>"]}
```

Known actions (full enum, leaked via a 400 on an invalid action):
`NEW_IMAGES`, `UPDATE_IMAGES`, `CHANGE_SYNC_INTERVAL`, `CHANGE_SLIDESHOW_INTERVAL`,
`CHANGE_EPD_TYPE_UPDATE`, `CHECK_FW_UPDATE`, `UPDATE_FW`, `REPORT_FRAME_STATUS`,
`FACTORY_RESET`, `FULL_SCREEN_UPDATE`, `CHANGE_FULL_SCREEN_UPDATE_TIME`.

- `NEW_IMAGES` — "new images, pull them" (the sync-now signal).
- `REPORT_FRAME_STATUS` — device phones home with fresh telemetry (used to poll).
- `CHECK_FW_UPDATE` / `UPDATE_FW` — firmware (see flow below).
- `CHANGE_EPD_TYPE_UPDATE` — push changed panel/transition settings to the device
  (sent right after a settings `update` that changes `pipelineSwitchingMode` /
  `numberOfDivisions` — see "Image transition" below).
- `FULL_SCREEN_UPDATE` — full-panel redraw (clears ghosting).
- ⚠️ `FACTORY_RESET`, `UPDATE_FW` — destructive/irreversible; never send casually.

Response (201):

```json
{"timestamp": 1771189610011, "statusCode": 200, "message": "Frames actions has been sent successfully!"}
```

#### Firmware update flow  (from the 07-20 capture, W2850.1.1.493 → .708)

1. `POST /frame/actions` `{"actions":["CHECK_FW_UPDATE"], "frames":[id]}`.
2. Poll `GET /frame/version-check` until the frame shows an update:
   ```json
   {"<frameId>": {"newVersionAvailable": true, "version": "W2850.1.1.708",
     "releaseNotes": "Wi-Fi connection improvements.", "fwSize": 0, "date": ...}}
   ```
3. `POST /frame/actions` `{"actions":["UPDATE_FW"], "frames":[id]}` to start it.
4. Spam `REPORT_FRAME_STATUS` + poll `GET /frame/status`; `firmwareVersion` flips
   to the new build when done (the device reboots to apply). Keep it on USB-C —
   the app only offered `UPDATE_FW` while `isCharging: true`.

### Image transition (`pipelineSwitchingMode` / `numberOfDivisions`)

Some panels (seen on the 28.5" `sharp_28_5`, not the 31.5" `spectra_31_5`) expose a
**transition style** for how the e-ink redraws when the image changes. Two fields
appear on the frame object (`/user/frames`) and in the settings `update` payload:

- `pipelineSwitchingMode`: `0` = standard full refresh, `1` = pipelined/regional.
- `numberOfDivisions`: `1` = whole panel at once; `16` = update in 16 bands (a
  progressive "wipe" reveal instead of a single full-panel flash).

To change it: `POST /user/frame/{id}/update` with the new values, **then**
`POST /frame/actions {"actions":["CHANGE_EPD_TYPE_UPDATE"], "frames":[id]}` to push
it to the device. ⚠️ These fields are **panel-specific** — they're absent on the
31.5" frame. The settings update replaces the whole object, so a client must
**preserve `pipelineSwitchingMode`/`numberOfDivisions`** (and any unknown fields)
when patching, or the transition setting resets.

### Slideshows

A frame can run a **slideshow** (playlist) instead of a single image. Slideshows
live on the frame object from `GET /user/frames`:

```json
"currentSlideshowId": null,          // active slideshow id, or null = single image
"slideshowInterval": 60,             // seconds per slide (also settable via update)
"slideshows": [{
  "id": "f3e5b917-…",
  "orientation": "portrait",
  "shuffle": false,
  "items": [
    {"itemId": "1235c276-…", "cardId": "e029…", "weight": 0, "thumbnail": "https://…"},
    {"itemId": "74ae8add-…", "cardId": "f4a3…", "weight": 1, "thumbnail": "https://…"}
  ]
}]
```

`weight` is the slide order. Create/assign endpoints (not exercised in this
capture, from earlier notes): `POST /slideshow/save` and `POST //item/slideshow-to-frame`.

### `currentItem` can carry full art metadata

When the current image is a library card (not a private upload), `currentItem`
includes `title`, `thumbnail`, and `authors[]` — enough to render "now showing"
with the artwork and artist. Private uploads carry only `{itemId, private:true}`.

### Image upload and display

#### POST /api/v1/item/convert

Upload an image for conversion. Uses multipart form data.

Form fields:
- `frames[]`: frame UUID (text field)
- `file`: image file (binary, content-type: image/jpeg)

Extra headers:
```
Upload-Draft-Interop-Version: 6
Upload-Complete: ?1
```

**Important**: The image MUST be at the exact frame resolution (e.g. 2560x1440 for the 31.5" frame).
The API rejects images at non-standard resolutions with "Model not detected by image resolution".

Response:

```json
{"queueId": "1cf6cd50-9f22-4aad-9221-0e3dffa7549d"}
```

#### POST /api/v1/item/is-converted

Poll for conversion status.

Request body:

```json
{"queueId": "<queue-id-from-convert>"}
```

Response:

```json
{"status": "converted", "message": "userimage.jpg has been converted", "item": "c017a2af-fac1-4dca-94cd-f30d655f77df"}
```

Statuses: `pending`, `converted`, `failed`.
The `item` field contains the converted item UUID (used in the next step).

#### POST /api/v1/item/show-on-frame

Tell the cloud to push a converted image to a frame for display.

Source: `FramesApi.smali` `@POST("item/show-on-frame")`, `ShowImagesOnFramesPro.smali` `@JsonProperty("frames")` + `@JsonProperty("items")`.

```json
{"frames": ["<frame-uuid>"], "items": ["<item-uuid>"]}
```

This is the critical step that actually causes the image to be displayed.
Without this call, the image is uploaded and converted but never assigned to the frame.

#### POST /api/v1/item/upload-converted  (app's on-device path — not used here)

The app has a second upload path: it converts the image to `.ntx` **on-device**
using a native library (`com.inkposter.epaper_converter_android`, JNI) and uploads
the finished `.ntx` here (response `AnswerUploadConverted(itemId=…)`). Because that
converter is compiled native code, this project deliberately uses the server-side
`/item/convert` path above instead. See `APK_ANALYSIS.md`.

### Complete image display flow

1. Resize image to the frame's exact resolution (e.g. 2560x1440)
2. `POST /item/convert` — upload the resized image (cloud does the `.ntx` conversion)
3. `POST /item/is-converted` — poll until `status` is `converted`
4. `POST /item/show-on-frame` — assign the converted item to the frame
5. (Optional) Send BLE FETCH command (action=42) to trigger immediate display

## iOS client

The iOS app (`InkposterApp Version:1.5.3 OS:iPadOS-26.2`) uses:

- `x-client-id: ios` / `x-header-clientid: ios`
- A different (unknown) signing secret
- `User-Agent: InkposterApp Version:1.5.3 OS:iPadOS-26.2`

The iOS signing secret is embedded in the app binary and was not extracted.
The Android secret works correctly when using `x-client-id: android`.
