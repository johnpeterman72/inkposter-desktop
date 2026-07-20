# InkPoster Android APK — static analysis (v2.1.1)

Static reverse-engineering of the official Android app to understand how it
works and to cross-check this project's reverse-engineered API/BLE work. No
dynamic instrumentation; findings are from the APK's manifest, DEX, resources,
and signing block.

- **APK:** `inkposter.com` v2.1.1 (versionCode 145), pulled from APKPure.
- **Tooling:** [androguard](https://github.com/androguard/androguard) (pure-Python;
  manifest/DEX/cert parsing + Analysis xref). No Java/jadx was available.
- The APK is **not** committed here (it's InkPoster's copyrighted binary); this
  file is our own analysis. The base APK requires ABI/density splits
  (`requiredSplitTypes = base__abi,base__density`), so native `.so` libraries
  live in per-ABI split APKs that were not downloaded.

## Identity & tech stack (AppBrain-style)

| | |
|---|---|
| package | `inkposter.com` |
| main activity | `inkposter.com.presentation.MainActivity` |
| application class | `inkposter.com.InkPosterApp` |
| version | 2.1.1 (code 145) |
| minSdk / targetSdk | 29 (Android 10) / 35 (Android 15) |
| DEX | 4 files, ~34,800 classes |
| signing | Google Play App Signing (cert CN=Android, O=Google Inc; SHA-256 `8f6446a7…6e547`) |

**Frameworks / SDKs detected** (by class-package signature):

- **UI:** Jetpack Compose (Material3), ConstraintLayout-Compose — ~9,400 Compose classes (fully Compose UI).
- **DI:** Dagger/Hilt. **Persistence:** Room + DataStore Preferences.
- **Async:** Kotlin coroutines + Flow; Kotlin serialization; Jackson (JSON).
- **Networking:** Retrofit + OkHttp + Okio.
- **Google/Firebase:** Play Services, Firebase Core/Analytics/Crashlytics/Messaging (FCM).
- **Native:** `com.inkposter.epaper_converter_android` (JNI bindings — see below).
- ByteBuddy + kotlin-reflect present (likely test/serialization tooling pulled in).

**Trackers (Exodus-style):** Google Firebase Analytics, Google Crashlytics,
Google AdMob. AdMob is only ~5 classes plus the `AD_ID`/ad-services permissions —
this is the advertising-ID / attribution plumbing that ships with Play Services,
**not** an ad-serving UI. No third-party ad/attribution SDKs (no AppsFlyer,
Adjust, Facebook, ironSource, etc.).

**Firebase client config** (ships in every copy of the app; not a private secret):

- project number / GCM sender: `906930877791`
- app id: `1:906930877791:android:f0facb1b1c18f224c032ea`
- API key: `AIzaSyDTcq1qIbLM9elV1--t-EMkEOvokXyjomg`

