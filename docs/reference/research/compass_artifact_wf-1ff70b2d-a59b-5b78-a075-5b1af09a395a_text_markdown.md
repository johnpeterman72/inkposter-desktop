# Controlling an InkPoster E-Ink Art Frame from a PC: What Exists Today

## TL;DR
- **There is currently NO public API, no reverse-engineering writeup, no GitHub project, and no Home Assistant/desktop integration for the PocketBook InkPoster.** The frame is a closed, cloud-dependent ecosystem controllable only through the official InkPoster mobile app; even the official Android app cannot yet upload custom high-res images.
- **InkPoster is a PocketBook product** (published by Pocketbook International SA, support routed via obreey-products.com), built on E Ink Spectra 6 panels with dual-band Wi-Fi + Bluetooth. The nearest hackable analog is the **SwitchBot AI Art Frame** — same E Ink Spectra 6 tech, but a different vendor (SwitchBot International; launched Nov 13, 2025 in 7.3"/13.3"/31.5" sizes from USD 149.99, with an "AI Studio" feature powered by NanoBanana running Google's Gemini 2.5 Flash Image) — which DOES have a documented cloud API, Home Assistant support, and (as of ~May 2026) an image-upload command.
- **Practical path for the user:** there is no existing tool to point a PC at an InkPoster today. The realistic options are (1) capture the app's own cloud API traffic with a proxy (mitmproxy/Charles) and replay it from a PC script, leveraging existing PocketBook Cloud reverse-engineering work as a template, or (2) wait for/lobby PocketBook for an API, or (3) if smart-home control is the real goal, buy a SwitchBot AI Art Frame instead.

## Key Findings

1. **No InkPoster-specific reverse engineering exists publicly.** Extensive searching of GitHub, forums, Reddit, XDA, e-ink enthusiast sites, and privacy-analysis platforms turned up zero projects, writeups, packet captures, APK decompilations, or protocol documentation targeting InkPoster. The product is new — unveiled at CES 2025 (Jan 7–8, 2025), with a stated expected spring-2025 launch and owner retail-sale reports appearing by December 6, 2025 — which partly explains the absence.
2. **InkPoster = PocketBook.** Confirmed by PocketBook's own press releases and the InkPoster FAQ: "InkPoster is developed by PocketBook, a Swiss company." The app on both stores is published by **Pocketbook International SA**, with support email info@obreey-products.com (Obreey Products is PocketBook's software/product arm). PocketBook International SA was founded in 2007 in Kyiv, Ukraine and moved its HQ to Lugano, Switzerland in 2012; it is one of the world's largest premium E Ink reader makers, sold in roughly 35 countries.
3. **The frame is cloud-dependent and app-only.** Setup requires the app to connect the frame to Wi-Fi and pair it to a cloud account; artwork, uploads, firmware updates and device control all route through the app/cloud. There is no documented local/LAN control interface.
4. **The official Android app can't even upload custom images yet.** A verified InkPoster owner reported that PocketBook's US brand manager admitted the Android app cannot transfer custom hi-res PNGs and "would not be completed anytime soon," initiating a return.
5. **The SwitchBot AI Art Frame is the best analog and IS controllable from a PC.** It uses the same E Ink Spectra 6 panels, has an official documented cloud REST API (api.switch-bot.com), Home Assistant integration, and community projects. It is a different company (SwitchBot International / OpenWonderLabs), so its API will not work on InkPoster, but it is a working reference for what's possible and a viable alternative product.
6. **PocketBook Cloud already has reverse-engineered API clients.** PocketBook's e-reader cloud (same corporate backend, obreey-products.com) has been reverse-engineered by third parties (e.g., pbcsync, and a calibre integration request), providing a methodology template even though the InkPoster art endpoints differ.

## Details (Organized by Your 13 Items + Offshoots)

### 1. Reverse-engineering efforts / writeups / forum threads (InkPoster)
Nothing InkPoster-specific found. The only substantive owner discussion is a comment thread on The eBook Reader blog ("PocketBook Now Selling E Ink Posters," Dec 6 2025, blog.the-ebook-reader.com), where an owner documents Wi-Fi setup difficulties and the Android app's inability to upload custom images. Reviews (Fstoppers, Creative Bloq, PetaPixel, PCWorld, New Atlas, Good e-Reader) are consumer-focused and contain no technical/protocol detail.

### 2. API documentation / endpoints / protocols (InkPoster)
None published. No official developer portal, no public API, no endpoint documentation. The InkPoster FAQ explicitly frames the app as the sole interface.

### 3. APK analysis / decompilation
No published Exodus Privacy report, AppBrain analysis, or decompilation of the InkPoster app (package id `inkposter.com`) was found. The APK is downloadable from mirror sites (APKPure/APKMirror) for anyone wishing to run their own static analysis, but no one has published such an analysis. The app's cloud backend is expected to sit on PocketBook/Obreey infrastructure (obreey-products.com), based on the shared support email and corporate ownership.

