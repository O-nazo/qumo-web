// server/modRuntime.js (CommonJS)
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function createModRuntime({ app, modsDir, broadcast, getState, dispatch }) {
  const mods = new Map();

  function makeCtx(modId) {
    const handlers = new Map();

    const ctx = {
      app, // ★必須：MOD側で ctx.app.use(...) するため
      on(type, fn) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(fn);
      },
      broadcast(msg) { broadcast(msg); },
      dispatch(action) { dispatch?.(action); },
      getState() { return getState(); }
    };

    mods.set(modId, { handlers, ctx });
    return ctx;
  }

  async function loadAll() {
    const entries = fs.readdirSync(modsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const folder of entries) {
      const modJsonPath = path.join(modsDir, folder, "mod.json");
      const serverEntryPath = path.join(modsDir, folder, "server", "index.js");
      if (!fs.existsSync(modJsonPath) || !fs.existsSync(serverEntryPath)) continue;

      const modJson = JSON.parse(fs.readFileSync(modJsonPath, "utf-8"));
      const modId = String(modJson.id || "").trim();
      if (!modId) continue;

      // ★ESM MOD を動的importでロード
      const mod = await import(pathToFileURL(serverEntryPath).href);
      const register = mod?.default;

      if (typeof register !== "function") {
        console.warn(`[MOD] ${modId} has no default export`);
        continue;
      }

      const ctx = makeCtx(modId);
      register(ctx);
      console.log("[MOD] loaded:", modId);
    }
  }

  function emit(modId, type, payload) {
    const m = mods.get(modId);
    if (!m) return;
    const set = m.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error("[MOD] handler error", modId, type, e); }
    }
  }

  return { loadAll, emit };
}

module.exports = { createModRuntime };