**Permissions (20):** INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE,
CHANGE_WIFI_STATE, ACCESS_FINE/COARSE_LOCATION (BLE scanning on older APIs),
BLUETOOTH / BLUETOOTH_ADMIN / BLUETOOTH_SCAN / BLUETOOTH_CONNECT,
READ_EXTERNAL_STORAGE / READ_MEDIA_IMAGES (photo upload), POST_NOTIFICATIONS,
WAKE_LOCK, C2DM RECEIVE + AD_ID + install-referrer. The Wi-Fi + location + BLE
set is for the **frame setup wizard** (provisioning the frame's Wi-Fi over BLE).

## Backend infrastructure (hosts found in the binary)

- `https://api.inkposter.com` — the app API this project targets (prod).
- `https://dev.inkposter.com`, `https://pp.inkposter.com` — dev / pre-prod app API.
- `https://api.rnd.pktbk.shop` — **PocketBook** R&D backend (confirms the
  PocketBook lineage noted in the project docs).
- `https://frame-gateway.ionnyk-{dev,staging,prod}-gateway.inkcoming.eu` — the
  **Ionnyk** "frame gateway" (Ionnyk is the maker; `inkcoming.eu`). This appears
  to be the endpoint the **frame device itself** talks to, distinct from the app
  API — useful context, not something this project needs.
- OAuth / social: `accounts.google.com`, `login.live.com`, `login.yahoo.com`
  (social sign-in), plus share targets (facebook/twitter/linkedin) and
  `www.paypal.com` (payments/subscription).

## Authentication — confirms this project's implementation

- The **Android client signing secret `t5L1zS3D5CAZOE66afhWy8oPVEkZaB5p` is baked
  into the DEX** (confirmed present). It is the only 32-char base62 secret in the
  app. Validates `server/inkposter.js` login signing.
- `HmacSHA256` and the `x-header-*` request headers are present as string
  constants, matching `docs/reference/CLOUD_API.md`.

## Image upload — two paths (the on-device one is native)

The app has a JNI module `com.inkposter.epaper_converter_android` whose
`Bindings` class exposes **8 `native` methods**: `convertImage`,
`convertImageFromPath`, `convertRawImagePixels`, `convertedImageGetBuffer`,
`convertedImageGetStatus`, `convertedImageIsOk`, `convertedImageSaveTo`,
`freeConvertedImage`. Kotlin wrappers (`EpaperConverterKt`) adapt Bitmaps and
an `EpaperConverterProfile` (dithering method, panel variant, image adjustments)
to these calls, write an **`.ntx`** file (`saveTo NTX: path=…`,
`Failed to write NTX to …`), and upload it via a **new endpoint,
`POST /api/v1/item/upload-converted`** (response `AnswerUploadConverted(itemId=…)`).
The pipeline can rotate 180° before conversion for certain crop-frame models
(`uploadCroppedImage: applied 180° before NTX`).

**Implication:** the real `.ntx` conversion is a **compiled native library**
(the `.so` lives in an ABI split), so reproducing it locally is genuinely hard —
the original "deferred gap" assessment was correct. **This project sidesteps it**
by using the server-side `POST /item/convert` path (upload a plain resized JPEG;
the cloud does the conversion), which needs no native code. Both paths coexist in
the app: native-convert-then-`upload-converted`, or server-side `convert`.

## BLE — confirms `BLE_PROTOCOL.md`

- Classes `inkposter.com.presentation.utils.BleFrameInitializeHelper` and
  `BleCommandSender` are present, matching the protocol doc.
- The BLE default key **`b716c1d9807b857fcb26f26fab215c6b`** is referenced from
  both classes' static initializers — confirming it as the built-in `DEFAULT_SKEY`.
- Command/CCCD UUIDs (`1b5f2d1a-…`, `00002902-…`) appear in the string pool.
- The frame **setup wizard** (Wi-Fi provisioning over BLE) is a major app feature
  (`WizardEnterWiFiNamePassword`, `WizardScanWiFiScreen`, `ConnectWizardScreen`,
  `WiFiChangeHostScreen`) — matches the BLE `SET_SETTINGS` (action 2) payloads.

## Baked 32-hex constants (all accounted for)

| constant | used by | meaning |
|---|---|---|
| `b716c1d9807b857fcb26f26fab215c6b` | `BleFrameInitializeHelper`, `BleCommandSender` | BLE `DEFAULT_SKEY` (documented) |
| `313a87bf6e09f1bfbd02a28679b52742` | `AppDatabase_Impl` | Room schema identity hash (not a secret) |
| `6ab9c6efb2367eb129f2636dfd011f1e` | `AppDatabase_Impl` | Room schema hash (not a secret) |

## Actionable takeaways for this project

1. **New endpoint discovered:** `POST /api/v1/item/upload-converted` (for
   pre-converted `.ntx` uploads). Not needed by us — our JPEG → `/item/convert`
   path is simpler — but worth recording in `CLOUD_API.md`.
2. **Auth verified end-to-end:** the client secret and signing scheme in the app
   match what `server/inkposter.js` already does. No changes needed.
3. **BLE keys/classes verified** against `BLE_PROTOCOL.md`. No changes needed.
4. **`.ntx` stays a non-goal:** confirmed native/compiled; the cloud-convert path
   is the correct design, not a workaround.