### 4. HTTP/packet captures / traffic analysis
None found for InkPoster. This is the single most promising DIY avenue and is standard practice: route the phone's traffic through mitmproxy, Charles, Fiddler, or Burp (with a trusted CA cert on the phone) while operating the app, then observe the REST calls for authentication, device pairing, artwork listing, and image upload, and replay them from a PC script. No one has published such a capture yet.

### 5. Wi-Fi / local network / mDNS / direct IP access
No documented local-control method. The frame uses dual-band Wi-Fi (2.4/5 GHz). Reviews and FAQ describe remote/cloud updates ("from anywhere, at any time"), implying a cloud round-trip rather than direct LAN control. No mDNS/Bonjour service advertisement has been documented. Whether the frame exposes any local port is untested/unpublished — a worthwhile thing to probe with an nmap scan and an mDNS browser once on the same subnet.

### 6. Bluetooth / BLE access
The frame has Bluetooth, used during initial setup/provisioning (typical pattern: BLE to hand off Wi-Fi credentials). No service/characteristic UUIDs, pairing procedures, or BLE captures have been published for InkPoster.

### 7. Factory reset / setup / provisioning procedures
The only real-world provisioning account is the eBook Reader blog comment: the owner had to use a phone hotspot + the app on an old phone to complete Wi-Fi setup, then migrate to home Wi-Fi. No RESET-code or provisioning-protocol documentation exists. Official setup guidance is on inkposter.com/pages/support and the FAQ.

### 8. Firmware information / updates / downloads / analysis
Firmware updates are handled through the app (per FAQ). No firmware images, update URLs, or firmware analyses have been published. No teardown has exposed the bootloader or flash layout.

### 9. GitHub / GitLab / code repositories (InkPoster)
None exist for InkPoster. Adjacent PocketBook repos that establish methodology and backend:
- `micronull/pocketbook-cloud-sync` (github.com/micronull/pocketbook-cloud-sync) — a Go CLI that authenticates to the PocketBook Cloud API with a client-id/client-secret and syncs a library; demonstrates how the PocketBook cloud auth works.
- `JuanJakobo/Pocketbook-Nextcloud-Client` — shows the PocketBook SDK toolchain (arm-obreey-linux-gnueabi), confirming the "Obreey" build environment.
- calibre bug #1884304 (Launchpad) — a request to connect calibre to PocketBook Cloud, referencing the documented store-to-cloud API.

### 10. Home Assistant / Homebridge / smart-home projects (InkPoster)
None target InkPoster. General e-ink-for-HA projects exist (ESPHome + Waveshare panels, Seeed reTerminal E-paper, kotope/eink-art-gallery-addon) but are unrelated DIY hardware. For the analog products, robust integrations exist (see offshoots below).

### 11. Reddit / HN / XDA / e-ink forums
No InkPoster technical threads found. Discussion is limited to consumer reviews and the eBook Reader blog comments. (The Alibaba/electronics writeup on SwitchBot cites "r/homeassistant threads from November 2025" for that product, not InkPoster.)

