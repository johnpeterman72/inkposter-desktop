// Direct Bluetooth LE control of an InkPoster frame — bypasses the cloud sync
// delay to trigger an immediate content fetch, reboot, or ghosting clean.
//
// Protocol: docs/reference/BLE_PROTOCOL.md (reverse-engineered from the APK).
// This is OPTIONAL and isolated: it lazy-loads a noble BLE backend and every
// entry point degrades to a clear "unavailable" error if the module or a
// Bluetooth adapter isn't present — the rest of the app never depends on it.
//
// Windows note: install a backend first —  `npm install @stoprocent/noble`
// (best Win11 support) or `@abandonware/noble`. Bluetooth must be ON. This has
// NOT been tested against real hardware from this codebase; treat as beta.
const crypto = require("crypto");

// --- Protocol constants (BLE_PROTOCOL.md) ---
const NAME_PREFIX = "InkP-";
const SVC = "706218eed3d646ad80806eefbacf7dbc";
const CH_STATUS = "aa5a52bbe56042b5be837b79f7627f6d";
const CH_COMMAND = "1b5f2d1a8ff5459ea8de73e13c051a13";
const HEADER_SHORT = 0x01;
const DEFAULT_SKEY = Buffer.from("b716c1d9807b857fcb26f26fab215c6b", "hex");
const SECURE_MODE_BIT = 0x00000040;
const LAUNCHER_READY_BIT = 0x00020000;

const ACTIONS = {
  factoryReset: { action: 1 },
  reboot: { action: 3 },
  fetch: { action: 42 },
  ghostingClean: { action: 44 },
};

// --- Lazy backend load ---
let _noble = null;
let _loadError = null;
function noble() {
  if (_noble) return _noble;
  if (_loadError) throw _loadError;
  for (const mod of ["@stoprocent/noble", "@abandonware/noble", "noble"]) {
    try { _noble = require(mod); return _noble; } catch { /* try next */ }
  }
  _loadError = new Error(
    "No BLE backend installed. Run `npm install @stoprocent/noble` (recommended on " +
    "Windows) and make sure Bluetooth is turned on.");
  throw _loadError;
}

function isAvailable() {
  try { noble(); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the adapter to reach poweredOn (or throw with a clear reason).
function waitPoweredOn(timeoutMs = 6000) {
  const n = noble();
  if (n.state === "poweredOn") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      n.removeListener("stateChange", onState);
      reject(new Error(`Bluetooth adapter not ready (state: ${n.state}). Is Bluetooth on?`));
    }, timeoutMs);
    function onState(s) {
      if (s === "poweredOn") { clearTimeout(to); n.removeListener("stateChange", onState); resolve(); }
      else if (s === "unsupported" || s === "unauthorized") {
        clearTimeout(to); n.removeListener("stateChange", onState);
        reject(new Error(`Bluetooth ${s} on this machine.`));
      }
    }
    n.on("stateChange", onState);
  });
}

// Scan for InkP-* devices. Returns [{ id, name, rssi }].
async function scan(durationMs = 5000) {
  const n = noble();
  await waitPoweredOn();
  const found = new Map();
  const onDiscover = (p) => {
    const name = p.advertisement && p.advertisement.localName;
    if (name && name.startsWith(NAME_PREFIX)) {
      found.set(p.id, { id: p.id, name, rssi: p.rssi });
    }
  };
  n.on("discover", onDiscover);
  await n.startScanningAsync([], false);
  await sleep(durationMs);
  await n.stopScanningAsync();
  n.removeListener("discover", onDiscover);
  return [...found.values()];
}

// Find a peripheral: by id, by name, or the first InkP-* seen.
async function findPeripheral({ id, name } = {}, timeoutMs = 8000) {
  const n = noble();
  await waitPoweredOn();
  return new Promise(async (resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(to);
      n.removeListener("discover", onDiscover); n.stopScanningAsync().catch(() => {}); fn(arg); };
    const to = setTimeout(() => finish(reject, new Error("No matching InkPoster found (scan timed out).")), timeoutMs);
    const onDiscover = (p) => {
      const nm = p.advertisement && p.advertisement.localName;
      if (id && p.id !== id) return;
      if (name && nm !== name) return;
      if (!id && !name && !(nm && nm.startsWith(NAME_PREFIX))) return;
      finish(resolve, p);
    };
    n.on("discover", onDiscover);
    try { await n.startScanningAsync([], false); }
    catch (e) { finish(reject, e); }
  });
}

