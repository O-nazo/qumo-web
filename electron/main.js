const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const port = 37344

process.env.QUMO_PACKAGED = app.isPackaged ? "1" : "0";

let serverHandle;
let controllerWin = null;
let visualizerWin = null;

async function startServer() {
  const { start } = require(path.join(__dirname, "..", "server", "index.js"));
  serverHandle = await start({ port: port });
  return serverHandle.port;
}

function startTunnelWriteFile(port) {
  const exeSide = path.join(path.dirname(process.execPath), "bin", "cloudflared.exe");
  const cmd = fs.existsSync(exeSide) ? exeSide : "cloudflared";

  const localUrl = `http://localhost:${port}`;
  const args = ["tunnel", "--url", localUrl, "--loglevel", "info"];

  // wsServer.js がここを見ているので、同じ場所に書く
  const tunnelFile = path.resolve(process.cwd(), ".tunnel-url");

  let current = "";

  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  function onLine(line) {
    const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && m[0] !== current) {
      current = m[0];
      fs.writeFileSync(tunnelFile, current, "utf8");
      // これで wsServer.js の監視が拾って broadcastState() します
    }
  }

  for (const s of [p.stdout, p.stderr]) {
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    });
  }

  app.on("before-quit", () => {
    try { p.kill("SIGINT"); } catch {}
  });
}


function createControllerWindow(url) {
  const win = new BrowserWindow({
    width: 900,
    height: 900,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win._role = "controller";
  win.loadURL(url);
  bindQuitOnClose(win);
  controllerWin = win;
  return win;
}

function createVisualizerWindow(url) {
  const displays = screen.getAllDisplays();
  const external = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0) ?? displays[0];

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: true,
    fullscreen: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  win._role = "visualizer";
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
