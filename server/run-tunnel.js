// server/run-tunnel.js
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || "37344";
const LOCAL_URL = `http://localhost:${PORT}`;
const TUNNEL_BOOT_TIMEOUT_MS = 8000;
const MAX_TUNNEL_RETRIES = 2;
const MODE_FILE = path.resolve(process.cwd(), ".tunnel-mode");
const MODE_POLL_MS = 1000;
const MODE_TUNNEL = "tunnel";
const MODE_LAN = "lan";

const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const args = ["tunnel", "--url", LOCAL_URL, "--loglevel", "info"];

let current = "";
let child = null;
let bootTimer = null;
let retryCount = 0;
let modePollTimer = null;
let desiredMode = MODE_TUNNEL;

function readDesiredMode() {
  try {
    const mode = String(fs.readFileSync(MODE_FILE, "utf8") || "").trim().toLowerCase();
    return mode === MODE_LAN ? MODE_LAN : MODE_TUNNEL;
  } catch {
    return MODE_TUNNEL;
  }
}

function getLanUrl() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net?.family === "IPv4" && !net.internal) {
        return `http://${net.address}:${PORT}`;
      }
    }
  }
  return LOCAL_URL;
}

function writeJoinUrl(url, label) {
  if (!url || url === current) return;
  current = url;
  fs.writeFileSync(".tunnel-url", current, "utf8");
  process.stdout.write(`[tunnel] ${label} => ${current}\n`);
}

function clearBootTimer() {
  if (!bootTimer) return;
  clearTimeout(bootTimer);
  bootTimer = null;
}

function killChild() {
  if (!child) return;
  try { child.kill("SIGINT"); } catch {}
  child = null;
}

function fallbackToLan(reason) {
  clearBootTimer();
  killChild();
  writeJoinUrl(getLanUrl(), `LAN fallback (${reason})`);
}

function scheduleRetry(reason) {
  if (desiredMode !== MODE_TUNNEL) return;
  clearBootTimer();
  killChild();
  if (retryCount >= MAX_TUNNEL_RETRIES) {
    fallbackToLan(reason);
    return;
  }
  retryCount += 1;
  process.stdout.write(`[tunnel] retry ${retryCount}/${MAX_TUNNEL_RETRIES} (${reason})\n`);
  startTunnel();
}

function onLine(line) {
  process.stdout.write(`[tunnel] ${line}\n`);
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m) {
    clearBootTimer();
    retryCount = 0;
    writeJoinUrl(m[0], "public url");
  }
}

function bindStream(stream) {
  let buf = "";
  stream.on("data", (d) => {
    buf += d.toString("utf8");
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
}

function startTunnel() {
  if (desiredMode !== MODE_TUNNEL || child) return;
  child = spawn(exe, args, { stdio: ["inherit", "pipe", "pipe"] });
  bindStream(child.stdout);
  bindStream(child.stderr);

  child.on("error", (err) => {
    scheduleRetry(err?.code === "ENOENT" ? "cloudflared not found" : "spawn error");
  });

  child.on("exit", (code) => {
    child = null;
    const exitedDuringBoot = !!bootTimer;
    if (desiredMode !== MODE_TUNNEL) {
      clearBootTimer();
      return;
    }
    if (exitedDuringBoot) {
      scheduleRetry(`exit ${code ?? 0}`);
      return;
    }
    scheduleRetry(`exit ${code ?? 0}`);
  });

  bootTimer = setTimeout(() => {
    scheduleRetry("URL not detected");
  }, TUNNEL_BOOT_TIMEOUT_MS);
}

function applyDesiredMode(mode) {
  desiredMode = mode;
  if (desiredMode === MODE_LAN) {
    fallbackToLan("LAN mode");
    return;
  }

  current = "";
  try { fs.unlinkSync(".tunnel-url"); } catch {}
  clearBootTimer();
  killChild();
  startTunnel();
}

function startModeWatcher() {
  applyDesiredMode(readDesiredMode());
  modePollTimer = setInterval(() => {
    const nextMode = readDesiredMode();
    if (nextMode === desiredMode) return;
    applyDesiredMode(nextMode);
  }, MODE_POLL_MS);
}

process.on("SIGINT", () => {
  if (modePollTimer) clearInterval(modePollTimer);
  clearBootTimer();
  killChild();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (modePollTimer) clearInterval(modePollTimer);
  clearBootTimer();
  killChild();
  process.exit(0);
});

startModeWatcher();
