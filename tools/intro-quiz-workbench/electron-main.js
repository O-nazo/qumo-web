const { app, BrowserWindow } = require("electron");
const path = require("path");

let mainWindow = null;
let serverHandle = null;

function getIconPath() {
  return path.join(__dirname, "..", "..", "build", "icon.ico");
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    title: "Intro Quiz Workbench",
    icon: getIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdown() {
  if (serverHandle?.server) {
    await new Promise((resolve) => {
      serverHandle.server.close(() => resolve());
    });
    serverHandle = null;
  }
}

app.on("window-all-closed", async () => {
  await shutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await shutdown();
});

app.whenReady().then(async () => {
  try {
    const { startServer } = require("./server.js");
    serverHandle = await startServer({ port: 0 });
    createWindow(serverHandle.port);
  } catch (error) {
    console.error("Failed to start Intro Quiz Workbench:", error);
    app.quit();
  }
});
