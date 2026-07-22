# Samsung EMDX e-paper — MDC protocol (reverse-engineered)

The Samsung EMDX is a **LAN-controlled** color e-paper frame (no cloud), driven by
Samsung's **MDC** (Multiple Display Control) protocol. This is a completely separate
device family from the (cloud) InkPoster frames. Implemented in `server/samsung.js`
(zero deps — Node `net`/`tls`/`dgram`/`http`).

Derived from WeeJeWel/node-samsung-mdc + node-samsung-emdx (ISC) and
pauln/ha-samsung-e-paper (the `samsung-mdc@emdx` fork), validated live against a
real EMDX 784R.

## Connection & auth

```
TCP connect to <host>:1515
  → device sends the literal bytes  MDCSTART<<TLS>>
  → upgrade the SAME socket to TLS  (self-signed; rejectUnauthorized:false)
  → write the 6-digit PIN as raw ASCII (e.g. "000000")
  → device replies:
       MDCAUTH<<PASS>>          auth OK
       MDCAUTH<<FAIL:0x01>>     incorrect PIN
       MDCAUTH<<FAIL:0x02>>     blocked (too many bad attempts — don't brute-force)
```

- Default/observed PIN is `000000`. (An app-shown 6-digit code was NOT the MDC PIN.)
- If TCP connects but no `MDCSTART` arrives, the display is **busy or asleep**
  (e.g. stuck retrying a failed content download — see below).
- **Wake-on-LAN:** UDP magic packet (16× the MAC) to `255.255.255.255:9`.

## Command framing (over TLS, after auth)

Send: `[0xAA, commandId, displayId, len, ...data, checksum]` where
`checksum = (commandId + displayId + len + ...data) % 256`, `displayId` = 0.

Reply: `[0xAA, 0xFF, displayId, len, ackOrNak, commandId, ...payload, checksum]`.
`ackOrNak`: `0x41 'A'` = ACK (payload is the result), `0x4E 'N'` = NAK.

Commands used: serial `0x0B`, software version `0x0E`, device name `0x67`,
power state `0x11` (0=off,1=on,2=reboot — returns an unmapped value on the EMDX),
battery `0x1B` data `[0x73]` (→ `{percent: r[4], pluggedIn: r[6]===0x02}`),
**content download `0xC7`** data `[0x53, 0x80, urlLen, ...url]` (URL ≤ 255 chars).

## Image push flow

The display **pulls** the image from the controller:

1. Run a small HTTP server on the PC serving two endpoints:
   - `/content.json` — a manifest (`program_id: com.samsung.ios.ePaper`,
     `content_type: ImageContent`, `deploy_type: MOBILE`) whose `image_url` points
     at `/image`. JSON forward-slashes are escaped as `\/`.
   - `/image` — the image bytes (plain JPEG/PNG; the panel scales/converts).
2. `setContentDownload(0xC7)` with `http://<pc-lan-ip>:<port>/content.json`.
3. The display fetches `/content.json` then `/image` and refreshes.

**Critical:** the display must be able to reach the PC. The PC's `localIp` must be
the interface on the **same subnet** as the frame (not a VMware/WSL virtual
adapter). On a **client-isolated** Wi-Fi (corporate/guest) the frame can't connect
back and the push fails — and worse, the display gets **stuck retrying** the
unreachable download and stops answering MDC until it recovers or is power-cycled.
Use a network without client isolation (home router / phone hotspot).

## Config & API in this app

`server/config.local.json` (gitignored): `samsungFrames: [{ name, host, pin, mac,
localIp }]` — PIN stays server-side. Routes: `GET /api/samsung/frames`,
`POST /api/samsung/status`, `POST /api/samsung/wake`,
`POST /api/samsung/upload?host=` (raw image body). UI: Samsung frames appear in the
unified sidebar with their own Device view (status + wake + upload).
