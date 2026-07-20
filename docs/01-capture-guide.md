# Capturing the InkPoster app's API traffic

Goal: watch exactly what the iPhone app sends to InkPoster's cloud so we can
replicate it. We route the iPhone's traffic through **mitmproxy** running on your
Windows desktop, then perform actions in the app and record the requests.

You only have to do this once. Save the results and I'll build from them.

---

## Before you start

- iPhone and Windows PC must be on the **same Wi-Fi network**.
- You'll temporarily point the iPhone's Wi-Fi at a proxy on your PC, install a
  certificate so HTTPS is readable, then **undo both** when done.
- Time: ~15 minutes.

---

## Step 1 — Install mitmproxy on the PC

In PowerShell (Python 3.12 is already installed):

```powershell
pip install mitmproxy
```

Verify:

```powershell
mitmweb --version
```

## Step 2 — Find your PC's local IP

```powershell
ipconfig
```
10.100.40.33

10.100.30.32



Look under your Wi-Fi adapter for **IPv4 Address**, e.g. `192.168.1.50`.
Write it down — the iPhone needs it. (Below, replace `PC_IP` with this.)

## Step 3 — Start mitmproxy with its web UI

```powershell
mitmweb --listen-port 8080
```

- This starts a proxy on port **8080** and opens a web dashboard at
  `http://127.0.0.1:8080` in your PC browser. Leave this window running.
- If Windows Firewall pops up, **Allow access** (Private networks) so the iPhone
  can reach the proxy. If you miss the popup, run this once in an **Admin**
  PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "mitmproxy 8080" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
  ```

## Step 4 — Point the iPhone at the proxy

On the iPhone:

1. **Settings → Wi-Fi**, tap the **ⓘ** next to your network.
2. Scroll to **Configure Proxy → Manual**.
3. **Server:** `PC_IP` (from Step 2) — **Port:** `8080`.
4. Save.

## Step 5 — Install & trust the mitmproxy certificate on the iPhone

HTTPS is encrypted; without this cert we'd only see gibberish.

1. In iPhone **Safari**, go to **http://mit.it** (that's `mitm.it`, no www).
   You should see the mitmproxy page. If not, the proxy/firewall isn't reachable
   — recheck Steps 3–4.
2. Tap the **Apple** logo to download the profile. Allow the download.
3. **Settings → General → VPN & Device Management** → tap the **mitmproxy**
   profile → **Install** (enter passcode).
4. **Settings → General → About → Certificate Trust Settings** → toggle **ON**
   full trust for **mitmproxy**.

## Step 6 — Record the app doing its thing

Open the mitmweb dashboard on your PC (`http://127.0.0.1:8080`) so you can watch
requests stream in. Then in the InkPoster app, do these actions **deliberately
and one at a time** (pause a few seconds between each so the flows are easy to
tell apart):

1. **Log out, then log in** — captures the auth/login flow (most important).
2. Open the screen that **lists your display(s)** / device settings.
3. **Change the artwork** to a different piece from the library.
4. **Upload a personal photo** and set it on the display.
5. Change a **setting** (e.g. orientation or sync interval) if easy.

Watch the dashboard: you're looking for requests to a host like `inkposter.com`,
`pocketbook*`, or some API domain (e.g. `api.*`). Ignore Apple/analytics/CDN noise.

## Step 7 — Save the capture

In the **mitmweb** dashboard:

- **File → Save** (or the save icon) to write all flows to a `.mitm` file, **or**
- Select the relevant flows → right-click → **Export → HAR** if available.

Easiest reliable option: save the whole session as a flow file. From the command
line you can also just run the capture headless and it writes a file:

```powershell
mitmdump -w inkposter_capture.mitm
```

(Use `mitmdump -w ...` instead of `mitmweb` in Step 3 if you prefer; same proxy,
saves straight to a file.)

Put the saved file in this folder:

```
D:\Google_Cloud_Drive\Claude Code Projects\inkposter\docs\captures\
```

## Step 8 — CLEAN UP (important)

1. iPhone **Settings → Wi-Fi → ⓘ → Configure Proxy → Off**.
2. iPhone **Settings → General → VPN & Device Management** → remove the
   **mitmproxy** profile. (Leaving a trusted MITM cert installed is a security
   risk.)
3. Close mitmproxy on the PC.

---

## What I need back from you

Either:

- The saved `.mitm` / `.har` file dropped in `docs/captures/`, **or**
- Just tell me and I'll read it — I can parse the capture and pull out the
  endpoints, headers, and auth automatically.

If you'd rather not share the raw file (it contains your auth token), tell me and
I'll give you a tiny script that strips it down to just the API shape.

---

## If it doesn't work: certificate pinning

If in Step 6 you see the app fail to load / show connection errors, and mitmweb
shows **red/errored flows** to the InkPoster host with TLS handshake failures —
that's **certificate pinning**. The app refuses any cert but the real one.

This is the one thing that can block us. If it happens, **stop and tell me** —
we'll assess options (they're heavier: an Android emulator with Frida SSL-unpin,
or checking whether the display exposes anything on the local network directly).
Don't spend time fighting it; just report what you see.
