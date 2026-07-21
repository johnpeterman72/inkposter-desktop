// Samsung EMDX e-paper control over the LAN — a completely separate device type
// from the (cloud) InkPoster frames. Speaks Samsung's MDC protocol over TCP:1515
// (upgraded to TLS, authenticated with a 6-digit PIN). Zero external deps — only
// Node built-ins. Ported from the protocol in WeeJeWel/node-samsung-mdc (ISC)
// and the image-push flow in WeeJeWel/node-samsung-emdx.
//
// Image push: the display pulls the image from a tiny local HTTP server we spin
// up — we send it a `setContentDownload` (0xC7) pointing at a content.json that
// references the image URL. The display must be able to reach this PC on the LAN.
const net = require("net");
const tls = require("tls");
const dgram = require("dgram");
const http = require("http");
const os = require("os");
const crypto = require("crypto");

const HEADER_CODE = 0xaa;
const RESPONSE_CODE = 0xff;

// The LAN IPv4 the display can reach us on. When targetHost is given, prefer the
// interface on the same /24 (so a VMware/WSL virtual adapter isn't chosen over
// the real Wi-Fi/Ethernet NIC). Link-local 169.254.x is skipped.
function localIp(targetHost) {
  const cand = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) cand.push(n.address);
    }
  }
  if (targetHost) {
    const pfx = targetHost.split(".").slice(0, 3).join(".") + ".";
    const match = cand.find((a) => a.startsWith(pfx));
    if (match) return match;
  }
  return cand[0] || "127.0.0.1";
}

function magicPacket(mac, bytes = 6, repetitions = 16) {
  const macBuf = Buffer.alloc(bytes);
  mac.split(":").forEach((v, i) => { macBuf[i] = parseInt(v, 16); });
  const buf = Buffer.alloc(bytes + repetitions * bytes, 0xff);
  for (let i = 0; i < repetitions; i++) macBuf.copy(buf, (i + 1) * bytes);
  return buf;
}

class Device {
  constructor({ host, port = 1515, pin = "000000", mac = "00:00:00:00:00:00" }) {
    this.host = host; this.port = port; this.pin = String(pin); this.mac = mac;
    this._connected = false;
    this._commands = {}; // displayId -> commandId -> {resolve,reject}
  }

  wakeup({ port = 9, host = "255.255.255.255" } = {}) {
    return new Promise((resolve, reject) => {
      const packet = magicPacket(this.mac);
      const socket = dgram.createSocket("udp4");
      socket.once("listening", () => socket.setBroadcast(true));
      socket.send(packet, 0, packet.length, port, host, (err) => {
        socket.close();
        if (err) reject(err); else resolve();
      });
    });
  }

  connect() {
    if (this._connected) return Promise.resolve();
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = new Promise((resolve, reject) => {
      const tcp = net.connect({ host: this.host, port: this.port, rejectUnauthorized: false });
      this._tcp = tcp;
      const to = setTimeout(() => reject(new Error("connect timed out")), 10000);
      tcp.on("data", (data) => {
        if (`${data}` === "MDCSTART<<TLS>>") {
          const tlsSock = tls.connect({ socket: tcp, rejectUnauthorized: false }, () => {
            tlsSock.write(Buffer.from(this.pin), (err) => { if (err) reject(err); });
          });
          this._tls = tlsSock;
          tlsSock.on("data", (d) => this._onData(d, resolve, reject, to));
          tlsSock.once("error", reject);
        }
      });
      tcp.on("error", reject);
      tcp.once("close", () => reject(new Error("connection closed")));
    }).then(() => {
      this._connectPromise = null; this._connected = true;
    });
    return this._connectPromise;
  }

  _onData(data, connResolve, connReject, connTimeout) {
    if (`${data}` === "MDCAUTH<<PASS>>") { clearTimeout(connTimeout); return connResolve(); }
    if (`${data}` === "MDCAUTH<<FAIL:0x01>>") { clearTimeout(connTimeout); return connReject(new Error("Auth failed: incorrect PIN")); }
    if (`${data}` === "MDCAUTH<<FAIL:0x02>>") { clearTimeout(connTimeout); return connReject(new Error("Auth failed: blocked (too many attempts)")); }
    if (data[0] === HEADER_CODE && data[1] === RESPONSE_CODE) {
      const displayId = data[2], length = data[3], ackOrNak = data[4], commandId = data[5];
      const payload = data.slice(6, 6 + length - 2);
      const checksum = data[data.length - 1];
      const cmd = this._commands[displayId] && this._commands[displayId][commandId];
      if (!cmd) return;
      const calc = data.slice(1, data.length - 1).reduce((s, b) => s + b, 0) % 256;
      if (checksum !== calc) return cmd.reject(new Error("checksum mismatch"));
      if (ackOrNak === 0x41) return cmd.resolve(payload);       // 'A' ACK
      if (ackOrNak === 0x4e) { const e = new Error("NAK"); e.payload = payload; return cmd.reject(e); } // 'N'
    }
  }

  disconnect() {
    if (this._tls) { this._tls.end(); this._tls = null; }
    if (this._tcp) { this._tcp.end(); this._tcp = null; }
    this._connected = false;
    return Promise.resolve();
  }

