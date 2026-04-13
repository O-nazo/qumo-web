const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const { createWsServer } = require("./wsServer");
const { getState } = require("./stateStore");
const fs = require("fs");
const { createModRuntime } = require("./modRuntime");
const { setModRuntime } = require("./modRuntimeHub");

function getExternalBaseDir() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null,
    process.cwd(),
    path.dirname(process.execPath)
  ].filter(Boolean);

  return candidates[0];
}

function writeDiag(message, meta = null) {
  try {
    const baseDir = getExternalBaseDir();
    if (!baseDir) return;
    const logPath = path.join(baseDir, "qumo-diagnostics.log");
    const line = `[${new Date().toISOString()}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch {}
}

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
  return Array.from(new Set(ips));
}

function listMods(modsDir) {
  if (!modsDir) return [];
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter(name => !name.startsWith("_"))
    .filter(name => fs.existsSync(path.join(modsDir, name, "mod.json")));
}

function readModMeta(modId, modsDir) {
  try {
    const modJsonPath = path.join(modsDir, modId, "mod.json");
    const raw = JSON.parse(fs.readFileSync(modJsonPath, "utf8"));
    const defaults = raw?.uiDefaults && typeof raw.uiDefaults === "object" ? raw.uiDefaults : {};
    return {
      id: String(raw?.id || modId),
      name: String(raw?.name || modId),
      uiDefaults: {
        backgroundDarkTheme: !!defaults.backgroundDarkTheme,
        playerTileDarkTheme: !!defaults.playerTileDarkTheme
      }
    };
  } catch {
    return {
      id: modId,
      name: modId,
      uiDefaults: {
        backgroundDarkTheme: false,
        playerTileDarkTheme: false
      }
    };
  }
}

function pickFirstExistingDir(candidates) {
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return null;
}

function getExternalDirCandidates(name) {
  const baseDirCandidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null,
    process.cwd(),
    path.dirname(process.execPath)
  ].filter(Boolean);

  return {
    devDir: path.join(process.cwd(), name),
    exeSide: pickFirstExistingDir(baseDirCandidates.map((dir) => path.join(dir, name))),
    resourcesSide: process.resourcesPath
      ? path.join(process.resourcesPath, name)
      : null
  };
}

function getExternalSfxDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const devDir = path.join(process.cwd(), "assets", "sfx");
  const exeSide = pickFirstExistingDir([
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "assets", "sfx") : null,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "assets", "sfx") : null,
    path.join(process.cwd(), "assets", "sfx"),
    path.join(path.dirname(process.execPath), "assets", "sfx")
  ]);
  const resourcesSide = process.resourcesPath
    ? path.join(process.resourcesPath, "assets", "sfx")
    : null;

  return isPackaged
    ? pickFirstExistingDir([exeSide, resourcesSide, devDir])
    : pickFirstExistingDir([devDir]);
}

function getExternalAssetsDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const devDir = path.join(process.cwd(), "assets");
  const exeSide = pickFirstExistingDir([
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "assets") : null,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "assets") : null,
    path.join(process.cwd(), "assets"),
    path.join(path.dirname(process.execPath), "assets")
  ]);
  const resourcesSide = process.resourcesPath
    ? path.join(process.resourcesPath, "assets")
    : null;

  return isPackaged
    ? pickFirstExistingDir([exeSide, resourcesSide, devDir])
    : pickFirstExistingDir([devDir]);
}

function getExternalModsDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const { devDir, exeSide, resourcesSide } = getExternalDirCandidates("mods");

  return isPackaged
    ? pickFirstExistingDir([exeSide, resourcesSide, devDir])
    : pickFirstExistingDir([devDir]);
}

function getRuntimeModsDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const { devDir, resourcesSide, exeSide } = getExternalDirCandidates("mods");

  return isPackaged
    ? pickFirstExistingDir([resourcesSide, exeSide, devDir])
    : pickFirstExistingDir([devDir]);
}

const externalSfxDir = getExternalSfxDir();
const externalAssetsDir = getExternalAssetsDir();
const externalModsDir = getExternalModsDir();
const runtimeModsDir = getRuntimeModsDir();
console.log("[SFX] isPackaged=", process.env.QUMO_PACKAGED, "externalSfxDir=", externalSfxDir);
writeDiag("server paths", {
  isPackaged: process.env.QUMO_PACKAGED,
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
  portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE || null,
  cwd: process.cwd(),
  execPath: process.execPath,
  processExecDir: path.dirname(process.execPath),
  externalBaseDir: getExternalBaseDir(),
  externalSfxDir,
  externalAssetsDir,
  externalModsDir,
  runtimeModsDir,
  resourcesPath: process.resourcesPath || null
});

async function start({ port }) {
  const app = express();
  const publicDir = path.join(__dirname, "..", "public");

  if (externalAssetsDir) {
    app.use("/assets", express.static(externalAssetsDir));
  }

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

  if (externalModsDir) {
    app.use("/mods", express.static(externalModsDir));
    console.log("[MOD] serve:", externalModsDir);
  } else {
    console.log("[MOD] mods dir not found");
  }

  app.use(express.static(publicDir));

  const server = http.createServer(app);

  const st0 = getState();
  st0.mods = st0.mods || {};
  st0.mods.available = listMods(externalModsDir);
  st0.mods.meta = Object.fromEntries(st0.mods.available.map((modId) => [modId, readModMeta(modId, externalModsDir)]));
  if (st0.mods.active == null) st0.mods.active = null;
  st0.ui = st0.ui || {};
  st0.ui.modThemePrefs = st0.ui.modThemePrefs || {};
  for (const modId of st0.mods.available) {
    const defaults = st0.mods.meta?.[modId]?.uiDefaults || {};
    st0.ui.modThemePrefs[modId] = {
      backgroundDarkTheme: st0.ui.modThemePrefs[modId]?.backgroundDarkTheme ?? !!defaults.backgroundDarkTheme,
      playerTileDarkTheme: st0.ui.modThemePrefs[modId]?.playerTileDarkTheme ?? !!defaults.playerTileDarkTheme
    };
  }

  const ws = createWsServer(server);

  const runtime = createModRuntime({
    app,
    modsDir: runtimeModsDir,
    broadcast: ws.broadcast,
    getState,
    dispatch: null
  });

  if (runtimeModsDir) {
    await runtime.loadAll();
  }
  setModRuntime(runtime);

  await new Promise((res) => server.listen(port, res));

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
