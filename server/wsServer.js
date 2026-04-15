const crypto = require("crypto");
const { C2S, S2C } = require("./protocol");
const { getState, snapshot, persistControllerPrefs, createDefaultControllerPrefs, sanitizePersistedPrefs, applyControllerPrefs } = require("./stateStore");
const { getModRuntime, setCoreApi } = require("./modRuntimeHub");
const { createBuzzLogic } = require("./buzzLogic");
const { createRuleRegistry } = require("./rules/registry");

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const TUNNEL_FILE = path.resolve(process.cwd(), ".tunnel-url");
const TUNNEL_MODE_FILE = path.resolve(process.cwd(), ".tunnel-mode");
const TUNNEL_POLL_MS = 500;
const LAN_URL_FALLBACK_DELAY_MS = 8000;
const TUNNEL_MODE_TUNNEL = "tunnel";
const TUNNEL_MODE_LAN = "lan";

let cachedTunnelUrl = null;
let tunnelPollTimer = null;
let cleanupRegistered = false;
let tunnelWatchStartedAt = 0;
const WRONG_CHAIN_DELAY_MS = 900;
const BUZZ_COLLECTION_WINDOW_MS = 20;
const RTT_SKEW_MIN_MS = 30;
const RTT_SKEW_MAX_MS = 200;
const RTT_SKEW_BUFFER_MS = 10;
const FALLBACK_SKEW_MS = 120;

function getExternalBaseDir() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR,
    process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : null,
    process.cwd(),
    path.dirname(process.execPath)
  ].filter(Boolean);

  return candidates[0];
}

function getConfigDirCandidates() {
  return {
    devDir: path.resolve(process.cwd(), "config"),
    exeSide: path.join(getExternalBaseDir(), "config"),
    resourcesSide: process.resourcesPath
      ? path.join(process.resourcesPath, "config")
      : null
  };
}

function getPreferredConfigDir() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const { devDir, exeSide } = getConfigDirCandidates();
  return isPackaged ? exeSide : devDir;
}

function getConfigLookupDirs() {
  const isPackaged = process.env.QUMO_PACKAGED === "1";
  const { devDir, exeSide, resourcesSide } = getConfigDirCandidates();
  return isPackaged
    ? [exeSide, resourcesSide, devDir]
    : [devDir];
}

function genId(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

function getAdaptiveSkewMs(bestRtt) {
  const rtt = Number(bestRtt);
  if (!Number.isFinite(rtt) || rtt < 0) return FALLBACK_SKEW_MS;
  const adaptive = rtt / 2 + RTT_SKEW_BUFFER_MS;
  return Math.max(RTT_SKEW_MIN_MS, Math.min(RTT_SKEW_MAX_MS, adaptive));
}

function emitSfx(st, key, extra = {}) {
  if (!st.sfx) st.sfx = { nonce: 0, key: null, at: null, durationSec: null, chainKey: null };
  st.sfx.nonce = Number(st.sfx.nonce ?? 0) + 1;
  st.sfx.key = key;
  st.sfx.at = Date.now();
  st.sfx.durationSec = extra.durationSec ?? null; // thinking用
  st.sfx.chainKey = extra.chainKey ?? null;       // 連続再生用
}

function emitMod(name, payload) {
  const active = String(getState()?.mods?.active || "");
  if (!active) return;
  getModRuntime()?.emit?.(active, name, payload);
}

function clearModScoreboardVisible(st) {
  if (!st) return false;
  if (st.modScoreboardVisible !== true) return false;
  st.modScoreboardVisible = false;
  return true;
}

function ensureModThemePrefs(st) {
  st.mods = st.mods || {};
  st.ui = st.ui || {};
  st.ui.modThemePrefs = st.ui.modThemePrefs || {};
  const available = Array.isArray(st.mods.available) ? st.mods.available : [];
  const meta = st.mods.meta && typeof st.mods.meta === "object" ? st.mods.meta : {};
  for (const modId of available) {
    const defaults = meta[modId]?.uiDefaults || {};
    st.ui.modThemePrefs[modId] = {
      backgroundDarkTheme: st.ui.modThemePrefs[modId]?.backgroundDarkTheme ?? !!defaults.backgroundDarkTheme,
      playerTileDarkTheme: st.ui.modThemePrefs[modId]?.playerTileDarkTheme ?? !!defaults.playerTileDarkTheme
    };
  }
}


function clampInt(n, min, max, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

const ruleRegistry = createRuleRegistry({ clampInt });

function normalizePlayerIdForSort(id) {
  const raw = String(id ?? "");
  const num = Number.parseInt(raw, 10);
  if (Number.isFinite(num) && String(num) === raw) {
    return { numeric: true, value: num, raw };
  }
  return { numeric: false, value: raw, raw };
}

function buildConnectionOrderMapForRankSort(st) {
  const players = Object.values(st.players || {}).filter((p) => p?.connected !== false);
  const sortedById = [...players].sort((a, b) => {
    const aKey = normalizePlayerIdForSort(a?.id);
    const bKey = normalizePlayerIdForSort(b?.id);
    if (aKey.numeric && bKey.numeric && aKey.value !== bKey.value) {
      return aKey.value - bKey.value;
    }
    if (aKey.numeric !== bKey.numeric) {
      return aKey.numeric ? -1 : 1;
    }
    return String(aKey.raw).localeCompare(String(bKey.raw), "ja");
  });

  const orderMap = new Map();
  sortedById.forEach((p, idx) => orderMap.set(p.id, idx));
  return orderMap;
}

function getRankGroupForSort(p) {
  const status = String(p?.status || "active");
  if (status === "qualified") return 0;
  if (status === "disqualified") return 2;
  return 1;
}

function compareRankOrderForSort(a, b, connectionOrderMap = new Map()) {
  const groupDiff = getRankGroupForSort(a) - getRankGroupForSort(b);
  if (groupDiff !== 0) return groupDiff;

  const group = getRankGroupForSort(a);
  if (group === 0) {
    const aPass = Number(a?.passRank ?? Number.MAX_SAFE_INTEGER);
    const bPass = Number(b?.passRank ?? Number.MAX_SAFE_INTEGER);
    if (aPass !== bPass) return aPass - bPass;
    const aAt = Number(a?.qualifiedAt ?? Number.MAX_SAFE_INTEGER);
    const bAt = Number(b?.qualifiedAt ?? Number.MAX_SAFE_INTEGER);
    return aAt - bAt;
  }

  if (group === 1) {
    const scoreDiff = Number(b?.score ?? 0) - Number(a?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const wrongDiff = Number(a?.wrongCount ?? 0) - Number(b?.wrongCount ?? 0);
    if (wrongDiff !== 0) return wrongDiff;
    return (connectionOrderMap.get(a?.id) ?? Number.MAX_SAFE_INTEGER) - (connectionOrderMap.get(b?.id) ?? Number.MAX_SAFE_INTEGER);
  }

  const wrongDiff = Number(a?.wrongCount ?? 0) - Number(b?.wrongCount ?? 0);
  if (wrongDiff !== 0) return wrongDiff;
  const connectionDiff = (connectionOrderMap.get(a?.id) ?? Number.MAX_SAFE_INTEGER) - (connectionOrderMap.get(b?.id) ?? Number.MAX_SAFE_INTEGER);
  if (connectionDiff !== 0) return connectionDiff;
  const dqAtDiff = Number(a?.dqAt ?? Number.MAX_SAFE_INTEGER) - Number(b?.dqAt ?? Number.MAX_SAFE_INTEGER);
  if (dqAtDiff !== 0) return dqAtDiff;
  return String(a?.name || "").localeCompare(String(b?.name || ""), "ja");
}

function updateRankSortOrderSnapshot(st) {
  st.ui = st.ui || {};
  const connectionOrderMap = buildConnectionOrderMapForRankSort(st);
  const players = Object.values(st.players || {}).filter((p) => p?.connected !== false);
  st.ui.rankSortOrder = players
    .sort((a, b) => compareRankOrderForSort(a, b, connectionOrderMap))
    .map((p) => p.id);
}

function buildSnapshotSortedPlayers(st, snapshot = []) {
  const connectionOrderMap = buildConnectionOrderMapForRankSort(st);
  const players = Object.values(st.players || {}).filter((p) => p?.connected !== false);
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return [...players].sort((a, b) => compareRankOrderForSort(a, b, connectionOrderMap));
  }

  const playersById = new Map(players.map((p) => [p.id, p]));
  const ordered = [];
  const seen = new Set();
  for (const id of snapshot) {
    const player = playersById.get(String(id || ""));
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    ordered.push(player);
  }
  for (const player of players) {
    if (seen.has(player.id)) continue;
    seen.add(player.id);
    ordered.push(player);
  }
  return ordered;
}

function updateHiddenScoreRankSortOrderSnapshot(st) {
  st.ui = st.ui || {};
  const visualizerSortMode = String(st.ui.visualizerSortMode || "manual");
  if (visualizerSortMode !== "rank") {
    st.ui.hiddenScoreRankSortOrder = [];
    return;
  }
  const baseSnapshot = Array.isArray(st.ui.rankSortOrder) ? st.ui.rankSortOrder : [];
  st.ui.hiddenScoreRankSortOrder = buildSnapshotSortedPlayers(st, baseSnapshot).map((p) => p.id);
}

function recomputeScores(st) {
  ruleRegistry.getActiveRuleDefinition(st).handlers.recomputeScores(st);
}

function recomputePlayerStatuses(st) {
  ruleRegistry.getActiveRuleDefinition(st).handlers.recomputePlayerStatuses(st);
}

function getActiveRuleDefinition(st) {
  return ruleRegistry.getActiveRuleDefinition(st);
}

function resetPlayerProgressForRule(st, player) {
  if (!player) return;
  player.correctCount = 0;
  player.wrongCount = 0;
  player.score = 0;
  player.scoreBonus = 0;
  player.manualScoreAdjust = 0;
  player.forceDisqualify = false;
  player.restCount = 0;
  player.pendingRestAdd = 0;
  player.qualifiedAt = null;
  player.dqAt = null;
  player.passRank = null;
  player.status = "active";
  player.reach = { qualify: false, dq: false };
  getActiveRuleDefinition(st).handlers.initializePlayer?.(player, st.rules || {});
}

function resetAllPlayersForRule(st) {
  for (const player of Object.values(st.players || {})) {
    resetPlayerProgressForRule(st, player);
  }
}

function queueJudgeOutcomes(st, outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  for (const entry of entries) {
    const playerId = String(entry?.playerId || "").trim();
    if (!playerId) continue;
    addPendingJudgeOutcome(st, playerId, entry);
  }
}

function buildJudgeOutcomes(st, resultType, playerId) {
  const handlers = getActiveRuleDefinition(st).handlers || {};
  if (resultType === "correct") {
    return handlers.buildCorrectPendingOutcomes?.(st, playerId) || [{ playerId, correct: 1 }];
  }
  if (resultType === "wrong") {
    return handlers.buildWrongPendingOutcomes?.(st, playerId) || [{ playerId, wrong: 1 }];
  }
  return [];
}

function buildBoardJudgeOutcomes(st, resultType, playerId) {
  const outcomes = buildJudgeOutcomes(st, resultType, playerId)
    .map((entry) => ({ ...entry }));
  const rawMode = String(st?.boardAnswer?.mode || "").trim().toLowerCase();
  const mode = rawMode === "buzz_plus_board" ? rawMode : "standard";

  if (mode !== "buzz_plus_board") return outcomes;
  if (String(st?.boardAnswer?.buzzStarterPlayerId || "") !== String(playerId || "")) return outcomes;

  for (const outcome of outcomes) {
    if (resultType === "correct") {
      outcome.scoreDelta = Number(outcome.scoreDelta ?? 0) + 2;
    } else if (resultType === "wrong") {
      outcome.scoreDelta = Number(outcome.scoreDelta ?? 0) - 2;
    }
  }

  return outcomes;
}

function isEarlyWinBuzzMode(st) {
  const mode = getBuzzMode(st);
  return mode === "early_endless" || mode === "early_single";
}

function getEarlyWinClearedOrder(st) {
  return Array.isArray(st?.judge?.clearedOrder) ? st.judge.clearedOrder.map((id) => String(id || "")).filter(Boolean) : [];
}

function getEarlyWinClearRank(st, playerId) {
  const pid = String(playerId || "").trim();
  if (!pid) return 0;
  const order = getEarlyWinClearedOrder(st);
  const idx = order.indexOf(pid);
  return idx >= 0 ? idx + 1 : 0;
}

function appendEarlyWinClear(st, playerId) {
  const pid = String(playerId || "").trim();
  if (!pid) return 0;
  if (!Array.isArray(st.judge.clearedOrder)) st.judge.clearedOrder = [];
  if (!st.judge.clearedOrder.includes(pid)) {
    st.judge.clearedOrder.push(pid);
  }
  return getEarlyWinClearRank(st, pid);
}

function removeBuzzEntryByPlayerId(st, playerId) {
  const pid = String(playerId || "").trim();
  if (!pid || !Array.isArray(st?.buzzer?.buzzOrder)) return;
  st.buzzer.buzzOrder = st.buzzer.buzzOrder.filter((entry) => String(entry?.playerId || "") !== pid);
  recomputeFirstBuzz(st);
}

function clampEarlyWinPlacePointRate(value) {
  return clampInt(value, 0, 1000000, 1);
}

function clampEarlyWinFailPoints(value) {
  return clampInt(value, -1000000, 1000000, -1);
}

function usesDerivedScoreBonus(st) {
  const profile = String(st?.rules?.ruleProfile || "standard");
  return profile === "standard" || profile === "ten_by_ten";
}

function buildEarlyWinCorrectOutcomes(st, playerId, clearRank) {
  const outcomes = buildJudgeOutcomes(st, "correct", playerId)
    .map((entry) => ({ ...entry }));
  const bonusDelta = Math.max(0, Number(clearRank || 0)) * clampEarlyWinPlacePointRate(st?.rules?.earlyWinPlacePointRate);
  if (bonusDelta <= 0) return outcomes;
  for (const outcome of outcomes) {
    if (String(outcome?.playerId || "") !== String(playerId || "")) continue;
    if (usesDerivedScoreBonus(st)) {
      outcome.bonusDelta = Number(outcome.bonusDelta ?? 0) + bonusDelta;
    } else {
      outcome.scoreDelta = Number(outcome.scoreDelta ?? 0) + bonusDelta;
    }
  }
  return outcomes;
}

function buildEarlyWinFailOutcomes(st) {
  const failPoints = clampEarlyWinFailPoints(st?.rules?.earlyWinFailPoints);
  if (failPoints === 0) return [];
  const clearedSet = new Set(getEarlyWinClearedOrder(st));
  return Object.values(st.players || {})
    .filter((player) => {
      const playerId = String(player?.id || "");
      if (!playerId) return false;
      if (clearedSet.has(playerId)) return false;
      if (player.connected === false) return false;
      if (player.modDisabled) return false;
      const status = String(player.status || "active");
      return status !== "qualified" && status !== "disqualified";
    })
    .map((player) => ({
      playerId: player.id,
      ...(usesDerivedScoreBonus(st) ? { bonusDelta: failPoints } : { scoreDelta: failPoints })
    }));
}

function transitionEarlyWinAfterJudgment(st, { playBuzzer = true } = {}) {
  const nextIdx = pickNextRespondentIndex(st);
  if (nextIdx >= 0) {
    st.judge.status = "in_progress";
    st.judge.currentIndex = nextIdx;
    st.phase = "locked";
    st.buzzer.isOpen = true;
    if (playBuzzer) {
      emitSfx(st, "buzzer");
    }
    return;
  }

  st.judge.status = "idle";
  st.judge.currentIndex = 0;
  st.phase = "open";
  st.buzzer.isOpen = true;
}

const {
  addPendingJudgeOutcome,
  applyPendingJudgeOutcome,
  canBuzzNow,
  clearPendingJudgeOutcome,
  ensureJudgePendingOutcome,
  getBuzzMode,
  getCurrentRespondent,
  hasAnyEligiblePlayer,
  pickNextRespondentIndex,
  recomputeFirstBuzz,
  resetBuzzer,
  resetJudge,
  setResult,
  settleResetState,
  shouldApplyPendingOutcomeOnReset,
  startQuestion
} = createBuzzLogic({
  recomputeScores,
  recomputePlayerStatuses
});

/* URL関連 */
function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}

function writeTunnelModeFile(lanModeEnabled) {
  const mode = lanModeEnabled ? TUNNEL_MODE_LAN : TUNNEL_MODE_TUNNEL;
  try {
    fs.writeFileSync(TUNNEL_MODE_FILE, mode, "utf8");
  } catch {}
}

function isValidJoinUrl(value) {
  const raw = String(value || "").trim();
  return /^https?:\/\//i.test(raw);
}

function readTunnelUrlIfReady() {
  try {
    const u = fs.readFileSync(TUNNEL_FILE, "utf8").trim();
    if (isValidJoinUrl(u)) return u;
  } catch {}
  return null;
}

function readTunnelUrl() {
try {
  const p = path.resolve(process.cwd(), ".tunnel-url");
  const u = fs.readFileSync(p, "utf8").trim();
  return isValidJoinUrl(u) ? u : null;
} catch {
  return null;
}
}

function getLanJoinUrl(st) {
  const candidates = Array.isArray(st?.joinUrls) ? st.joinUrls : [];
  return candidates.find((url) => /^http:\/\/(?!localhost\b)/i.test(String(url || "").trim())) || null;
}

function getPreferredJoinUrl(st) {
  if (st?.ui?.lanModeEnabled) {
    return getLanJoinUrl(st);
  }

  const tunnelUrl = cachedTunnelUrl || readTunnelUrl();
  if (isValidJoinUrl(tunnelUrl)) return tunnelUrl;

  const shouldUseLanFallback =
    tunnelWatchStartedAt > 0 &&
    (Date.now() - tunnelWatchStartedAt) >= LAN_URL_FALLBACK_DELAY_MS;
  if (!shouldUseLanFallback) return null;

  return getLanJoinUrl(st);
}

function refreshJoinQrState(st, onDone = null) {
  st.ui = st.ui || {};

  const targetUrl = getPreferredJoinUrl(st);
  st.ui.joinQrTargetUrl = targetUrl || null;

  if (!st.ui.joinQrVisible || !targetUrl) {
    st.ui.joinQrDataUrl = null;
    if (typeof onDone === "function") onDone();
    return;
  }

  QRCode.toDataURL(targetUrl, { margin: 1, width: 360 })
    .then((dataUrl) => {
      const st2 = getState();
      st2.ui = st2.ui || {};
      if (!st2.ui.joinQrVisible) {
        st2.ui.joinQrDataUrl = null;
        if (typeof onDone === "function") onDone();
        return;
      }
      st2.ui.joinQrTargetUrl = targetUrl;
      st2.ui.joinQrDataUrl = dataUrl;
      if (typeof onDone === "function") onDone();
    })
    .catch(() => {
      const st2 = getState();
      st2.ui = st2.ui || {};
      st2.ui.joinQrDataUrl = null;
      if (typeof onDone === "function") onDone();
    });
}

function ensureConfigDir() {
  fs.mkdirSync(getPreferredConfigDir(), { recursive: true });
}

function formatPresetTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function listPresetFiles() {
  ensureConfigDir();
  const names = new Set();

  for (const dir of getConfigLookupDirs()) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.json$/i.test(entry.name)) continue;
      names.add(entry.name);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, "ja")).reverse();
}

