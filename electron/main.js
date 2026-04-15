const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const port = 37344
const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

function getExternalBaseDir() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null,
    process.cwd(),
    path.dirname(process.execPath)
  ].filter(Boolean);

  return candidates[0];
}

process.env.QUMO_PACKAGED = app.isPackaged ? "1" : "0";

let serverHandle;
let controllerWin = null;
let visualizerWin = null;

function getWindowIconPath() {
  return path.join(__dirname, "..", "build", "icon.ico");
}

function loadWindowStates() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveWindowStates(states) {
  try {
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify(states, null, 2), "utf8");
  } catch (err) {
    console.warn("Failed to save window state:", err);
  }
}

function isValidBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
  if (bounds.width < 200 || bounds.height < 200) return false;

  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const area = display.workArea;
    const intersects =
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y;
    return intersects;
  });
}

function getWindowState(role, fallbackBounds) {
  const states = loadWindowStates();
  const saved = states?.[role];
  if (!isValidBounds(saved)) return { ...fallbackBounds };
  return { ...fallbackBounds, ...saved };
}

function persistWindowState(role, win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const states = loadWindowStates();
  states[role] = bounds;
  saveWindowStates(states);
}

function bindWindowStatePersistence(win, role) {
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistWindowState(role, win);
    }, 150);
  };

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    persistWindowState(role, win);
  });
}

function applyWindowChrome(win, title) {
  if (!win) return;
  win.setTitle(title);
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(title);
  });
}

async function startServer() {
  const { start } = require(path.join(__dirname, "..", "server", "index.js"));
  serverHandle = await start({ port: port });
  return serverHandle.port;
}

function startTunnelWriteFile(port) {
  const exeSide = path.join(getExternalBaseDir(), "bin", "cloudflared.exe");
  const cmd = fs.existsSync(exeSide) ? exeSide : "cloudflared";
  const TUNNEL_BOOT_TIMEOUT_MS = 8000;
  const MAX_TUNNEL_RETRIES = 2;
  const MODE_FILE = path.resolve(process.cwd(), ".tunnel-mode");
  const MODE_POLL_MS = 1000;
  const MODE_TUNNEL = "tunnel";
  const MODE_LAN = "lan";

  const localUrl = `http://localhost:${port}`;
  const args = ["tunnel", "--url", localUrl, "--loglevel", "info"];

  // wsServer.js がここを見ているので、同じ場所に書く
  const tunnelFile = path.resolve(process.cwd(), ".tunnel-url");

  let current = "";
  let currentChild = null;
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
          return `http://${net.address}:${port}`;
        }
      }
    }
    return localUrl;
  }

  function writeJoinUrl(url) {
    if (!url || url === current) return;
    current = url;
    fs.writeFileSync(tunnelFile, current, "utf8");
  }

  function clearBootTimer() {
    if (!bootTimer) return;
    clearTimeout(bootTimer);
    bootTimer = null;
  }

  function stopChild() {
    if (!currentChild) return;
    try { currentChild.kill("SIGINT"); } catch {}
    currentChild = null;
  }

  function fallbackToLan() {
    clearBootTimer();
    stopChild();
    writeJoinUrl(getLanUrl());
  }

  function scheduleRetry() {
    if (desiredMode !== MODE_TUNNEL) return;
    clearBootTimer();
    stopChild();
    if (retryCount >= MAX_TUNNEL_RETRIES) {
      fallbackToLan();
      return;
    }
    retryCount += 1;
    startTunnel();
  }

  function onLine(line) {
    const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m) {
      clearBootTimer();
      retryCount = 0;
      writeJoinUrl(m[0]);
      // これで wsServer.js の監視が拾って broadcastState() します
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
    if (desiredMode !== MODE_TUNNEL || currentChild) return;
    currentChild = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    bindStream(currentChild.stdout);
    bindStream(currentChild.stderr);

    currentChild.on("error", () => {
      scheduleRetry();
    });

    currentChild.on("exit", () => {
      currentChild = null;
      if (desiredMode !== MODE_TUNNEL) {
        clearBootTimer();
        return;
      }
      if (bootTimer) {
        scheduleRetry();
        return;
      }
      scheduleRetry();
    });

    bootTimer = setTimeout(() => {
      scheduleRetry();
    }, TUNNEL_BOOT_TIMEOUT_MS);
  }

  function applyDesiredMode(mode) {
    desiredMode = mode;
    if (desiredMode === MODE_LAN) {
      fallbackToLan();
      return;
    }

    current = "";
    try { fs.unlinkSync(tunnelFile); } catch {}
    clearBootTimer();
    stopChild();
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

  startModeWatcher();

  app.on("before-quit", () => {
    if (modePollTimer) clearInterval(modePollTimer);
    clearBootTimer();
    stopChild();
  });
}


function createControllerWindow(url) {
  const bounds = getWindowState("controller", {
    width: 900,
    height: 900
  });
  const win = new BrowserWindow({
    ...bounds,
    title: "Controller[クモノス]",
    icon: getWindowIconPath(),
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win._role = "controller";
  bindWindowStatePersistence(win, "controller");
  applyWindowChrome(win, "Controller[クモノス]");
  win.loadURL(url);
  bindQuitOnClose(win);
  controllerWin = win;
  return win;
}

function createVisualizerWindow(url) {
  const displays = screen.getAllDisplays();
  const external = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) ?? displays[0];
  const bounds = getWindowState("visualizer", {
    width: 1920,
    height: 1080,
    x: external.bounds.x,
    y: external.bounds.y
  });

  const win = new BrowserWindow({
    ...bounds,
    title: "Visualizer[クモノス]",
    icon: getWindowIconPath(),
    frame: true,
    fullscreen: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win._role = "visualizer";
  bindWindowStatePersistence(win, "visualizer");
  applyWindowChrome(win, "Visualizer[クモノス]");
  bindQuitOnClose(win);
  win.setMenuBarVisibility(false);
  win.loadURL(url);
  visualizerWin = win;
  return win;
}

function bindQuitOnClose(win) {
  win.on("close", () => {
    // controller または visualizer が閉じたら全終了
    if (win._role === "controller" || win._role === "visualizer") {
      app.quit();
    }
  });
}

app.whenReady().then(async () => {
  try {
    const port = await startServer();

    // ★ packaged時だけ自動起動（devは npm run dev の tunnel を使う）
    if (app.isPackaged) {
      startTunnelWriteFile(port);
    }

    createControllerWindow(`http://localhost:${port}/controller`);
    createVisualizerWindow(`http://localhost:${port}/visualizer`);
  } catch (err) {
    console.error("Failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") app.quit();
  if (serverHandle?.stop) await serverHandle.stop();
});