function parseStatus(buf) {
  if (!buf || buf.length < 28) throw new Error(`status too short (${buf ? buf.length : 0} bytes)`);
  const status = buf.readUInt32LE(8);
  let model = "";
  for (let i = 20; i < 28; i++) { if (buf[i] === 0) break; model += String.fromCharCode(buf[i]); }
  const fw = buf.readUInt32LE(16);
  return {
    msgSeq: buf.readUInt16LE(2),
    version: buf[4],
    battery: buf[5],
    wifiQuality: buf[6],
    keySeq: buf[7],
    statusBits: status,
    secureMode: !!(status & SECURE_MODE_BIT),
    launcherCmdReady: !!(status & LAUNCHER_READY_BIT),
    jobs: buf.readUInt32LE(12),
    firmware: `${(fw >>> 24) & 0xff}.${(fw >>> 16) & 0xff}.${fw & 0xffff}`,
    model,
  };
}

// Frame a command per BLE_PROTOCOL.md:
//   mac = HMAC_SHA256(skey, seqLE16 || (header || payload))[0..4]
//   frame = header || payload || mac4
function frameCommand(payloadObj, msgSeq, skey) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const headerAndPayload = Buffer.concat([Buffer.from([HEADER_SHORT]), payload]);
  const seqLE16 = Buffer.alloc(2); seqLE16.writeUInt16LE(msgSeq & 0xffff, 0);
  const mac = crypto.createHmac("sha256", skey)
    .update(Buffer.concat([seqLE16, headerAndPayload])).digest();
  return Buffer.concat([headerAndPayload, mac.subarray(0, 4)]);
}

async function withConnection(selector, fn) {
  const p = await findPeripheral(selector);
  await p.connectAsync();
  try {
    if (typeof p.requestMtu === "function") { try { await p.requestMtu(512); } catch {} }
    const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync(
      [SVC], [CH_STATUS, CH_COMMAND]);
    const statusCh = characteristics.find((c) => c.uuid === CH_STATUS);
    const cmdCh = characteristics.find((c) => c.uuid === CH_COMMAND);
    if (!statusCh || !cmdCh) throw new Error("InkPoster GATT characteristics not found.");
    return await fn({ peripheral: p, statusCh, cmdCh });
  } finally {
    try { await p.disconnectAsync(); } catch {}
  }
}

// Read + parse the status characteristic.
async function status(selector = {}) {
  return withConnection(selector, async ({ statusCh, peripheral }) => {
    const buf = await statusCh.readAsync();
    return { deviceId: peripheral.id, name: peripheral.advertisement.localName, ...parseStatus(buf) };
  });
}

// Send an action. `sharedKey` (hex) is only used when the device is in secure
// mode; otherwise the built-in default key is required (per the protocol).
async function sendAction(actionObj, { sharedKey, ...selector } = {}) {
  return withConnection(selector, async ({ statusCh, cmdCh, peripheral }) => {
    const st = parseStatus(await statusCh.readAsync());
    if (!st.launcherCmdReady) {
      throw new Error("Device not ready for commands (launcherCmdReady is false). " +
        "It may be mid-firmware-update; try again in a few seconds.");
    }
    const skey = st.secureMode && sharedKey ? Buffer.from(sharedKey, "hex") : DEFAULT_SKEY;
    const frame = frameCommand(actionObj, st.msgSeq, skey);
    await cmdCh.writeAsync(frame, false); // write-with-response for reliability
    return { deviceId: peripheral.id, sent: actionObj, usedKey: skey === DEFAULT_SKEY ? "default" : "shared", msgSeq: st.msgSeq };
  });
}

// Provision the frame's Wi-Fi over BLE (SET_SETTINGS / action 2). Used to pair /
// onboard a new frame or move it to a new network. apiEnvType selects the cloud
// environment (default "0" = prod). NOT tested against hardware — beta.
async function setWifi({ ssid, passwd, apiEnvType = "0", ...selector } = {}) {
  if (!ssid) throw new Error("need a Wi-Fi SSID");
  return sendAction({ action: 2, apiEnvType, ssid, passwd: passwd || "" }, selector);
}

module.exports = {
  isAvailable,
  scan,
  status,
  sendAction,
  fetch: (opts) => sendAction(ACTIONS.fetch, opts),
  reboot: (opts) => sendAction(ACTIONS.reboot, opts),
  ghostingClean: (opts) => sendAction(ACTIONS.ghostingClean, opts),
  setWifi,
  ACTIONS,
};