function updatePresetList(st) {
  st.configPresets = st.configPresets || {};
  st.configPresets.files = listPresetFiles();
}

function exportCurrentPresetFile(st) {
  ensureConfigDir();
  const fileName = `Rules_${formatPresetTimestamp()}.json`;
  const filePath = path.join(getPreferredConfigDir(), fileName);
  const payload = {
    savedAt: new Date().toISOString(),
    rules: sanitizePersistedPrefs({ rules: st.rules, ui: {} }).rules,
    ui: sanitizePersistedPrefs({ rules: {}, ui: st.ui }).ui
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  updatePresetList(st);
  return fileName;
}

function sanitizePresetFileName(rawName) {
  const trimmed = String(rawName || "").trim();
  const fallbackBase = `Rules_${formatPresetTimestamp()}`;
  const baseName = trimmed || fallbackBase;
  const withoutExt = baseName.replace(/\.json$/i, "");
  const sanitized = withoutExt
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return `${sanitized || fallbackBase}.json`;
}

function exportNamedPresetFile(st, rawName) {
  ensureConfigDir();
  const fileName = sanitizePresetFileName(rawName);
  const filePath = path.join(getPreferredConfigDir(), fileName);
  const payload = {
    savedAt: new Date().toISOString(),
    rules: sanitizePersistedPrefs({ rules: st.rules, ui: {} }).rules,
    ui: sanitizePersistedPrefs({ rules: {}, ui: st.ui }).ui
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  updatePresetList(st);
  return fileName;
}

function loadPresetFile(fileName) {
  ensureConfigDir();
  const safeName = path.basename(String(fileName || ""));
  if (!safeName || !safeName.endsWith(".json")) {
    throw new Error("プリセット名が不正です");
  }

  for (const dir of getConfigLookupDirs()) {
    if (!dir) continue;
    const filePath = path.join(dir, safeName);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    return sanitizePersistedPrefs(JSON.parse(raw));
  }

  throw new Error("プリセットが見つかりません");
}

function normalizePresetMatchKey(value) {
  return String(value || "")
    .trim()
    .replace(/\.json$/i, "")
    .trim()
    .toLocaleLowerCase("ja");
}

function findAutoPresetFileForMod(st, modId) {
  const id = String(modId || "").trim();
  if (!id) return null;

  const modLabel = String(st?.mods?.meta?.[id]?.name || "").trim();
  const keys = new Set(
    [normalizePresetMatchKey(id), normalizePresetMatchKey(modLabel)].filter(Boolean)
  );
  if (keys.size === 0) return null;

  for (const fileName of listPresetFiles()) {
    if (keys.has(normalizePresetMatchKey(fileName))) {
      return fileName;
    }
  }
  return null;
}

function createWsServer(httpServer) {
  const { WebSocketServer } = require("ws");
  const wss = new WebSocketServer({ server: httpServer });

  const sockets = new Set();

  // 早稲田式：問題進行はサーバーで自動化
  let autoNextTimer = null;
  let wrongAdvanceTimer = null;
  let autoResetTimer = null;
  let buzzCollectTimer = null;
  const debugBuzzTimers = new Set();

  function clearWrongAdvanceTimer() {
    if (!wrongAdvanceTimer) return;
    clearTimeout(wrongAdvanceTimer);
    wrongAdvanceTimer = null;
  }

  function clearAutoResetTimer() {
    if (!autoResetTimer) return;
    clearTimeout(autoResetTimer);
    autoResetTimer = null;
  }

  function clearBuzzCollectTimer() {
    if (!buzzCollectTimer) return;
    clearTimeout(buzzCollectTimer);
    buzzCollectTimer = null;
  }

  function clearPendingDebugBuzzes() {
    for (const timer of debugBuzzTimers) {
      clearTimeout(timer);
    }
    debugBuzzTimers.clear();
  }

  function clearPendingAutoReset() {
    clearAutoResetTimer();
  }

  function clearPendingBuzzCollection(st = null) {
    clearBuzzCollectTimer();
    clearPendingDebugBuzzes();
    if (st?.buzzer) {
      st.buzzer.collectUntil = null;
    }
  }

  function finalizeBuzzCollection(expectedSeq = null) {
    buzzCollectTimer = null;
    const st = getState();
    if (!st?.buzzer?.isOpen) {
      clearPendingBuzzCollection(st);
      return;
    }
    if (st.phase === "result" || st.judge?.status === "result" || st.judge?.status === "in_progress") {
      clearPendingBuzzCollection(st);
      return;
    }
    if (expectedSeq != null && Number(st.buzzer?.collectSeq ?? 0) !== Number(expectedSeq)) {
      return;
    }

    st.buzzer.collectUntil = null;
    const nextIdx = pickNextRespondentIndex(st);
    if (nextIdx >= 0) {
      st.phase = "locked";
      st.judge.status = "in_progress";
      st.judge.currentIndex = nextIdx;
      st.judge.lastResult = null;
      ensureBoardAnswerState(st);
      if (st.boardAnswer.enabled) {
        if (st.boardAnswer.mode === "buzz_to_board") {
          st.boardAnswer.phase = "accepting";
        } else if (st.boardAnswer.mode === "buzz_plus_board") {
          st.boardAnswer.phase = "accepting";
          st.boardAnswer.buzzStarterPlayerId = st.buzzer?.buzzOrder?.[nextIdx]?.playerId || null;
        }
      }
      emitSfx(st, "buzzer");
    }
    broadcastState();
  }

  function performAutoReset(st) {
    clearPendingAutoReset();
    st.titleScreenVisible = false;
    settleResetState(st);
    emitMod("STATE_UPDATED", { at: Date.now() });
    broadcastState();
  }

  function scheduleAutoReset(st) {
    clearPendingAutoReset();
    if (!st.rules?.autoResetEnabled) return;
    const delayMs = clampInt(st.rules?.autoResetDelayMs, 0, 10000, 1500);
    autoResetTimer = setTimeout(() => {
      autoResetTimer = null;
      const st2 = getState();
      performAutoReset(st2);
    }, delayMs);
  }

  function scheduleNextQuestion() {
    const st = getState();

    if (st.rules?.autoResetEnabled) return;

    // 追加: 自動遷移OFFなら何もしない
    if (!st.rules?.autoNextEnabled) return;

    const delayRaw = Number(st.rules?.autoNextDelayMs);
    const delayMs = Number.isFinite(delayRaw) ? Math.max(0, Math.min(10000, Math.floor(delayRaw))) : 800;

    if (autoNextTimer) {
      clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }

    autoNextTimer = setTimeout(() => {
      const st2 = getState();
      if (st2.judge?.status !== "result" || st2.phase !== "result") return;

      startQuestion(st2, { increment: true });
      syncBoardAnswerFlow(st2);
      broadcastState();
    }, delayMs);
  }

  function ensureInitialized() {
    const st = getState();
    if (!st.rules) st.rules = {};
    if (!st.players) st.players = {};
    if (!st.buzzer) st.buzzer = {};
    if (!st.judge) st.judge = {};
    if (!Array.isArray(st.judge.clearedOrder)) st.judge.clearedOrder = [];
    if (!st.sfx) st.sfx = {};
    if (st.rules.autoResetEnabled == null) st.rules.autoResetEnabled = false;
    if (st.rules.autoResetDelayMs == null) st.rules.autoResetDelayMs = 1500;
    if (st.rules.autoNextEnabled == null) st.rules.autoNextEnabled = false; // デフォ: 手動
    if (st.rules.autoNextDelayMs == null) st.rules.autoNextDelayMs = 800;   // 自動ON時の待ち
    ensureJudgePendingOutcome(st);
    if (!st.ui) st.ui = {};
    if (!st.mods) st.mods = {};
    if (st.ui.showScore == null) st.ui.showScore = true;
    if (st.ui.showCorrectCount == null) st.ui.showCorrectCount = true;
    if (st.ui.showWrongCount == null) st.ui.showWrongCount = true;
    if (st.ui.controllerSortMode == null) st.ui.controllerSortMode = "manual";
    if (st.ui.visualizerSortMode == null) st.ui.visualizerSortMode = "manual";
    if (!Array.isArray(st.ui.playerOrder)) st.ui.playerOrder = [];
    if (!Array.isArray(st.ui.rankSortOrder)) st.ui.rankSortOrder = [];
    if (st.ui.playerTileLayout == null) st.ui.playerTileLayout = "grid";
    if (st.ui.prioritizePressedPlayers == null) st.ui.prioritizePressedPlayers = false;
    if (st.ui.swapJudgeColors == null) st.ui.swapJudgeColors = false;
    if (st.ui.backgroundDarkTheme == null) st.ui.backgroundDarkTheme = false;
    if (st.ui.playerTileDarkTheme == null) st.ui.playerTileDarkTheme = false;
    if (st.ui.showVerticalScore == null) st.ui.showVerticalScore = true;
    if (st.ui.showVerticalCorrectCount == null) st.ui.showVerticalCorrectCount = true;
    if (st.ui.showVerticalWrongCount == null) st.ui.showVerticalWrongCount = true;
    if (st.ui.showVerticalRestCount == null) st.ui.showVerticalRestCount = true;
    if (st.ui.showVerticalBuzzOrder == null) st.ui.showVerticalBuzzOrder = true;
    if (st.ui.showMarks == null) st.ui.showMarks = false;
    if (st.ui.showMarkCorrect == null) st.ui.showMarkCorrect = true;
    if (st.ui.showMarkWrong == null) st.ui.showMarkWrong = true;

    if (st.ui.joinQrVisible == null) st.ui.joinQrVisible = false;
    if (st.ui.lanModeEnabled == null) st.ui.lanModeEnabled = false;
    if (st.ui.boardQuizMode == null) st.ui.boardQuizMode = "standard";
    if (st.ui.joinQrTargetUrl == null) st.ui.joinQrTargetUrl = null;
    if (st.ui.joinQrDataUrl == null) st.ui.joinQrDataUrl = null;
    if (st.titleScreenVisible == null) st.titleScreenVisible = false;
    if (st.titleScreenAutoShown == null) st.titleScreenAutoShown = false;
    if (st.modScoreboardVisible == null) st.modScoreboardVisible = false;
    if (st.scoreHiddenVisible == null) st.scoreHiddenVisible = false;
    if (st.preModUiTheme == null) st.preModUiTheme = null;
    if (!Array.isArray(st.ui.hiddenScoreRankSortOrder)) st.ui.hiddenScoreRankSortOrder = [];
    ensureModThemePrefs(st);

    if (st.questionNo == null) st.questionNo = 1;
    updatePresetList(st);
    normalizePlayerOrder(st);
    ensureBoardAnswerState(st);
    st.boardAnswer.mode = sanitizeBoardQuizMode(st.ui.boardQuizMode ?? st.boardAnswer.mode);
    st.ui.boardQuizMode = st.boardAnswer.mode;

    // 初期状態：即受付
    if (!st.phase || st.phase === "lobby") {
      startQuestion(st, { increment: false });
      syncBoardAnswerFlow(st);
    }
  }

  ensureInitialized();
  refreshJoinQrState(getState());
  writeTunnelModeFile(!!getState()?.ui?.lanModeEnabled);

   // 1) 起動時に前回の .tunnel-url を消す（これが一番効く）
  safeUnlink(TUNNEL_FILE);

  // 2) 終了時にも消す（ユーザー要望）
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    const cleanup = () => safeUnlink(TUNNEL_FILE);
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  }

  // 3) .tunnel-url ができるまでチェックし、見つかったら1回だけSTATE更新
  function startTunnelUrlWatch() {
    if (tunnelPollTimer) return;
    tunnelWatchStartedAt = Date.now();
    tunnelPollTimer = setInterval(() => {
      const st = getState();
      const u = readTunnelUrlIfReady();
      const nextUrl = isValidJoinUrl(u) ? u : getPreferredJoinUrl(st);
      if (nextUrl !== cachedTunnelUrl) {
        cachedTunnelUrl = nextUrl;
        refreshJoinQrState(st, broadcastState);
        return;
      }

      if (!u && cachedTunnelUrl == null && (Date.now() - tunnelWatchStartedAt) >= LAN_URL_FALLBACK_DELAY_MS) {
        const lanUrl = getLanJoinUrl(st);
        if (lanUrl && lanUrl !== cachedTunnelUrl) {
          cachedTunnelUrl = lanUrl;
          refreshJoinQrState(st, broadcastState);
        }
        return;
      }

      if (u && u !== cachedTunnelUrl) {
        cachedTunnelUrl = u;
        refreshJoinQrState(st, broadcastState); // ここで controller に即反映させる
      }
    }, TUNNEL_POLL_MS);
  }
  startTunnelUrlWatch();

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg) {
    const str = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(str);
    }
  }

  function broadcastToScreens(screens, msg) {
    const allowed = new Set(screens);
    const str = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState !== ws.OPEN) continue;
      if (!allowed.has(ws.meta?.screen)) continue;
      ws.send(str);
    }
  }

  function broadcastState() {
    ensureInitialized();
    const st = snapshot();
    st.publicBaseUrl = getPreferredJoinUrl(st);
    broadcast({ type: S2C.STATE, state: st });
  }

  setCoreApi({
    emitSfx: (key, extra = {}) => {
      const st = getState();       // あなたのwsServer.js冒頭にあるやつ
      emitSfx(st, key, extra);     // wsServer.js内の既存関数
      broadcastState();            // wsServer.js内の既存関数
    }
  });

  function clampRulePoints(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(-1000, Math.min(1000000, Math.trunc(x)));
  }

  function clampAttackStartPoints(n) {
    return clampInt(n, 1, 1000000, 20);
  }

  function clampAttackDelta(n) {
    return clampInt(n, 1, 1000000, 1);
  }

  function clampUpDownGain(n) {
    return clampInt(n, 1, 1000000, 1);
  }

  function clampUpDownGoal(n) {
    return clampInt(n, 1, 1000000, 7);
  }

  function clampUpDownWrongLimit(n) {
    return clampInt(n, 1, 1000000, 2);
  }

  function clampDisplayPlayerCount(n) {
    return clampInt(n, 0, 1000000, 0);
  }

  function clampEditableScore(n, fallback = 0) {
    return clampInt(n, -1000000, 1000000, fallback);
  }

  function applyRuleProfileConfigPatch(st, patch) {
    if (!patch || typeof patch !== "object") return false;
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(patch, "displayQualifyPlayerCount")) {
      st.rules.displayQualifyPlayerCount = clampDisplayPlayerCount(patch.displayQualifyPlayerCount);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "displayDisqualifiedPlayerCount")) {
      st.rules.displayDisqualifiedPlayerCount = clampDisplayPlayerCount(patch.displayDisqualifiedPlayerCount);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "attackStartPoints")) {
      st.rules.attackStartPoints = clampAttackStartPoints(patch.attackStartPoints);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "attackCorrectDamage")) {
      st.rules.attackCorrectDamage = clampAttackDelta(patch.attackCorrectDamage);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "attackWrongDamage")) {
      st.rules.attackWrongDamage = clampAttackDelta(patch.attackWrongDamage);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "upDownCorrectGain")) {
      st.rules.upDownCorrectGain = clampUpDownGain(patch.upDownCorrectGain);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "upDownQualifyScore")) {
      st.rules.upDownQualifyScore = clampUpDownGoal(patch.upDownQualifyScore);
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "upDownDqWrongCount")) {
      st.rules.upDownDqWrongCount = clampUpDownWrongLimit(patch.upDownDqWrongCount);
      changed = true;
    }

    return changed;
  }

  function sanitizeName(raw) {
    let s = String(raw ?? "").trim();
    // 長さ制限（お好みで）
    s = s.slice(0, 20);

    // 制御文字の除去（改行やタブなど）
    s = s.replace(/[\u0000-\u001F\u007F]/g, "");

    // 空ならデフォルト
    if (!s) s = "Player";
    return s;
  }

  function ensureBoardAnswerState(st) {
    st.boardAnswer = st.boardAnswer || {};
    st.boardAnswer.enabled = !!st.boardAnswer.enabled;
    st.boardAnswer.visibleOnVisualizer = !!st.boardAnswer.visibleOnVisualizer;
    st.boardAnswer.mode = sanitizeBoardQuizMode(st.boardAnswer.mode);
    st.boardAnswer.phase = sanitizeBoardPhase(st.boardAnswer.phase);
    st.boardAnswer.responses = st.boardAnswer.responses && typeof st.boardAnswer.responses === "object"
      ? st.boardAnswer.responses
      : {};
    st.boardAnswer.lastJudged = st.boardAnswer.lastJudged && typeof st.boardAnswer.lastJudged === "object"
      ? st.boardAnswer.lastJudged
      : null;
    st.boardAnswer.focusedPlayerIds = Array.isArray(st.boardAnswer.focusedPlayerIds)
      ? st.boardAnswer.focusedPlayerIds.map((id) => String(id || "")).filter(Boolean)
      : [];
    st.boardAnswer.buzzStarterPlayerId = String(st.boardAnswer.buzzStarterPlayerId || "").trim() || null;
  }

  function sanitizeBoardQuizMode(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "buzz_to_board" || value === "board_to_buzz" || value === "buzz_plus_board") {
      return value;
    }
    return "standard";
  }

  function sanitizeBoardPhase(raw) {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "accepting" || value === "buzz" || value === "review") return value;
    return "idle";
  }

  function sanitizeBoardAnswer(raw) {
    return String(raw ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim()
      .slice(0, 120);
  }

  function sanitizeBoardAnswerFlag(raw) {
    const value = String(raw || "").toLowerCase();
    return value === "correct" || value === "wrong" ? value : "";
  }

  function ensureBoardAnswerEntry(st, playerId) {
    ensureBoardAnswerState(st);
    const player = st.players?.[playerId];
    if (!player) return null;

    const existing = st.boardAnswer.responses[playerId];
    if (existing && typeof existing === "object") {
      existing.playerId = playerId;
      existing.playerName = String(player.name || "");
      existing.text = String(existing.text || "");
      existing.flag = sanitizeBoardAnswerFlag(existing.flag);
      existing.result = sanitizeBoardAnswerFlag(existing.result);
      existing.submittedAt = Number(existing.submittedAt || 0) || null;
      existing.updatedAt = Number(existing.updatedAt || 0) || null;
      existing.opened = existing.opened === true;
      return existing;
    }

    const entry = {
      playerId,
      playerName: String(player.name || ""),
      text: "",
      flag: "",
      result: "",
      submittedAt: null,
      updatedAt: null,
      opened: false
    };
    st.boardAnswer.responses[playerId] = entry;
    return entry;
  }

  function getBoardEligiblePlayerIds(st) {
    return Object.values(st.players || {})
      .filter((player) => {
        if (!player?.id) return false;
        if (player.connected === false) return false;
        if (Number(player.restCount ?? 0) > 0) return false;
        if (player.modDisabled) return false;
        const status = String(player.status || "active");
        return status !== "qualified" && status !== "disqualified";
      })
      .map((player) => String(player.id));
  }

  function resetBoardAnswerRound(st) {
    ensureBoardAnswerState(st);
    st.boardAnswer.responses = {};
    st.boardAnswer.lastJudged = null;
    st.boardAnswer.focusedPlayerIds = [];
    st.boardAnswer.buzzStarterPlayerId = null;
    st.boardAnswer.phase = st.boardAnswer.enabled
      ? (st.boardAnswer.mode === "standard" || st.boardAnswer.mode === "board_to_buzz" ? "accepting" : "idle")
      : "idle";
  }

  function syncBoardAnswerFlow(st) {
    ensureBoardAnswerState(st);
    if (!st.boardAnswer.enabled) {
      st.boardAnswer.phase = "idle";
      st.boardAnswer.focusedPlayerIds = [];
      st.boardAnswer.buzzStarterPlayerId = null;
      return;
    }

    const mode = sanitizeBoardQuizMode(st.boardAnswer.mode);
    if (mode === "standard") {
      st.boardAnswer.phase = "accepting";
      st.buzzer.isOpen = false;
      return;
    }

    if (mode === "board_to_buzz") {
      st.boardAnswer.phase =
        (st.phase === "result" || st.judge?.status === "result")
          ? "review"
          : "accepting";
      st.buzzer.isOpen = st.phase !== "result" && st.judge?.status !== "result";
      return;
    }

    if (mode === "buzz_to_board" || mode === "buzz_plus_board") {
      const hasRespondent = !!getCurrentRespondent(st);
      st.boardAnswer.phase = hasRespondent ? "accepting" : "idle";
      st.buzzer.isOpen = !hasRespondent && st.phase !== "result" && st.judge?.status !== "result";
      return;
    }
  }

  function canPlayerSubmitBoardAnswer(st, playerId) {
    ensureBoardAnswerState(st);
    if (!st.boardAnswer.enabled) return false;
    const mode = sanitizeBoardQuizMode(st.boardAnswer.mode);
    const phase = sanitizeBoardPhase(st.boardAnswer.phase);

    if (mode === "standard") return phase === "accepting";
    if (mode === "board_to_buzz") return phase === "accepting";
    if (mode === "buzz_to_board") {
      const cur = getCurrentRespondent(st);
      return phase === "accepting" && cur?.playerId === playerId;
    }
    if (mode === "buzz_plus_board") {
      return phase === "accepting";
    }
    return false;
  }

  function setBoardAnswerOpened(st, playerId, opened) {
    const entry = ensureBoardAnswerEntry(st, playerId);
    if (!entry) return false;
    entry.opened = opened === true;
    entry.updatedAt = Date.now();
    return true;
  }

  function markBoardAnswerResult(st, playerId, result, { opened = null } = {}) {
    const entry = ensureBoardAnswerEntry(st, playerId);
    if (!entry) return false;
    entry.result = sanitizeBoardAnswerFlag(result);
    entry.flag = "";
    if (opened === true || opened === false) {
      entry.opened = opened;
    }
    entry.updatedAt = Date.now();
    return true;
  }

  function setBoardAnswerFocus(st, playerIds) {
    ensureBoardAnswerState(st);
    st.boardAnswer.focusedPlayerIds = Array.from(new Set(
      (Array.isArray(playerIds) ? playerIds : [])
        .map((id) => String(id || "").trim())
        .filter((id) => !!st.players?.[id])
    ));
  }

  function findPlayerByExactName(st, name) {
    const target = String(name || "");
    if (!target) return null;

    for (const p of Object.values(st.players || {})) {
      if (String(p?.name || "") === target) return p;
    }
    return null;
  }

  function findUniqueDebugPlayerName(st, baseName = "DEBUG") {
    const base = String(sanitizeName(baseName || "DEBUG")).slice(0, 20) || "DEBUG";
    if (!findPlayerByExactName(st, base)) return base;

    let index = 1;
    while (index < 10000) {
      const suffix = ` ${index}`;
      const candidate = `${base}${suffix}`.slice(0, 20);
      if (!findPlayerByExactName(st, candidate)) return candidate;
      index += 1;
    }
    return `${base} ${Date.now()}`.slice(0, 20);
  }

  function removePlayerFromState(st, playerId) {
    const id = String(playerId || "").trim();
    if (!id || !st.players?.[id]) return false;

    delete st.players[id];

    if (Array.isArray(st.ui?.playerOrder)) {
      st.ui.playerOrder = st.ui.playerOrder.filter((entryId) => String(entryId || "") !== id);
    }
    if (Array.isArray(st.ui?.rankSortOrder)) {
      st.ui.rankSortOrder = st.ui.rankSortOrder.filter((entryId) => String(entryId || "") !== id);
    }
    if (Array.isArray(st.ui?.hiddenScoreRankSortOrder)) {
      st.ui.hiddenScoreRankSortOrder = st.ui.hiddenScoreRankSortOrder.filter((entryId) => String(entryId || "") !== id);
    }

    if (Array.isArray(st.buzzer?.buzzOrder)) {
      st.buzzer.buzzOrder = st.buzzer.buzzOrder.filter((entry) => String(entry?.playerId || "") !== id);
      recomputeFirstBuzz(st);
    }
    if (st.buzzer?.firstBuzz?.playerId === id) {
      st.buzzer.firstBuzz = null;
    }

    if (st.judge?.wrongSet && typeof st.judge.wrongSet === "object") {
      delete st.judge.wrongSet[id];
    }
    if (st.judge?.pendingOutcome && typeof st.judge.pendingOutcome === "object") {
      delete st.judge.pendingOutcome[id];
    }
    if (Array.isArray(st.judge?.clearedOrder)) {
      st.judge.clearedOrder = st.judge.clearedOrder.filter((entryId) => String(entryId || "") !== id);
    }
    if (st.judge?.lastResult?.playerId === id) {
      st.judge.lastResult = null;
    }
    if (st.judge?.status === "in_progress") {
      const nextIdx = pickNextRespondentIndex(st);
      if (nextIdx >= 0) {
        st.judge.currentIndex = nextIdx;
      } else {
        resetJudge(st);
        st.phase = st.buzzer?.isOpen ? "open" : "lobby";
      }
    }

    if (st.boardAnswer?.responses && typeof st.boardAnswer.responses === "object") {
      delete st.boardAnswer.responses[id];
    }
    if (Array.isArray(st.boardAnswer?.focusedPlayerIds)) {
      st.boardAnswer.focusedPlayerIds = st.boardAnswer.focusedPlayerIds.filter((entryId) => String(entryId || "") !== id);
    }
    if (String(st.boardAnswer?.buzzStarterPlayerId || "") === id) {
      st.boardAnswer.buzzStarterPlayerId = null;
    }

    normalizePlayerOrder(st);
    return true;
  }

  function shuffleArray(items) {
    const arr = Array.isArray(items) ? [...items] : [];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function performPlayerBuzz(st, playerId, { recvAt = Date.now(), at = recvAt } = {}) {
    const pid = String(playerId || "").trim();
    if (!pid) return false;
    ensureBoardAnswerState(st);

    if (st.phase === "result" || st.judge?.status === "result") return false;
    if (!st.buzzer.isOpen) return false;

    const buzzMode = getBuzzMode(st);
    if (buzzMode === "cultq" && st.judge?.status === "in_progress") return false;
    if (!canBuzzNow(st, pid)) return false;
    if (st.buzzer?.buzzOrder?.some((b) => b.playerId === pid)) return false;

    st.buzzer.buzzOrder.push({ playerId: pid, at, recvAt });
    st.buzzer.buzzOrder.sort((a, b) => (a.at - b.at) || (a.recvAt - b.recvAt));
    recomputeFirstBuzz(st);

    const active = String(getState()?.mods?.active || "");
    if (active) {
      const rt = getModRuntime();
      const idx = st.buzzer.buzzOrder.findIndex((b) => b.playerId === pid);
      const rank = idx >= 0 ? idx + 1 : null;

      rt?.emit?.(active, "BUZZ", {
        playerId: pid,
        rank,
        at,
        recvAt,
        phase: st.phase,
        judgeStatus: st.judge?.status ?? null
      });
    }

    const wrongSet = st.judge?.wrongSet || {};
    const existsUnwrongedPlayer = Object.values(st.players || {}).some((p) => !wrongSet[p.id]);
    const willStartResponding =
      st.judge?.status !== "in_progress" &&
      existsUnwrongedPlayer;

    if (willStartResponding) {
      if (!buzzCollectTimer) {
        st.buzzer.collectSeq = Number(st.buzzer.collectSeq ?? 0) + 1;
        st.buzzer.collectUntil = recvAt + BUZZ_COLLECTION_WINDOW_MS;
        const collectSeq = st.buzzer.collectSeq;
        buzzCollectTimer = setTimeout(() => {
          finalizeBuzzCollection(collectSeq);
        }, BUZZ_COLLECTION_WINDOW_MS);
      }

      broadcastState();
      return true;
    }

    const idx = st.buzzer.buzzOrder.findIndex((b) => b.playerId === pid);
    if (idx >= 1) {
      emitSfx(st, "push");
    }

    broadcastState();
    return true;
  }

  function normalizePlayerOrder(st, preferredIds = null) {
    st.ui = st.ui || {};

    const allIds = Object.keys(st.players || {});
    const existing = new Set(allIds);
    const base = Array.isArray(preferredIds) ? preferredIds : st.ui.playerOrder;
    const order = [];
    const seen = new Set();

    for (const id of Array.isArray(base) ? base : []) {
      const key = String(id || "");
      if (!existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }

    for (const id of allIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }

    st.ui.playerOrder = order;
    return order;
  }

  // NOTE: 以前の「先着収集ウィンドウ」方式は廃止（早稲田式は先着＝即ロック）

  wss.on("connection", (ws, req) => {
    sockets.add(ws);

    ws.meta = {
      clientId: genId(8),
      screen: null,
      playerId: null
    };

    send(ws, { type: S2C.HELLO, clientId: ws.meta.clientId });

    ws.on("message", (buf, isBinary) => {

      let msg;
      try {
        msg = JSON.parse(buf.toString("utf-8"));
      } catch {
        return send(ws, { type: S2C.ERROR, error: "Invalid JSON" });
      }

      const { type } = msg;
      const st = getState();
      st.rules = st.rules || {};
      if (st.rules.buzzMode == null) st.rules.buzzMode = "endless"; 

      // 自動化モード：常に初期化＆整合性を保つ
      ensureInitialized();

      if (type === (C2S.PING || "PING")) {
        const t0 = Number(msg.t0);
        if (!Number.isFinite(t0)) return;
        return send(ws, { type: (S2C.PONG || "PONG"), t0, t1: Date.now() });
      }

      if (type === C2S.JOIN) {
        const screen = String(msg.screen || "").trim();
        if (!screen) return send(ws, { type: S2C.ERROR, error: "JOIN requires screen" });

        ws.meta.screen = screen;

        const active = String(getState()?.mods?.active || "");
        if (active) {
          const rt = getModRuntime();
          rt?.emit?.(active, "CLIENT_CONNECTED", { screen: ws.meta?.screen || null });
        }

      if (screen === "player") {
          const rawName = String(msg.name ?? "").trim();
          if (!rawName) {
            return send(ws, { type: S2C.ERROR, error: "名前を入力してください" });
          }
          const name = String(sanitizeName(rawName)).slice(0, 20);
          const existing = findPlayerByExactName(st, name);

          if (existing?.connected) {
            return send(ws, { type: S2C.ERROR, error: "その名前は現在使用中です" });
          }

          if (existing) {
            ws.meta.playerId = existing.id;
            existing.connected = true;
            normalizePlayerOrder(st);
            send(ws, { type: S2C.SELF, playerId: existing.id });
          } else {
            const playerId = genId(6);
            ws.meta.playerId = playerId;

            st.players[playerId] = {
              id: playerId,
              name,
              connected: true
            };
            resetPlayerProgressForRule(st, st.players[playerId]);

            normalizePlayerOrder(st);
            send(ws, { type: S2C.SELF, playerId });
          }
        }

        broadcastState();
        return;
      }

      if (!ws.meta.screen) return send(ws, { type: S2C.ERROR, error: "Not joined" });

      // --- Controller操作（簡易権限） ---
      if (type === C2S.SET_REST_PENALTY) {
        if (ws.meta.screen !== "controller") return;
        const n = Number(msg.restPenalty);
        const clamped = Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 0;
        st.rules.restPenalty = clamped;
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      // 早押しルール切替
        if (type === (C2S.SET_BUZZ_MODE || "SET_BUZZ_MODE")) {
          if (ws.meta.screen !== "controller") return;

        const mode = getBuzzMode({ rules: { buzzMode: msg.buzzMode } });
        st.rules.buzzMode = mode;
        st.judge.clearedOrder = [];

        // 途中変更でも破綻しないよう、必要なら現在の回答者を再計算
        if (st.phase !== "result") {
          const nextIdx = pickNextRespondentIndex(st);
          if (nextIdx >= 0) {
            st.judge.status = "in_progress";
            st.judge.currentIndex = nextIdx;
            st.phase = "locked";
          } else {
            if (st.judge.status !== "result") {
              st.judge.status = "idle";
              st.judge.currentIndex = 0;
              st.phase = st.buzzer.isOpen ? "open" : "lobby";
            }
          }
        }
        
          persistControllerPrefs(st);
          broadcastState();
          return;
        }

        if (type === (C2S.SET_RULE_PROFILE || "SET_RULE_PROFILE")) {
          if (ws.meta.screen !== "controller") return;
          const nextProfile = ruleRegistry.sanitizeRuleProfile(msg.ruleProfile || "standard");
          const prevProfile = String(st.rules.ruleProfile || "standard");
          st.rules.ruleProfile = nextProfile;
          if (prevProfile !== nextProfile) {
            clearWrongAdvanceTimer();
            clearPendingAutoReset();
            clearPendingBuzzCollection(st);
            resetAllPlayersForRule(st);
            resetBuzzer(st);
            resetJudge(st);
            st.phase = "lobby";
            resetBoardAnswerRound(st);
          }
          recomputeScores(st);
          recomputePlayerStatuses(st);
          persistControllerPrefs(st);
          broadcastState();
          return;
        }

        if (type === (C2S.SET_RULE_PROFILE_CONFIG || "SET_RULE_PROFILE_CONFIG")) {
          if (ws.meta.screen !== "controller") return;
          if (!applyRuleProfileConfigPatch(st, msg.config || {})) return;
          recomputeScores(st);
          recomputePlayerStatuses(st);
          persistControllerPrefs(st);
          broadcastState();
          return;
        }

      if (type === C2S.BUZZER_OPEN) {
        if (ws.meta.screen !== "controller") return;
        clearWrongAdvanceTimer();
        clearPendingAutoReset();
        clearPendingBuzzCollection(st);
        st.titleScreenVisible = false;
        if (st.judge?.status === "result" || st.phase === "result") {
          if (shouldApplyPendingOutcomeOnReset(st)) applyPendingJudgeOutcome(st);
          else clearPendingJudgeOutcome(st);
        } else {
          clearPendingJudgeOutcome(st);
        }
        // 結果表示中なら次問へ、そうでなければ同じ問を受付再開
        updateRankSortOrderSnapshot(st);
        startQuestion(st, { increment: (st.judge?.status === "result" || st.phase === "result") });
        syncBoardAnswerFlow(st);
        emitMod("STATE_UPDATED", { at: Date.now() });
        broadcastState();
        return;
      }

      if (type === C2S.BUZZER_RESET) {
        if (ws.meta.screen !== "controller") return;
        clearWrongAdvanceTimer();
        clearPendingAutoReset();
        clearPendingBuzzCollection(st);
        st.titleScreenVisible = false;
        settleResetState(st);
        resetBoardAnswerRound(st);
        emitMod("STATE_UPDATED", { at: Date.now() });
        broadcastState();
        return;
      }

      if (type === C2S.NEXT_QUESTION) {
        if (ws.meta.screen !== "controller") return;
        clearWrongAdvanceTimer();
        clearPendingAutoReset();
        clearPendingBuzzCollection(st);
        st.titleScreenVisible = false;

        // 追加: 自動遷移の予約があればキャンセル（手動が優先）
        if (autoNextTimer) {
          clearTimeout(autoNextTimer);
          autoNextTimer = null;
        }
        clearPendingJudgeOutcome(st);
        emitMod("STATE_UPDATED", { at: Date.now() });
        updateRankSortOrderSnapshot(st);
        startQuestion(st, { increment: false });
        syncBoardAnswerFlow(st);
        broadcastState();
        return;
      }

      if (type === "SET_TITLE_SCREEN") {
        if (ws.meta.screen !== "controller") return;
        st.titleScreenVisible = !!msg.visible;
        broadcastState();
        return;
      }

      if (type === "SET_MOD_SCOREBOARD_VISIBLE") {
        if (ws.meta.screen !== "controller") return;
        st.modScoreboardVisible = !!msg.visible && !!String(st.mods?.active || "").trim();
        broadcastState();
        return;
      }

      if (type === "SET_MOD_THEME_PREFS") {
        if (ws.meta.screen !== "controller") return;
        const modId = String(msg.modId || "").trim();
        if (!modId || !st.mods?.available?.includes(modId)) return;
        ensureModThemePrefs(st);
        st.ui.modThemePrefs[modId] = {
          backgroundDarkTheme: !!msg.backgroundDarkTheme,
          playerTileDarkTheme: !!msg.playerTileDarkTheme
        };
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === "SET_SCORE_HIDDEN") {
        if (ws.meta.screen !== "controller") return;
        const nextVisible = !!msg.visible;
        if (nextVisible) {
          updateHiddenScoreRankSortOrderSnapshot(st);
        } else {
          st.ui.hiddenScoreRankSortOrder = [];
          updateRankSortOrderSnapshot(st);
        }
        st.scoreHiddenVisible = nextVisible;
        broadcastState();
        return;
      }

      if (type === "SET_RULES_OVERLAY_VISIBLE") {
        if (ws.meta.screen !== "controller") return;
        st.ui.rulesOverlayVisible = !!msg.visible;
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_QUESTION_NO || "SET_QUESTION_NO")) {
        if (ws.meta.screen !== "controller") return;

        const n = Number(msg.questionNo);
        st.questionNo = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : Number(st.questionNo ?? 1);
        broadcastState();
        return;
      }

      if (type === (C2S.CHANGE_NAME || "CHANGE_NAME")) {
        const isPlayer = ws.meta.screen === "player";
        const isController = ws.meta.screen === "controller";
        if (!isPlayer && !isController) return;

        const targetPlayerId = isController
          ? String(msg.playerId ?? "").trim()
          : ws.meta.playerId;
        if (!targetPlayerId) return;

        const p = st.players?.[targetPlayerId];
        if (!p) return;

        const rawName = String(msg.name ?? "").trim();
        if (!rawName) {
          return send(ws, { type: S2C.ERROR, error: "名前を入力してください" });
        }
        const name = String(sanitizeName(rawName)).slice(0, 20);
        const conflict = findPlayerByExactName(st, name);
        if (conflict && conflict.id !== p.id) {
          return send(ws, { type: S2C.ERROR, error: "その名前は既に使われています" });
        }

        p.name = name;
        if (st.boardAnswer?.responses?.[p.id]) {
          st.boardAnswer.responses[p.id].playerName = name;
        }
        broadcastState();
        return;
      }

      if (type === (C2S.ADD_DEBUG_PLAYER || "ADD_DEBUG_PLAYER")) {
        if (ws.meta.screen !== "controller") return;

        const playerId = `dbg_${genId(6)}`;
        st.players[playerId] = {
          id: playerId,
          name: findUniqueDebugPlayerName(st, msg.name || "DEBUG"),
          connected: true,
          isDebugVirtual: true
        };
        resetPlayerProgressForRule(st, st.players[playerId]);
        normalizePlayerOrder(st);
        updateRankSortOrderSnapshot(st);
        broadcastState();
        return;
      }

      if (type === (C2S.DEBUG_SIMULATE_BUZZ || "DEBUG_SIMULATE_BUZZ")) {
        if (ws.meta.screen !== "controller") return;

        const requestedCount = clampInt(msg.count, 1, 999, 1);
        const candidatePlayers = Object.values(st.players || {}).filter((player) =>
          player?.connected !== false &&
          player?.isDebugVirtual === true &&
          canBuzzNow(st, player.id) &&
          !st.buzzer?.buzzOrder?.some((entry) => entry.playerId === player.id)
        );

        const selectedPlayers = shuffleArray(candidatePlayers).slice(0, requestedCount);
        if (!selectedPlayers.length) return;

        clearPendingDebugBuzzes();

        let elapsedMs = 0;
        selectedPlayers.forEach((player) => {
          elapsedMs += (Math.floor(Math.random() * 1000) + 1);
          const timer = setTimeout(() => {
            debugBuzzTimers.delete(timer);
            const currentState = getState();
            performPlayerBuzz(currentState, player.id, { recvAt: Date.now() });
          }, elapsedMs);
          debugBuzzTimers.add(timer);
        });
        return;
      }

      if (type === (C2S.REMOVE_PLAYER || "REMOVE_PLAYER")) {
        if (ws.meta.screen !== "controller") return;

        const playerId = String(msg.playerId || "").trim();
        const player = st.players?.[playerId];
        if (!player?.isDebugVirtual) return;

        removePlayerFromState(st, playerId);
        updateRankSortOrderSnapshot(st);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_PLAYER_ORDER || "SET_PLAYER_ORDER")) {
        if (ws.meta.screen !== "controller") return;

        const order = Array.isArray(msg.playerOrder) ? msg.playerOrder.map((id) => String(id || "")) : [];
        normalizePlayerOrder(st, order);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_BOARD_ANSWER_MODE || "SET_BOARD_ANSWER_MODE")) {
        if (ws.meta.screen !== "controller") return;
        ensureBoardAnswerState(st);
        const nextEnabled = !!msg.enabled;
        const nextMode = sanitizeBoardQuizMode(msg.boardQuizMode ?? st.boardAnswer.mode);
        const shouldReset = st.boardAnswer.enabled !== nextEnabled || st.boardAnswer.mode !== nextMode;
        st.boardAnswer.enabled = !!msg.enabled;
        st.boardAnswer.visibleOnVisualizer = st.boardAnswer.enabled;
        st.boardAnswer.mode = nextMode;
        if (shouldReset) resetBoardAnswerRound(st);
        st.ui.boardAnswerEnabled = st.boardAnswer.enabled;
        st.ui.boardAnswerVisible = st.boardAnswer.visibleOnVisualizer;
        st.ui.boardQuizMode = st.boardAnswer.mode;
        syncBoardAnswerFlow(st);
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_BOARD_QUIZ_MODE || "SET_BOARD_QUIZ_MODE")) {
        if (ws.meta.screen !== "controller") return;
        ensureBoardAnswerState(st);
        const nextMode = sanitizeBoardQuizMode(msg.boardQuizMode);
        if (st.boardAnswer.mode !== nextMode) {
          st.boardAnswer.mode = nextMode;
          resetBoardAnswerRound(st);
        }
        st.ui.boardQuizMode = st.boardAnswer.mode;
        syncBoardAnswerFlow(st);
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_BOARD_ANSWER_VISIBILITY || "SET_BOARD_ANSWER_VISIBILITY")) {
        if (ws.meta.screen !== "controller") return;
        ensureBoardAnswerState(st);
        st.boardAnswer.visibleOnVisualizer = !!msg.visible;
        st.ui.boardAnswerVisible = st.boardAnswer.visibleOnVisualizer;
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === (C2S.CLEAR_BOARD_ANSWERS || "CLEAR_BOARD_ANSWERS")) {
        if (ws.meta.screen !== "controller") return;
        resetBoardAnswerRound(st);
        broadcastState();
        return;
      }

      if (type === (C2S.OPEN_BOARD_ANSWER || "OPEN_BOARD_ANSWER")) {
        if (ws.meta.screen !== "controller") return;
        const playerId = String(msg.playerId || "").trim();
        if (!playerId) return;
        if (!setBoardAnswerOpened(st, playerId, true)) return;
        broadcastState();
        return;
      }

      if (type === (C2S.CLOSE_BOARD_ANSWER || "CLOSE_BOARD_ANSWER")) {
        if (ws.meta.screen !== "controller") return;
        const playerId = String(msg.playerId || "").trim();
        if (!playerId) return;
        if (!setBoardAnswerOpened(st, playerId, false)) return;
        setBoardAnswerFocus(st, st.boardAnswer.focusedPlayerIds.filter((id) => id !== playerId));
        broadcastState();
        return;
      }

      if (type === (C2S.OPEN_BOARD_ANSWERS || "OPEN_BOARD_ANSWERS")) {
        if (ws.meta.screen !== "controller") return;
        const playerIds = Array.isArray(msg.playerIds) ? msg.playerIds : [];
        let changed = false;
        for (const rawPlayerId of playerIds) {
          changed = setBoardAnswerOpened(st, String(rawPlayerId || "").trim(), true) || changed;
        }
        if (!changed) return;
        broadcastState();
        return;
      }

      if (type === (C2S.CLOSE_BOARD_ANSWERS || "CLOSE_BOARD_ANSWERS")) {
        if (ws.meta.screen !== "controller") return;
        const playerIds = Array.isArray(msg.playerIds) ? msg.playerIds : [];
        let changed = false;
        for (const rawPlayerId of playerIds) {
          changed = setBoardAnswerOpened(st, String(rawPlayerId || "").trim(), false) || changed;
        }
        setBoardAnswerFocus(st, []);
        if (!changed) return;
        broadcastState();
        return;
      }

      if (type === (C2S.RESET_BOARD_ANSWER || "RESET_BOARD_ANSWER")) {
        if (ws.meta.screen !== "controller") return;
        const playerId = String(msg.playerId || "").trim();
        const entry = ensureBoardAnswerEntry(st, playerId);
        if (!entry) return;
        entry.text = "";
        entry.flag = "";
        entry.result = "";
        entry.submittedAt = null;
        entry.updatedAt = Date.now();
        entry.opened = false;
        setBoardAnswerFocus(st, st.boardAnswer.focusedPlayerIds.filter((id) => id !== playerId));
        syncBoardAnswerFlow(st);
        broadcastState();
        return;
      }

      if (type === (C2S.FOCUS_BOARD_ANSWERS || "FOCUS_BOARD_ANSWERS")) {
        if (ws.meta.screen !== "controller") return;
        setBoardAnswerFocus(st, Array.isArray(msg.playerIds) ? msg.playerIds : []);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_BOARD_ANSWER_FLAG || "SET_BOARD_ANSWER_FLAG")) {
        if (ws.meta.screen !== "controller") return;
        ensureBoardAnswerState(st);
        const playerId = String(msg.playerId || "").trim();
        const entry = ensureBoardAnswerEntry(st, playerId);
        if (!entry) return;
        entry.flag = sanitizeBoardAnswerFlag(msg.flag);
        broadcastState();
        return;
      }

      if (type === (C2S.APPLY_BOARD_ANSWER_JUDGMENTS || "APPLY_BOARD_ANSWER_JUDGMENTS")) {
        if (ws.meta.screen !== "controller") return;
        ensureBoardAnswerState(st);
        const boardQuizMode = sanitizeBoardQuizMode(st.boardAnswer.mode);

        const results = {};
        let correctApplied = 0;
        let wrongApplied = 0;

        for (const playerId of Object.keys(st.players || {})) {
          const entry = ensureBoardAnswerEntry(st, playerId);
          if (!entry) continue;
          const flag = sanitizeBoardAnswerFlag(entry.flag);
          if (!flag) continue;

          if (!st.players[playerId]) continue;

          if (boardQuizMode !== "board_to_buzz") {
            if (flag === "correct") {
              queueJudgeOutcomes(st, buildBoardJudgeOutcomes(st, "correct", playerId));
              correctApplied += 1;
            } else if (flag === "wrong") {
              queueJudgeOutcomes(st, buildBoardJudgeOutcomes(st, "wrong", playerId));
              wrongApplied += 1;
            }
          }

          entry.result = flag;
          entry.flag = "";
          entry.updatedAt = Date.now();
          results[playerId] = flag;
        }

        if (!Object.keys(results).length) return;

        if (boardQuizMode !== "board_to_buzz") {
          applyPendingJudgeOutcome(st);
        }
        st.boardAnswer.lastJudged = {
          nonce: Number(st.boardAnswer.lastJudged?.nonce ?? 0) + 1,
          at: Date.now(),
          results
        };

        const judgedValues = Object.values(results);
        const hasCorrect = correctApplied > 0 || judgedValues.includes("correct");
        const hasWrong = wrongApplied > 0 || judgedValues.includes("wrong");

        if (hasCorrect) {
          emitSfx(st, "correct");
        } else if (hasWrong) {
          emitSfx(st, "wrong");
        }

        if (boardQuizMode !== "board_to_buzz") {
          st.boardAnswer.phase = "review";
        }
        broadcastState();
        return;
      }

      if (type === (C2S.SET_AUTO_NEXT || "SET_AUTO_NEXT")) {
        if (ws.meta.screen !== "controller") return;

        st.rules.autoNextEnabled = !!msg.enabled;

        const d = Number(msg.delayMs);
        st.rules.autoNextDelayMs = Number.isFinite(d) ? Math.max(0, Math.min(10000, Math.floor(d))) : 800;

        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === (C2S.SET_AUTO_RESET || "SET_AUTO_RESET")) {
        if (ws.meta.screen !== "controller") return;

        st.rules.autoResetEnabled = !!msg.enabled;
        st.rules.autoResetDelayMs = clampInt(msg.delayMs, 0, 10000, 1500);
        if (!st.rules.autoResetEnabled) {
          clearPendingAutoReset();
        }

        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === C2S.JUDGE_CORRECT) {
        if (ws.meta.screen !== "controller") return;

        const cur = getCurrentRespondent(st);
        if (!cur) return;
        const boardQuizMode = sanitizeBoardQuizMode(st.boardAnswer?.mode);
        const buzzMode = getBuzzMode(st);

        if (st.boardAnswer?.enabled) {
          markBoardAnswerResult(st, cur.playerId, "correct");
          if (boardQuizMode === "board_to_buzz") {
            st.boardAnswer.phase = "review";
          }
        }

        if (buzzMode === "early_endless" || buzzMode === "early_single") {
          const clearRank = appendEarlyWinClear(st, cur.playerId);
          queueJudgeOutcomes(st, buildEarlyWinCorrectOutcomes(st, cur.playerId, clearRank));
          removeBuzzEntryByPlayerId(st, cur.playerId);
          emitMod("JUDGE_CORRECT", { by: ws.meta?.screen ?? "unknown", at: Date.now() });

          if (!hasAnyEligiblePlayer(st)) {
            emitSfx(st, "correct");
            setResult(st, { type: "correct", playerId: cur.playerId });
            scheduleAutoReset(st);
            broadcastState();
            scheduleNextQuestion();
            return;
          }

          transitionEarlyWinAfterJudgment(st, { playBuzzer: false });
          emitSfx(st, "correct");
          broadcastState();
          return;
        }

        queueJudgeOutcomes(st, buildJudgeOutcomes(st, "correct", cur.playerId));
        emitSfx(st, "correct");
        emitMod("JUDGE_CORRECT", { by: ws.meta?.screen ?? "unknown", at: Date.now() });
        setResult(st, { type: "correct", playerId: cur.playerId });
        scheduleAutoReset(st);
        broadcastState();
        scheduleNextQuestion();
        return;
      }

      if (type === C2S.JUDGE_WRONG) {
        if (ws.meta.screen !== "controller") return;

        const cur = getCurrentRespondent(st);
        if (!cur) return;
        const boardQuizMode = sanitizeBoardQuizMode(st.boardAnswer?.mode);
        const buzzMode = getBuzzMode(st);

        if (st.boardAnswer?.enabled) {
          markBoardAnswerResult(st, cur.playerId, "wrong");
        }

        queueJudgeOutcomes(st, buildJudgeOutcomes(st, "wrong", cur.playerId));
        if (buzzMode !== "early_endless") {
          st.judge.wrongSet[cur.playerId] = true;
        }

        emitMod("JUDGE_WRONG", { by: ws.meta?.screen ?? "unknown", at: Date.now() });

        if (buzzMode === "early_endless" || buzzMode === "early_single") {
          removeBuzzEntryByPlayerId(st, cur.playerId);

          if (buzzMode === "early_single" && !hasAnyEligiblePlayer(st)) {
            queueJudgeOutcomes(st, buildEarlyWinFailOutcomes(st));
            emitSfx(st, "wrong");
            setResult(st, { type: "skip", playerId: cur.playerId });
            scheduleAutoReset(st);
            broadcastState();
            scheduleNextQuestion();
            return;
          }

          emitSfx(st, "wrong");
          transitionEarlyWinAfterJudgment(st);
          broadcastState();
          return;
        }

        if (st.rules?.autoResetEnabled) {
          if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
            st.boardAnswer.phase = "review";
          }
          emitSfx(st, "wrong");
          scheduleAutoReset(st);
          broadcastState();
          return;
        }

        if (buzzMode === "single") {
          if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
            st.boardAnswer.phase = "review";
          }
          emitSfx(st, "wrong");
          setResult(st, { type: "skip", playerId: cur.playerId });
          scheduleAutoReset(st);
          broadcastState();
          scheduleNextQuestion();
          return;
        } 
        else if (buzzMode === "endless") {
          const nextIdx = pickNextRespondentIndex(st);

          if (nextIdx >= 0) {
            // 誤答演出中も受付は維持し、演出後に次の回答者表示へ進める
            emitSfx(st, "wrong");
            st.judge.status = "idle";
            st.phase = "open";
            st.buzzer.isOpen = true;
            broadcastState();

            clearWrongAdvanceTimer();
            wrongAdvanceTimer = setTimeout(() => {
              wrongAdvanceTimer = null;
              const st2 = getState();
              const nextIdx2 = pickNextRespondentIndex(st2);
              if (nextIdx2 < 0) {
                if (hasAnyEligiblePlayer(st2)) {
                  st2.judge.status = "idle";
                  st2.phase = "open";
                  st2.buzzer.isOpen = true;
                  broadcastState();
                }
                return;
              }
              st2.judge.status = "in_progress";
              st2.judge.currentIndex = nextIdx2;
              st2.phase = "locked";
              st2.buzzer.isOpen = true;
              emitSfx(st2, "buzzer");
              broadcastState();
            }, WRONG_CHAIN_DELAY_MS);
            return;
          }

          // まだ次の押下者がいない → 受付に戻して押下待ち（buzzOrderは保持）
          if (!hasAnyEligiblePlayer(st)) {
            if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
              st.boardAnswer.phase = "review";
            }
            emitSfx(st, "wrong");
            setResult(st, { type: "skip" });
            scheduleAutoReset(st);
            broadcastState();
            scheduleNextQuestion();
            return;
          }

          emitSfx(st, "wrong");
          st.judge.status = "idle";
          st.phase = "open";
          st.buzzer.isOpen = true;
          if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
            st.boardAnswer.phase = "buzz";
          }
          broadcastState();
          return;
        }
        else if(buzzMode === "cultq")
        {
          if (!hasAnyEligiblePlayer(st)) {
            if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
              st.boardAnswer.phase = "review";
            }
            emitSfx(st, "wrong");
            setResult(st, { type: "all_wrong" });
            scheduleAutoReset(st);
            broadcastState();
            scheduleNextQuestion();
            return;
          }

          // 受付に戻す（ただしこの問の先着取り直しのため order をクリア）
          emitSfx(st, "wrong");
          st.judge.status = "idle";
          st.phase = "open";
          st.buzzer.isOpen = true;
          st.buzzer.buzzOrder = [];
          st.buzzer.firstBuzz = null;
          if (st.boardAnswer?.enabled && boardQuizMode === "board_to_buzz") {
            st.boardAnswer.phase = "buzz";
          }
          broadcastState();
          return;
        }
        return;
      }

      if (type === C2S.JUDGE_SKIP) {
        if (ws.meta.screen !== "controller") return;
        clearPendingBuzzCollection(st);

        if (st.boardAnswer?.enabled && sanitizeBoardQuizMode(st.boardAnswer?.mode) === "board_to_buzz") {
          st.boardAnswer.phase = "review";
        }

        if (isEarlyWinBuzzMode(st)) {
          queueJudgeOutcomes(st, buildEarlyWinFailOutcomes(st));
        }

        emitMod("JUDGE_SKIP", { by: ws.meta?.screen ?? "unknown", at: Date.now() });
        emitSfx(st, "skip");

        setResult(st, { type: "skip" });
        scheduleAutoReset(st);
        broadcastState();
        scheduleNextQuestion();
        return;
      }

        if (type === C2S.PLAY_SFX) {
          if (ws.meta.screen !== "controller") return;

          const key = String(msg.key || "").trim();
          if (!key) return;

        if (key === "thinking") {
          emitSfx(st, "thinking", { durationSec: Number(st.rules?.thinkingSeconds ?? 5) });
          } else {
            emitSfx(st, key);
          }

          emitMod("STATE_UPDATED", { at: Date.now() });
          broadcastState();
          return;
        }

      if (type === C2S.SET_THINKING_SECONDS) {
        if (ws.meta.screen !== "controller") return;

        const n = Number(msg.thinkingSeconds);
        const clamped = Number.isFinite(n) ? Math.max(0, Math.min(60, Math.floor(n))) : 0;
        st.rules.thinkingSeconds = clamped;

        persistControllerPrefs(st);
        broadcastState();
        return;
      }
      if (type === "SET_COUNTS") {
        if (ws.meta.screen !== "controller") return;

        const playerId = String(msg.playerId || "");
        const p = st.players?.[playerId];
        if (!p) return;

        const c = clampInt(msg.correctCount, 0, 1000000, 0);
        const w = clampInt(msg.wrongCount, 0, 1000000, 0);
        const r = clampInt(msg.restCount, 0, 1000000, Number(p.restCount ?? 0));
        const hasScore = Number.isFinite(Number(msg.score));
        const desiredScore = hasScore ? clampEditableScore(msg.score, Number(p.score ?? 0)) : Number(p.score ?? 0);

        p.correctCount = c;
        p.wrongCount = w;
        p.restCount = r;
        p.forceDisqualify = false;
        const handlers = getActiveRuleDefinition(st).handlers || {};
        if (hasScore && typeof handlers.applyManualScoreEdit === "function") {
          handlers.applyManualScoreEdit(p, st.rules || {}, desiredScore);
        } else if (hasScore) {
          p.score = desiredScore;
        }

        recomputeScores(st);
        recomputePlayerStatuses(st);
        updateRankSortOrderSnapshot(st);
        broadcastState();
        return;
      }
      if (type === "SET_RULE_POINTS") {
        if (ws.meta.screen !== "controller") return;

        st.rules.correctPoints = clampRulePoints(msg.correctPoints);
        st.rules.wrongPoints = clampRulePoints(msg.wrongPoints);
        st.rules.earlyWinPlacePointRate = clampEarlyWinPlacePointRate(msg.earlyWinPlacePointRate);
        st.rules.earlyWinFailPoints = clampEarlyWinFailPoints(msg.earlyWinFailPoints);

        recomputeScores(st);
        recomputePlayerStatuses(st);
        persistControllerPrefs(st);
        broadcastState();
        return;
      }
      if (type === "SET_RULE_ADVANCE") {
        if (ws.meta.screen !== "controller") return;

        st.rules.qualifyEnabled = !!msg.qualifyEnabled;
        st.rules.qualifyScore = clampInt(msg.qualifyScore, -1000, 1000000, 4);

        st.rules.dqEnabled = !!msg.dqEnabled;
        st.rules.dqScore = clampInt(msg.dqScore, -1000, 1000000, -3);

        st.rules.qualifyReachEnabled = !!msg.qualifyReachEnabled;
        st.rules.dqReachEnabled = !!msg.dqReachEnabled;

        recomputePlayerStatuses(st);
        persistControllerPrefs(st);
        broadcastState();
        return;
      }
      if (type === "SET_RULE_COUNTS") {
        st.rules.qualifyCountEnabled = !!msg.qualifyCountEnabled;
        st.rules.qualifyCorrectCount = Number(msg.qualifyCorrectCount ?? 0);

        st.rules.dqWrongEnabled = !!msg.dqWrongEnabled;
        st.rules.dqWrongCount = Number(msg.dqWrongCount ?? 0);

        recomputePlayerStatuses(st);
        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === "SET_UI_PREFS") {
        st.ui = st.ui || {};
        ensureBoardAnswerState(st);

        st.ui.showScore = msg.showScore !== false;
        st.ui.showCorrectCount = msg.showCorrectCount !== false;
        st.ui.showWrongCount = msg.showWrongCount !== false;
        st.ui.controllerSortMode = String(msg.controllerSortMode || "manual") === "rank" ? "rank" : "manual";
        st.ui.visualizerSortMode = String(msg.visualizerSortMode || "manual") === "rank" ? "rank" : "manual";
        st.ui.playersViewMode = String(msg.playersViewMode || "grid") === "table" ? "table" : "grid";
        if (!Array.isArray(st.ui.playerOrder)) st.ui.playerOrder = [];
        {
          const layout = String(msg.playerTileLayout || "grid");
          st.ui.playerTileLayout = layout === "vertical" || layout === "slim" ? layout : "grid";
        }
        st.ui.prioritizePressedPlayers = !!msg.prioritizePressedPlayers;
        st.ui.swapJudgeColors = !!msg.swapJudgeColors;
        st.ui.backgroundDarkTheme = !!msg.backgroundDarkTheme;
        st.ui.playerTileDarkTheme = !!msg.playerTileDarkTheme;
        st.ui.showVerticalScore = msg.showVerticalScore !== false;
        st.ui.showVerticalCorrectCount = msg.showVerticalCorrectCount !== false;
        st.ui.showVerticalWrongCount = msg.showVerticalWrongCount !== false;
        st.ui.showVerticalRestCount = msg.showVerticalRestCount !== false;
        st.ui.showVerticalBuzzOrder = msg.showVerticalBuzzOrder !== false;
        st.ui.showMarks = !!msg.showMarks;
        st.ui.showMarkCorrect = msg.showMarkCorrect !== false;
        st.ui.showMarkWrong = msg.showMarkWrong !== false;
        st.ui.boardAnswerEnabled = st.boardAnswer.enabled;
        st.ui.boardAnswerVisible = st.boardAnswer.visibleOnVisualizer;
        st.ui.boardQuizMode = sanitizeBoardQuizMode(st.boardAnswer.mode);

        if (st.scoreHiddenVisible) {
          if (st.ui.visualizerSortMode === "rank") {
            if (!Array.isArray(st.ui.hiddenScoreRankSortOrder) || st.ui.hiddenScoreRankSortOrder.length === 0) {
              updateHiddenScoreRankSortOrderSnapshot(st);
            }
          } else {
            st.ui.hiddenScoreRankSortOrder = [];
          }
        }

        persistControllerPrefs(st);
        broadcastState();
        return;
      }

      if (type === "SET_LAN_MODE") {
        if (ws.meta.screen !== "controller") return;

        st.ui = st.ui || {};
        st.ui.lanModeEnabled = !!msg.enabled;
        writeTunnelModeFile(st.ui.lanModeEnabled);
        cachedTunnelUrl = st.ui.lanModeEnabled ? getLanJoinUrl(st) : null;
        tunnelWatchStartedAt = Date.now();
        if (!st.ui.lanModeEnabled) {
          safeUnlink(TUNNEL_FILE);
        }
        persistControllerPrefs(st);
        refreshJoinQrState(st, broadcastState);
        return;
      }

      if (type === "LIST_RULE_PRESETS") {
        if (ws.meta.screen !== "controller") return;
        updatePresetList(st);
        broadcastState();
        return;
      }

      if (type === "EXPORT_RULE_PRESET") {
        if (ws.meta.screen !== "controller") return;

        try {
          exportNamedPresetFile(st, msg.fileName);
        } catch (err) {
          send(ws, { type: S2C.ERROR, error: err?.message || "プリセット保存に失敗しました" });
        }
        broadcastState();
        return;
      }

      if (type === "APPLY_RULE_PRESET") {
        if (ws.meta.screen !== "controller") return;

        try {
          const prefs = loadPresetFile(msg.fileName);
          applyControllerPrefs(st, prefs);
          recomputeScores(st);
          recomputePlayerStatuses(st);
          persistControllerPrefs(st);
          refreshJoinQrState(st, broadcastState);
        } catch (err) {
          send(ws, { type: S2C.ERROR, error: err?.message || "プリセット適用に失敗しました" });
        }
        return;
      }

      if (type === "RESET_CONTROLLER_PREFS") {
        if (ws.meta.screen !== "controller") return;

        applyControllerPrefs(st, createDefaultControllerPrefs());
        ensureBoardAnswerState(st);
        recomputeScores(st);
        recomputePlayerStatuses(st);
        persistControllerPrefs(st);
        refreshJoinQrState(st, broadcastState);
        return;
      }

      if (type === (C2S.SET_PLAYER_ORDER || "SET_PLAYER_ORDER")) {
        if (ws.meta.screen !== "controller") return;

        normalizePlayerOrder(st, Array.isArray(msg.playerOrder) ? msg.playerOrder : []);
        broadcastState();
        return;
      }
      if (type === "AC_RESET") {
        if (ws.meta.screen !== "controller") return;
        clearWrongAdvanceTimer();
        clearPendingAutoReset();
        clearPendingBuzzCollection(st);

        for (const p of Object.values(st.players || {})) {
          resetPlayerProgressForRule(st, p);
        }
        recomputeScores(st);
        emitMod("AC_RESET", { by: ws.meta?.screen ?? "controller", at: Date.now() });
        st.titleScreenVisible = false;

        // 問題中の判定も安全側でリセット（おすすめ）
        resetBuzzer(st);
        resetJudge(st);
        st.phase = "lobby";
        resetBoardAnswerRound(st);

        recomputePlayerStatuses(st);
        broadcastState();
        return;
      }
      if (type === "SET_JOIN_QR_VISIBLE") {
        if (ws.meta.screen !== "controller") return;

        const visible = !!msg.visible;
        st.ui = st.ui || {};
        st.ui.joinQrVisible = visible;
        persistControllerPrefs(st);
        refreshJoinQrState(st, broadcastState);
        return;
      }

      // --- Player操作 ---
      if (type === (C2S.SUBMIT_BOARD_ANSWER || "SUBMIT_BOARD_ANSWER")) {
        if (ws.meta.screen !== "player" || !ws.meta.playerId) return;
        ensureBoardAnswerState(st);
        if (!st.boardAnswer.enabled) return;

        const playerId = ws.meta.playerId;
        const player = st.players?.[playerId];
        if (!player) return;
        if (!canPlayerSubmitBoardAnswer(st, playerId)) return;

        const entry = ensureBoardAnswerEntry(st, playerId);
        if (!entry) return;
        if (entry.submittedAt) return;

        const text = sanitizeBoardAnswer(msg.text);
        const hadSubmission = !!entry.submittedAt;
        entry.playerName = String(player.name || "");
        entry.text = text;
        entry.result = "";
        entry.flag = "";
        entry.submittedAt = hadSubmission ? Number(entry.submittedAt || Date.now()) : Date.now();
        entry.updatedAt = Date.now();
        entry.opened = false;
        syncBoardAnswerFlow(st);
        broadcastState();
        return;
      }

      if (type === C2S.BUZZ) {
        if (ws.meta.screen !== "player" || !ws.meta.playerId) return;
        const playerId = ws.meta.playerId;
        ensureBoardAnswerState(st);

        if (st.phase === "result" || st.judge?.status === "result") return;
        if (!st.buzzer.isOpen) return;

        const buzzMode = getBuzzMode(st);
        if (buzzMode === "cultq" && st.judge?.status === "in_progress") return;
        if (!canBuzzNow(st, playerId)) return;

        const recvAt = Date.now();
        const tPress = Number(msg.tPress ?? msg.at);
        const adaptiveSkewMs = getAdaptiveSkewMs(msg.bestRtt);
        const effectiveAt =
          Number.isFinite(tPress) && Math.abs(tPress - recvAt) <= adaptiveSkewMs
            ? tPress
            : recvAt;

        performPlayerBuzz(st, playerId, { recvAt, at: effectiveAt });
        return;
      }

      if (type === C2S.SET_ACTIVE_MOD) {
        if (ws.meta.screen !== "controller") return;
        clearWrongAdvanceTimer();
        clearPendingAutoReset();
        clearPendingBuzzCollection(st);

        const modIdRaw = String(msg.modId || "").trim();
        const prevActive = String(st.mods?.active || "").trim();

        // ★ 解除（Reset）
        if (modIdRaw === "") {
          if (prevActive) {
            getModRuntime()?.emit?.(prevActive, "MOD_DEACTIVATED", {});
          }
          st.mods.active = null;
          if (st.preModUiTheme) {
            st.ui.backgroundDarkTheme = !!st.preModUiTheme.backgroundDarkTheme;
            st.ui.playerTileDarkTheme = !!st.preModUiTheme.playerTileDarkTheme;
          }
          st.preModUiTheme = null;
          st.modScoreboardVisible = false;
          persistControllerPrefs(st);
          broadcastState();
          broadcastToScreens(["controller", "visualizer"], { type: S2C.RELOAD });
          return;
        }

        // ★ 適用（Apply）
        if (!st.mods?.available?.includes(modIdRaw)) {
          send(ws, { type: S2C.ERROR, error: "Unknown MOD" });
          return;
        }

        if (prevActive && prevActive !== modIdRaw) {
          getModRuntime()?.emit?.(prevActive, "MOD_DEACTIVATED", {});
        }

        st.mods.active = modIdRaw;
        st.modScoreboardVisible = false;
        if (!prevActive) {
          st.preModUiTheme = {
            backgroundDarkTheme: !!st.ui.backgroundDarkTheme,
            playerTileDarkTheme: !!st.ui.playerTileDarkTheme
          };
        }

        const autoPresetFile = findAutoPresetFileForMod(st, modIdRaw);
        if (autoPresetFile) {
          const prefs = loadPresetFile(autoPresetFile);
          applyControllerPrefs(st, prefs);
          recomputeScores(st);
          recomputePlayerStatuses(st);
          updatePresetList(st);
        } else if (modIdRaw === "timerace") {
          st.rules.autoResetEnabled = true;
        }

        ensureModThemePrefs(st);
        const modThemePrefs = st.ui?.modThemePrefs?.[modIdRaw];
        if (modThemePrefs) {
          st.ui.backgroundDarkTheme = !!modThemePrefs.backgroundDarkTheme;
          st.ui.playerTileDarkTheme = !!modThemePrefs.playerTileDarkTheme;
        }
        persistControllerPrefs(st);
        if (!st.titleScreenAutoShown) {
          st.titleScreenVisible = true;
          st.titleScreenAutoShown = true;
        }
        const active = String(getState()?.mods?.active || "");
        if (active) {
          getModRuntime()?.emit?.(active, "MOD_ACTIVATED", {});
        }
        broadcastState();
        broadcastToScreens(["controller", "visualizer"], { type: S2C.RELOAD });
        return;
      }

      // MOD用
      // controller(panel) -> server -> mod(server/index.js)
      if (type === "MOD_CMD") {
        const modId = String(msg?.modId || "");
        const cmd = msg?.cmd;
        if (!modId || !cmd || typeof cmd.type !== "string") return;

        const active = String(getState()?.mods?.active || "");
        if (!active || modId !== active) return; // ←ガード

        const stateChanged = clearModScoreboardVisible(st);
        const rt = getModRuntime();
        rt?.emit?.(modId, cmd.type, cmd);
        if (stateChanged) broadcastState();
        return;
      }

      // visualizer(QUMO_MOD_API.dispatch) -> server -> mod(server/index.js)
      if (type === "MOD_DISPATCH") {
        const action = msg?.action;
        if (!action || typeof action.type !== "string") return;

        const st = getState();
        const modId = String(st?.mods?.active || "");
        if (!modId) return;

        const shouldKeepScoreboard =
          action.type === "VQ_MEDIA_STATUS";
        const stateChanged = shouldKeepScoreboard ? false : clearModScoreboardVisible(st);

        if (action.type === "CORE_COMMAND") {
          const command = String(action.command || "").trim();
          if (command === "JUDGE_SKIP") {
            clearPendingBuzzCollection(st);
            if (isEarlyWinBuzzMode(st)) {
              queueJudgeOutcomes(st, buildEarlyWinFailOutcomes(st));
            }
            emitMod("JUDGE_SKIP", { by: "mod_dispatch", at: Date.now() });
            emitSfx(st, "skip");
            setResult(st, { type: "skip" });
            scheduleAutoReset(st);
            broadcastState();
            scheduleNextQuestion();
          } else if (stateChanged) {
            broadcastState();
          }
          return;
        }

        const rt = getModRuntime();
        if (rt?.emit) {
          rt.emit(modId, "DISPATCH", action);
        }
        if (stateChanged) broadcastState();
        return;
      }

      send(ws, { type: S2C.ERROR, error: `Unknown type: ${type}` });
    });

    ws.on("close", () => {
      sockets.delete(ws);

      const st = getState();

      if (ws.meta?.screen === "player" && ws.meta.playerId) {
        const playerId = ws.meta.playerId;

        if (st.players && st.players[playerId]) {
          st.players[playerId].connected = false;
        }

        if (st.buzzer?.buzzOrder?.length) {
          st.buzzer.buzzOrder = st.buzzer.buzzOrder.filter(b => b.playerId !== playerId);
        }

        // 先着確定前なら、並び替え直して first を再計算
        st.buzzer.buzzOrder.sort((a, b) => (a.at - b.at) || (a.recvAt - b.recvAt));
        recomputeFirstBuzz(st);

        if (st.judge.status === "in_progress") {
          const cur = st.buzzer.buzzOrder[st.judge.currentIndex] ?? null;
          if (!cur) {
            if (st.buzzer.buzzOrder.length > 0) {
              st.judge.currentIndex = Math.min(st.judge.currentIndex, st.buzzer.buzzOrder.length - 1);
            } else {
              resetJudge(st);
              st.phase = st.buzzer.isOpen ? "open" : "lobby";
            }
          }
        }

        broadcastState();
      }
    });
  });

  return { wss , broadcast };
}

module.exports = { createWsServer };