### 12. Hardware teardown / chipset / controller
No teardown published. Known facts: E Ink Spectra 6 panels (28.5" model adds Sharp IGZO backplane); a 14,000-mAh battery on the 13.3" and a 20,000-mAh battery on both the 28.5" and 31.5" (per New Atlas); USB-C charging; dual-band Wi-Fi + Bluetooth; aluminum body. The specific Wi-Fi/BLE chipset or microcontroller has not been identified in any public source; PocketBook's FCC filings (grantee Pocketbook International SA) would be the place to find the module identity and internal photos.

### 13. Manufacturer / OEM / white-label status
InkPoster is **not** a white-label of another brand — it is PocketBook's own product (a PocketBook spin-off brand), co-developed with E Ink (panels) and Sharp (IGZO backplane on the 28.5"). PocketBook is a long-established (founded 2007) e-reader maker headquartered in Lugano, Switzerland; its software arm is Obreey Products.

### Offshoots & Related Products (Ranked by Usefulness)

**A. SwitchBot AI Art Frame — MOST USEFUL ANALOG (has a real API + PC control).**
- Same E Ink Spectra 6 panel family; different vendor (SwitchBot International / OpenWonderLabs), launched Nov 13, 2025 in 7.3"/13.3"/31.5" sizes from USD 149.99. Its "AI Studio" feature is powered by NanoBanana, which runs Google's Gemini 2.5 Flash Image model.
- **Official cloud REST API** at `https://api.switch-bot.com` (v1.1), deviceType `AI Art Frame`. Auth via token + secret with an HMAC-SHA256 `sign` header, `t` timestamp, and `nonce`. Status endpoint (`GET /v1.1/devices/{deviceId}/status`) returns `battery`, `imageUrl`, and firmware `version`; commands are sent via `POST /v1.1/devices/{deviceId}/commands`.
- Documented capabilities: read battery/current image, go to next/previous image, and — added ~May 2026 — an `uploadImage <httpsURL>` command. Local storage is capped at 10 images (SwitchBot's Nov 13, 2025 launch confirms "storing up to 10 pictures locally," and API issue #486 notes "once the local storage is full (10 images) the commands fail"). Sources: OpenWonderLabs/SwitchBotAPI README and issues #461 and #486; OpenWonderLabs/switchbot-openapi-cli CHANGELOG.
- **Home Assistant**: the `switchbot_cloud` integration gained art-frame support (home-assistant/core commit "Add support for switchbot art frame"). Requires a SwitchBot Hub with cloud enabled; the API is limited to 10,000 calls per day per token, and exceeding it returns an HTTP 401 / statusCode 190 "Requests reached the daily limit."
- A practical HMAC signing + `rest_command` recipe is documented at speaktothegeek.co.uk (SwitchBot API v1.1 and Home Assistant).
- **Implication:** If the user's real goal is PC/smart-home control of an e-ink art frame, the SwitchBot AI Art Frame is the product that actually supports it today. It will NOT control an InkPoster.

**B. Samsung The Frame (Art Mode) — mature reverse-engineered ecosystem.**
- `janstrm/Home-Assistant-Samsung-Frame-Art-Director-Integration` and the underlying `NickWaterton/samsung-tv-ws-api` provide local upload, slideshow, and gallery control from a PC/HA. Not e-ink, but the best example of a fully community-controlled art frame and a model for what an InkPoster integration could look like.

**C. PocketBook Cloud (same corporate backend).** Reverse-engineered clients (pbcsync) and the documented store-to-cloud API show how PocketBook/Obreey authentication is structured — the closest thing to a roadmap for InkPoster's cloud.

**D. Other e-ink frames for context:** Vestaboard (has an official API), Visionect/Joan (enterprise SDK/API), Pimoroni Inky / Waveshare (fully open DIY, ESPHome/Python), Meural (Netgear, has an unofficial API community). Aura/Skylight/Nixplay/Dragon Touch are LCD not e-ink. None share InkPoster's platform.

## Recommendations (Staged)

**Stage 1 — Set expectations and confirm current state (do first).**
There is no ready-made PC tool for InkPoster. Confirm nothing has changed by (a) re-checking the InkPoster app's release notes for any "desktop"/"web"/"API" mention, and (b) contacting InkPoster support to ask directly whether a public API, web uploader, or desktop client is planned. Given the Android app can't yet upload custom images, native PC support is unlikely near-term.

**Stage 2 — DIY discovery if you want to proceed (highest-yield technical path).**
1. **Capture the app's cloud API.** Install mitmproxy (or Charles/Burp), install its CA on the phone, and record traffic while you pair the frame, browse art, upload a photo, and change the display. Identify the base host (likely on obreey-products.com or an inkposter.com/AWS endpoint), the auth flow, and the image-upload call.
2. **Watch for certificate pinning.** If TLS interception fails, the app pins certs — you'd then need Frida on a rooted/emulated Android to bypass, or static APK analysis (jadx) to read endpoint URLs and keys.
3. **Probe the LAN.** With the frame on your Wi-Fi, run an mDNS/Bonjour browse and an `nmap` scan of the frame's IP to see whether any local port responds.
4. **Replay from PC.** Reproduce the discovered calls in a Python script (requests) to push images from your computer via the cloud.
5. **Publish** your findings (GitHub) — you'd be the first, and it would attract collaborators.

**Stage 3 — If control matters more than the specific device.**
Buy a **SwitchBot AI Art Frame** (Spectra 6, official API, HA support, image upload) and drive it from a PC via `api.switch-bot.com` or Home Assistant. This is the only e-ink art frame in this class with turnkey PC/automation control today.

**Benchmarks that would change the recommendation:** PocketBook publishing an API or web uploader; a completed Android upload feature (suggests API groundwork exists to sniff); or any published packet capture/GitHub repo appearing for InkPoster — any of these would shift the path from "buy an alternative" to "use the documented/discovered InkPoster method."

## Caveats
- **Recency/absence of evidence:** InkPoster is a 2025 product; the total lack of reverse-engineering material may reflect its newness and niche, premium ($599 for the 13.3", $1,699/$1,700 for the 31.5", and $2,399/$2,400 for the Sharp IGZO 28.5" — note the mid-size 28.5" is the most expensive) market rather than technical impossibility. New material could appear at any time.
- **Different vendors, non-transferable APIs:** SwitchBot and InkPoster share only the E Ink Spectra 6 panel, not firmware, app, or cloud. SwitchBot's API, HA integration, and commands will not work on an InkPoster.
- **Legal/ToS:** Reverse-engineering the app or API may violate PocketBook's terms of service; the user asked only to find existing work, but any DIY path carries that caveat.
- **Unverified specifics:** The exact Wi-Fi/BLE chipset in InkPoster is not confirmed in public sources; the precise SwitchBot command JSON tokens for next/previous were confirmed to exist but not extracted verbatim; and whether InkPoster exposes any local port is untested. These are flagged as gaps, not established facts.
- **Forward-looking items:** SwitchBot's `uploadImage` command and HA art-frame support are recent (2026) additions; treat older third-party claims of "no API" as outdated.