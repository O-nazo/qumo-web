const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const { createWsServer } = require("./wsServer");
const { getState } = require("./stateStore");
const fs = require("fs");

function getLocalIPv4s() {
  const nets = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  // 重複排除
  return Array.from(new Set(ips));
}

function listMods() {
  const modsDir = path.join(process.cwd(), "mods");
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter(name => !name.startsWith("_"))
    .filter(name => fs.existsSync(path.join(modsDir, name, "mod.json")));
}

function pickFirstExistingDir(candidates) {
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return null;
}

function getExternalSfxDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";

  const devDir = path.join(process.cwd(), "assets", "sfx");

  // packaged時の候補：
  // 1) exeの隣 (portable運用向け)
  const exeSide = path.join(path.dirname(process.execPath), "assets", "sfx");
  // 2) resources配下 (extraResourcesで同梱される場所)
  const resourcesSide = process.resourcesPath
    ? path.join(process.resourcesPath, "assets", "sfx")
    : null;

  const chosen = isPackaged
    ? pickFirstExistingDir([exeSide, resourcesSide, devDir])
    : pickFirstExistingDir([devDir]);

  return chosen; // null の場合もある
}

const externalSfxDir = getExternalSfxDir();
console.log("[SFX] isPackaged=", process.env.QUMO_PACKAGED, "externalSfxDir=", externalSfxDir);

async function start({ port }) {
  const app = express();
  const publicDir = path.join(__dirname, "..", "public");

  if (externalSfxDir) {
    app.use("/assets/sfx", express.static(externalSfxDir));
  }

  app.get(["/", "/player", "/player/"], (req, res) => {
    res.sendFile(path.join(publicDir, "player", "player.html"));
  });

  app.get(["/visualizer", "/visualizer/"], (req, res) => {
    res.sendFile(path.join(publicDir, "visualizer", "visualizer.html"));
  });

  app.get(["/controller", "/controller/"], (req, res) => {
    res.sendFile(path.join(publicDir, "controller", "controller.html"));
  });

  const modsDir = path.join(process.cwd(), "mods");
    if (fs.existsSync(modsDir)) {
      app.use("/mods", express.static(modsDir));
      console.log("[MOD] serve:", modsDir);
    } else {
      console.log("[MOD] mods dir not found:", modsDir);
    }

  app.use(express.static(publicDir));

  const server = http.createServer(app);

  const st0 = getState();
  st0.mods = st0.mods || {};
  st0.mods.available = listMods();
  if (st0.mods.active == null) st0.mods.active = null;

  createWsServer(server);

  await new Promise((res) => server.listen(port, res));

  // 参加URL候補を state に入れる
  const st = getState();
  const ips = getLocalIPv4s();
  st.joinUrls = [
    `http://localhost:${port}`,
    ...ips.map(ip => `http://${ip}:${port}`)
  ];

  return {
    port,
    stop: () => new Promise((res) => server.close(res))
  };
}

module.exports = { start };