  async sendCommand({ commandId = 0x00, displayId = 0, data = [] }) {
    if (!this._connected) await this.connect();
    const payload = [commandId, displayId, data.length, ...data];
    const checksum = payload.reduce((s, b) => s + b, 0) % 256;
    this._commands[displayId] = this._commands[displayId] || {};
    if (this._commands[displayId][commandId]) throw new Error(`command ${commandId} already in progress`);
    const result = new Promise((resolve, reject) => {
      this._commands[displayId][commandId] = { resolve, reject };
      setTimeout(() => reject(new Error(`command ${commandId} timed out`)), 8000);
    }).finally(() => { delete this._commands[displayId][commandId]; });
    await new Promise((resolve, reject) =>
      this._tls.write(Buffer.from([HEADER_CODE, ...payload, checksum]), (e) => e ? reject(e) : resolve()));
    return result;
  }

  async getSerialNumber() { return String(await this.sendCommand({ commandId: 0x0b })); }
  async getSoftwareVersion() { return String(await this.sendCommand({ commandId: 0x0e })); }
  async getDeviceName() { return String(await this.sendCommand({ commandId: 0x67 })); }
  async getPowerState() {
    const r = await this.sendCommand({ commandId: 0x11 });
    return { 0: "off", 1: "on", 2: "reboot" }[r[0]] ?? "unknown";
  }
  async getBatteryState() {
    const r = await this.sendCommand({ commandId: 0x1b, data: [0x73] });
    return { batteryPercent: r[4], warningEnabled: r[2] === 0x01, pluggedIn: r[6] === 0x02 };
  }
  async setContentDownload(url) {
    if (!url) throw new Error("missing url");
    if (url.length > 255) throw new Error("url too long (max 255 chars)");
    await this.sendCommand({
      commandId: 0xc7,
      data: [0x53, 0x80, url.length, ...Buffer.from(url)],
    });
  }
  async setPower(on) {
    // 0x11 with a data byte sets power (0x01 on, 0x00 off / sleep).
    await this.sendCommand({ commandId: 0x11, data: [on ? 0x01 : 0x00] });
  }
}

// --- High-level helpers used by the server -----------------------------------

async function withDevice(frame, fn) {
  const dev = new Device(frame);
  try { await dev.connect(); return await fn(dev); }
  finally { try { await dev.disconnect(); } catch {} }
}

async function status(frame) {
  return withDevice(frame, async (dev) => {
    const out = { host: frame.host, name: frame.name };
    try { out.power = await dev.getPowerState(); } catch (e) { out.power = "?"; }
    try { const b = await dev.getBatteryState(); out.battery = b.batteryPercent; out.pluggedIn = b.pluggedIn; } catch {}
    try { out.software = await dev.getSoftwareVersion(); } catch {}
    try { out.serial = await dev.getSerialNumber(); } catch {}
    try { out.deviceName = await dev.getDeviceName(); } catch {}
    return out;
  });
}

// Serve content.json + the image on an ephemeral local HTTP server, tell the
// display to download it, and resolve once the display has fetched the image.
function showImage(frame, imageBuffer, { mediaType = "image/jpeg", timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const ip = frame.localIp || localIp(frame.host);
    const fileId = crypto.randomUUID().toUpperCase();
    const ext = mediaType.includes("png") ? "png" : "jpg";
    const fileName = `${fileId}.${ext}`;
    let served = false;

    const server = http.createServer((req, res) => {
      if (req.url === "/content.json") {
        const url = `http://${ip}:${server.address().port}/image`;
        const manifest = JSON.stringify({
          schedule: [{
            start_date: "1970-01-01", stop_date: "2999-12-31", start_time: "00:00:00",
            contents: [{
              image_url: url, file_id: fileId,
              file_path: `/home/owner/content/Downloads/vxtplayer/epaper/mobile/contents/${fileId}/${fileName}`,
              duration: 91326, file_size: `${imageBuffer.length}`, file_name: fileName,
            }],
          }],
          name: "inkposter-desktop", version: 1, create_time: "2025-01-01 00:00:00",
          id: fileId, program_id: "com.samsung.ios.ePaper", content_type: "ImageContent", deploy_type: "MOBILE",
        }).replaceAll("/", "\\/");
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(manifest);
      }
      if (req.url === "/image") {
        res.writeHead(200, { "Content-Type": mediaType, "Content-Length": imageBuffer.length });
        res.end(imageBuffer);
        served = true;
        // give the panel a moment, then finish.
        setTimeout(() => { try { server.close(); } catch {} resolve({ fileId }); }, 1500);
        return;
      }
      res.writeHead(404); res.end();
    });

    const to = setTimeout(() => {
      try { server.close(); } catch {}
      if (served) resolve({ fileId });
      else reject(new Error("display never fetched the image (check LAN reachability / firewall)"));
    }, timeoutMs);
    to.unref?.();

    server.listen(0, async () => {
      try {
        const dev = new Device(frame);
        if (frame.mac) { try { await dev.wakeup(); await new Promise(r => setTimeout(r, 1200)); } catch {} }
        await dev.connect();
        await dev.setContentDownload(`http://${ip}:${server.address().port}/content.json`);
        await dev.disconnect();
      } catch (e) {
        clearTimeout(to); try { server.close(); } catch {} reject(e);
      }
    });
  });
}

async function wake(frame) { return new Device(frame).wakeup(); }

module.exports = { Device, status, showImage, wake, localIp };
