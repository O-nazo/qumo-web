import { createClient } from "/common/common.js";
import { playSfxOnce, playSfxSequence, stopAllSfx, toggleThinking, warmupSfx } from "/common/sfx.js";
import { buildRuleOverlayLines, formatSignedPoints } from "/common/ruleCatalog.js";

const client = createClient({ screen: "visualizer" });
const joinQrOverlay = document.querySelector("#joinQrOverlay");
const joinQrImg = document.querySelector("#joinQrImg");
const joinQrText = document.querySelector("#joinQrText");
const joinQrHint = document.querySelector("#joinQrHint");
const rulesOverlay = document.querySelector("#rulesOverlay");
const rulesOverlayBody = document.querySelector("#rulesOverlayBody");
const overlayFadeTimers = new WeakMap();

let lastState = null;

// 着差の有効桁数
const gapDigits = 3

// ここが重要：onStateの外で保持する
let lastSfxNonce = 0;

warmupSfx();

// --- MOD overlay loader (MVP) ---
// --- MOD main loader (shell mode) ---

// --- MOD API bridge ---
if (window.QUMO_MOD_API) {
  window.QUMO_MOD_API.dispatch = (action) => {
    // MOD → サーバーへ投げる
    client.send({
      type: "MOD_DISPATCH",
      action
    });
  };
}

let currentMainModId = null;
let mainFrame = null;
const latestModEvents = new Map();
const MOD_OVERLAY_WIDTH = 252;
const MOD_OVERLAY_GUTTER = 28;
const GRID_BASE_WRAP_COUNT = 3;

function loadMain(modId, options = {}) {
  const id = String(modId || "").trim();
  const force = !!options.force;
  if (!id) return;

  if (!force && currentMainModId === id) return;
  currentMainModId = id;

  const root = document.getElementById("mod-main-root");
  if (!root) {
    console.warn("[MOD] #mod-main-root not found");
    return;
  }

  root.innerHTML = "";

  const iframe = document.createElement("iframe");
  const bust = force ? `?v=${Date.now()}` : "";
  iframe.src = `/mods/${encodeURIComponent(id)}/visualizer/main.html${bust}`;
  iframe.className = "modMainFrame";
  iframe.setAttribute("title", `MOD main: ${id}`);
  iframe.addEventListener("load", () => {
    syncEmbeddedModLayout();
    iframe.contentWindow?.postMessage({ type: "MOD_INIT", modId: id }, "*");
    if (lastState) {
      iframe.contentWindow?.postMessage({ type: "MOD_STATE", state: lastState }, "*");
    }
    const latestEvent = latestModEvents.get(id);
    if (latestEvent) {
      iframe.contentWindow?.postMessage(
        { type: "MOD_EVENT", modId: id, event: latestEvent },
        "*"
      );
    }
    if (id === "visual_quiz") {
      client.send({
        type: "MOD_CMD",
        modId: id,
        cmd: { type: "VQ_SYNC_STATE" }
      });
    } else if (id === "intro_quiz") {
      client.send({
        type: "MOD_CMD",
        modId: id,
        cmd: { type: "IQ_SYNC_STATE" }
      });
    }
  });

  // main側で操作したいので pointer events は ON
  iframe.style.pointerEvents = "auto";

  root.appendChild(iframe);
  mainFrame = iframe;
}

function syncEmbeddedModLayout() {
  if (!mainFrame) return;
  try {
    const root = mainFrame.contentDocument?.documentElement;
    if (!root) return;
    root.style.setProperty("--qumo-mod-overlay-width", `${MOD_OVERLAY_WIDTH}px`);
    root.style.setProperty("--qumo-mod-overlay-gutter", `${MOD_OVERLAY_GUTTER}px`);
    root.classList.add("qumo-mod-with-player-overlay");
  } catch (e) {
    console.warn("[MOD] failed to sync embedded layout", e);
  }
}

client.onMessage?.((msg) => {
  if (msg?.type === "RELOAD") {
    console.log("[visualizer] soft reload by MOD change");
    const activeModId = String(lastState?.mods?.active || currentMainModId || "").trim();
    if (activeModId) {
      loadMain(activeModId, { force: true });
      syncEmbeddedModLayout();
      if (mainFrame?.contentWindow && lastState) {
        mainFrame.contentWindow.postMessage({ type: "MOD_STATE", state: lastState }, "*");
      }
      return;
    }
    location.reload();
    return;
  }

  // 汎用：MOD_EVENT を受け取ったら
  if (msg?.type === "MOD_EVENT") {
    if (msg.modId) {
      latestModEvents.set(String(msg.modId), msg.event || null);
    }
    const activeId = lastState?.mods?.active || null;
    console.log("[MOD_EVENT]", { activeId, msgModId: msg.modId, hasMain: !!mainFrame });
    // 1) MOD API（親側）へ流す
    if (window.QUMO_MOD_API) {
      window.QUMO_MOD_API.emitEvent(msg);
    }

    // 2) 表示中のMOD iframeへ中継（表示中MODだけ）
    if (activeId && msg.modId === activeId) {
      mainFrame?.contentWindow?.postMessage(
        { type: "MOD_EVENT", modId: msg.modId, event: msg.event },
        "*"
      );
      console.log("[MOD] forwarded MOD_EVENT to main", msg.event?.type);
    }
    return;
  }
});

const hudRoot = document.querySelector("#hud-root");

let hudMode = "full"; // "full" | "overlay" | "compact" | "pressedOnly"

function applyHudClasses(modActive) {
  document.body.classList.toggle("modView", !!modActive);

  if (hudRoot) {
    hudRoot.classList.toggle("overlay", hudMode === "overlay");
    hudRoot.classList.toggle("compact", hudMode === "compact");
    hudRoot.classList.toggle("pressedOnly", hudMode === "pressedOnly");
  }
}

function getCurrentRespondent(st) {
  if (st.judge?.status !== "in_progress") return null;
  return st.buzzer?.buzzOrder?.[st.judge.currentIndex] ?? null;
}

function buildBuzzInfo(st) {
  const buzzOrder = st.buzzer?.buzzOrder || [];
  const orderMap = new Map(); // playerId -> { order, at }
  buzzOrder.forEach((b, idx) => {
    orderMap.set(b.playerId, { order: idx + 1, at: b.at });
  });
  const firstAt = st.buzzer?.firstBuzz?.at ?? null;
  return { orderMap, firstAt };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ordinalShortEn(n) {
  const x = n % 100;
  if (x >= 11 && x <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatGapSeconds(ms) {
  if (!Number.isFinite(ms) || ms >= 10000) return "-";
  return `+${(ms / 1000).toFixed(gapDigits)}s`;
}

function formatBuzzOrder(order, gapText) {
  if (!order) return "";
  const ord = ordinalShortEn(order);
  if (order === 1 || !gapText || gapText === "-") return ord;
  return `${ord} ${gapText}`;
}

function formatVerticalBuzzOrder(order, gapText) {
  if (!order) return "";
  const ord = ordinalShortEn(order);
  if (order === 1 || !gapText || gapText === "-") {
    return `<span class="verticalBuzzRank">${ord}</span><span class="verticalBuzzGap is-empty">&nbsp;</span>`;
  }
  return `<span class="verticalBuzzRank">${ord}</span><span class="verticalBuzzGap">${escapeHtml(gapText)}</span>`;
}

function getRankGroup(p) {
  const status = String(p?.status || "active");
  if (status === "qualified") return 0;
  if (status === "disqualified") return 2;
  return 1;
}

function compareRankOrder(a, b, connectionOrderMap = new Map()) {
  const groupDiff = getRankGroup(a) - getRankGroup(b);
  if (groupDiff !== 0) return groupDiff;

  const group = getRankGroup(a);
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

function isSameRankBucket(a, b) {
  const groupA = getRankGroup(a);
  const groupB = getRankGroup(b);
  if (groupA !== groupB) return false;

  if (groupA === 0) return Number(a?.passRank ?? 0) === Number(b?.passRank ?? 0);
  if (groupA === 1) {
    return Number(a?.score ?? 0) === Number(b?.score ?? 0) &&
      Number(a?.wrongCount ?? 0) === Number(b?.wrongCount ?? 0);
  }
  return Number(a?.wrongCount ?? 0) === Number(b?.wrongCount ?? 0);
}

function buildRankMap(players, connectionOrderMap) {
  const sorted = [...players].sort((a, b) => compareRankOrder(a, b, connectionOrderMap));
  const rankMap = new Map();
  let lastPlayer = null;
  let currentRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i];
    if (!lastPlayer || !isSameRankBucket(lastPlayer, player)) {
      currentRank = i + 1;
    }
    rankMap.set(player.id, currentRank);
    lastPlayer = player;
  }

  return rankMap;
}

function renderRankBadge(rank, className) {
  if (rank == null || rank === "" || !Number.isFinite(Number(rank))) {
    return `<span class="${className} rankBadge is-hidden"><span class="rankBadgeText">?th</span></span>`;
  }
  const text = ordinalShortEn(rank);
  if (rank === 1) {
    return `<span class="${className} rankBadge is-first"><span class="rankBadgeCrown"><i class="fa-solid fa-crown" aria-hidden="true"></i></span><span class="rankBadgeText">${text}</span></span>`;
  }
  return `<span class="${className} rankBadge"><span class="rankBadgeText">${text}</span></span>`;
}

function setOverlayVisibility(element, visible) {
  if (!element) return;

  const existingTimer = overlayFadeTimers.get(element);
  if (existingTimer) {
    clearTimeout(existingTimer);
    overlayFadeTimers.delete(element);
  }

  if (visible) {
    element.hidden = false;
    element.classList.remove("is-visible", "is-hiding");
    void element.offsetWidth;
    requestAnimationFrame(() => {
      element.classList.add("is-visible");
    });
    return;
  }

  if (element.hidden) return;
  element.classList.remove("is-visible");
  element.classList.add("is-hiding");
  const timer = setTimeout(() => {
    element.hidden = true;
    element.classList.remove("is-hiding");
    overlayFadeTimers.delete(element);
  }, 260);
  overlayFadeTimers.set(element, timer);
}

function setOverlayVisibilityImmediate(element, visible) {
  if (!element) return;

  const existingTimer = overlayFadeTimers.get(element);
  if (existingTimer) {
    clearTimeout(existingTimer);
    overlayFadeTimers.delete(element);
  }

  element.classList.remove("is-visible", "is-hiding");
  element.hidden = !visible;
}

function renderJoinQr(st) {
  const on = !!st.ui?.joinQrVisible;

  if (!on) {
    setOverlayVisibility(joinQrOverlay, false);
    return;
  }

  setOverlayVisibility(joinQrOverlay, true);

  const url =
    st.ui?.joinQrTargetUrl ||
    (st.publicBaseUrl ? `${st.publicBaseUrl}/player/player.html` : "");

  joinQrText.textContent = url || "";
  const dataUrl = st.ui?.joinQrDataUrl;

  if (!url) {
    joinQrHint.textContent = "トンネルURL取得中…";
    joinQrImg.removeAttribute("src");
    return;
  }

  if (!dataUrl) {
    joinQrHint.textContent = "QRコード生成中…";
    joinQrImg.removeAttribute("src");
    return;
  }

  joinQrHint.textContent = "";
  joinQrImg.src = dataUrl;
}

function renderRulesOverlay(st) {
  const visible = st?.ui?.rulesOverlayVisible === true;
  if (!rulesOverlay || !rulesOverlayBody) return;
  setOverlayVisibility(rulesOverlay, visible);
  if (!visible) return;

  const lines = buildRuleOverlayLines(st);
  rulesOverlayBody.innerHTML = lines
    .map((line) => {
      const paragraphClass = line.paragraphStart ? " rulesOverlayLine-paragraphStart" : "";
      if (line.kind === "bullet") {
        return `<div class="rulesOverlayLine rulesOverlayLine-bullet${paragraphClass}"><span class="rulesOverlayBullet" aria-hidden="true"></span><span class="rulesOverlayText">${escapeHtml(line.text)}</span></div>`;
      }
      if (line.kind === "note") {
        return `<div class="rulesOverlayLine rulesOverlayLine-note${paragraphClass}">${escapeHtml(line.text)}</div>`;
      }
      if (line.kind === "scoreRule") {
        const wrongPoints = Number(line.wrongPoints ?? 0);
        const restPenalty = Number(line.restPenalty ?? 0);
        const rows = [];

        if (line.showCorrectLine !== false) {
          rows.push([
            '<span class="rulesTerm rulesTerm-correct">正解</span>',
            `<span class="rulesValue rulesValue-correct">${escapeHtml(formatSignedPoints(line.correctPoints))}P</span>`
          ]);
        }

        const wrongLine = ['<span class="rulesTerm rulesTerm-wrong">誤答</span>'];

        if (wrongPoints !== 0) {
          wrongLine.push(`<span class="rulesValue rulesValue-wrong">${escapeHtml(formatSignedPoints(wrongPoints))}P</span>`);
        }
        if (restPenalty >= 1) {
          if (wrongPoints !== 0) {
            wrongLine.push('<span class="rulesJoin">+</span>');
          }
          wrongLine.push(`<span class="rulesValue rulesValue-rest">${escapeHtml(String(restPenalty))}回休み</span>`);
        }

        if (line.showWrongLine !== false) {
          rows.push(wrongLine);
        }

        if (!rows.length) return "";

        return `<div class="rulesOverlayLine rulesOverlayLine-bullet${paragraphClass}"><span class="rulesOverlayBullet" aria-hidden="true"></span><span class="rulesOverlayText rulesOverlayText-score">${rows.map((row) => `<span class="rulesScoreRow">${row.join(" ")}</span>`).join("")}</span></div>`;
      }
      if (line.kind === "countTargets") {
        const items = Array.isArray(line.items) ? line.items : [];
        const html = items.map((item) => {
          const isCorrect = String(item).includes("○");
          const className = isCorrect ? "rulesCountTarget rulesCountTarget-correct" : "rulesCountTarget rulesCountTarget-wrong";
          return `<span class="${className}">${escapeHtml(item)}</span>`;
        }).join('<span class="rulesCountTargetSpacer"></span>');
        return `<div class="rulesOverlayLine rulesOverlayLine-bullet rulesOverlayLine-countTargets${paragraphClass}"><span class="rulesOverlayBullet" aria-hidden="true"></span><span class="rulesOverlayText">${html}</span></div>`;
      }
      if (line.kind === "targets") {
        const parts = [];
        if (line.qualifyEnabled) {
          parts.push(`<span class="rulesTargetRow"><span class="rulesTargetText rulesTargetText-correct">${escapeHtml(String(line.qualifyScore))}Pで勝ち抜け</span></span>`);
        }
        if (line.dqEnabled) {
          parts.push(`<span class="rulesTargetRow"><span class="rulesTargetText rulesTargetText-wrong">${escapeHtml(String(line.dqScore))}Pで失格</span></span>`);
        }
        return `<div class="rulesOverlayLine rulesOverlayLine-bullet${paragraphClass}"><span class="rulesOverlayBullet" aria-hidden="true"></span><span class="rulesOverlayText rulesOverlayText-targets">${parts.join("")}</span></div>`;
      }
      return `<div class="rulesOverlayLine${paragraphClass}">${escapeHtml(line.text || "")}</div>`;
    })
    .join("");
}

function renderBoardFocusOverlay(st) {
  const overlay = document.querySelector("#boardFocusOverlay");
  const body = document.querySelector("#boardFocusBody");
  if (!overlay || !body) return;

  const focusedIds = Array.isArray(st?.boardAnswer?.focusedPlayerIds) ? st.boardAnswer.focusedPlayerIds : [];
  const cards = focusedIds
    .map((playerId) => {
      const player = st?.players?.[playerId];
      const entry = st?.boardAnswer?.responses?.[playerId];
      if (!player) return "";
      const result = String(entry?.result || "");
      const opened = entry?.opened === true;
      const text = opened ? String(entry?.text || "") : "";
      const resultClass = result === "correct" ? " is-correct" : result === "wrong" ? " is-wrong" : "";
      return `
        <div class="boardFocusCard${resultClass}">
          <div class="boardFocusTextWrap">
            <div class="boardFocusText${opened && text ? "" : " is-hidden"}">${text ? escapeHtml(text) : "&nbsp;"}</div>
          </div>
          <div class="boardFocusName">${escapeHtml(String(player.name || playerId))}</div>
        </div>
      `;
    })
    .filter(Boolean);

  body.innerHTML = cards.join("");
  setOverlayVisibilityImmediate(overlay, cards.length > 0);
}

function getOrderedConnectedPlayers(st) {
  const playersById = st.players || {};
  const order = Array.isArray(st.ui?.playerOrder) ? st.ui.playerOrder : [];
  const connectedIds = Object.keys(playersById).filter((id) => playersById[id]?.connected !== false);
  const connectedSet = new Set(connectedIds);
  const result = [];
  const seen = new Set();

  for (const id of order) {
    const key = String(id || "");
    if (!connectedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(playersById[key]);
  }

  for (const id of connectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(playersById[id]);
  }

  return result;
}

function normalizePlayerIdForSort(id) {
  const raw = String(id ?? "");
  const num = Number.parseInt(raw, 10);
  if (Number.isFinite(num) && String(num) === raw) {
    return { numeric: true, value: num, raw };
  }
  return { numeric: false, value: raw, raw };
}

function buildConnectionOrderMap(players) {
  const orderMap = new Map();
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

  sortedById.forEach((p, idx) => {
    orderMap.set(p.id, idx);
  });
  return orderMap;
}

function getDisplayBuzzEntries(st) {
  const rawMode = String(st?.rules?.buzzMode ?? "").toLowerCase();
  const isEarlyMode = rawMode === "early_endless" || rawMode === "early_single" || rawMode === "survival_endless" || rawMode === "survival_single" || rawMode === "hayanuke_endless" || rawMode === "hayanuke_single";
  const buzzOrder = Array.isArray(st?.buzzer?.buzzOrder) ? st.buzzer.buzzOrder : [];
  if (!isEarlyMode) {
    return buzzOrder.map((entry, idx) => ({
      playerId: entry.playerId,
      at: entry.at,
      order: idx + 1
    }));
  }

  const clearedOrder = Array.isArray(st?.judge?.clearedOrder) ? st.judge.clearedOrder : [];
  const entries = [];
  const seen = new Set();
  clearedOrder.forEach((playerId, idx) => {
    const key = String(playerId || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push({ playerId: key, at: null, order: idx + 1 });
  });
  let nextOrder = entries.length + 1;
  for (const entry of buzzOrder) {
    const key = String(entry?.playerId || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push({ playerId: key, at: entry?.at ?? null, order: nextOrder });
    nextOrder += 1;
  }
  return entries;
}

function buildFrozenRankSortedPlayers(st, players, connectionOrderMap) {
  const snapshot = Array.isArray(st.ui?.rankSortOrder) ? st.ui.rankSortOrder : [];
  return buildPlayersFromSnapshot(players, snapshot, connectionOrderMap);
}

function buildPlayersFromSnapshot(players, snapshot, connectionOrderMap) {
  if (!snapshot.length) {
    return [...players].sort((a, b) => compareRankOrder(a, b, connectionOrderMap));
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

function applyAdaptiveGridColumns(grid, playerCount, mode = "full") {
  if (!(grid instanceof HTMLElement)) return;

  const shouldUseAdaptiveGrid =
    mode === "full" &&
    !grid.classList.contains("verticalMode") &&
    !grid.classList.contains("overlayMode") &&
    !grid.classList.contains("slimMode");

  if (!shouldUseAdaptiveGrid) {
    grid.style.removeProperty("grid-template-columns");
    return;
  }

  const totalPlayers = Math.max(0, Number(playerCount) || 0);
  if (totalPlayers <= 0) {
    grid.style.removeProperty("grid-template-columns");
    return;
  }

  const maxColumns = totalPlayers;
  let columns = Math.min(GRID_BASE_WRAP_COUNT, maxColumns);
  grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;

  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
  const gridRect = grid.getBoundingClientRect();
  const availableHeight = Math.max(0, viewportHeight - gridRect.top - 12);

  while (columns < maxColumns && grid.scrollHeight > availableHeight) {
    columns += 1;
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  }
}

function renderPlayers(st, mode = "full") {
  const grid = document.querySelector("#playersGrid");
  grid.innerHTML = "";

  const players = getOrderedConnectedPlayers(st);
  const connectionOrderMap = buildConnectionOrderMap(players);
  const { orderMap, firstAt } = (() => {
    const buzzOrder = getDisplayBuzzEntries(st);
    const orderMap = new Map();
    buzzOrder.forEach((entry) => {
      orderMap.set(entry.playerId, { order: entry.order, at: entry.at });
    });
    const firstTimed = buzzOrder.find((entry) => Number.isFinite(Number(entry?.at)));
    return { orderMap, firstAt: firstTimed ? Number(firstTimed.at) : null };
  })();
  const ui = st.ui || {};
  const showScore = ui.showScore !== false;
  const showCorrectCount = ui.showCorrectCount !== false;
  const showWrongCount = ui.showWrongCount !== false;
  const showMarks = !!ui.showMarks;
  const showMarkCorrect = ui.showMarkCorrect !== false;
  const showMarkWrong = ui.showMarkWrong !== false;
  const isOverlayMode = mode === "overlay";
  const isVerticalLayout = ui.playerTileLayout === "vertical" && mode === "full";
  const isSlimLayout = ui.playerTileLayout === "slim" && mode === "full";
  const isOverlayLikeLayout = isOverlayMode || isSlimLayout;
  const visualizerSortMode = String(ui.visualizerSortMode || "manual");
  const showVerticalScore = ui.showVerticalScore !== false;
  const showVerticalCorrectCount = ui.showVerticalCorrectCount !== false;
  const showVerticalWrongCount = ui.showVerticalWrongCount !== false;
  const showVerticalRestCount = ui.showVerticalRestCount !== false;
  const showVerticalBuzzOrder = ui.showVerticalBuzzOrder !== false;
  const showOverlayBuzzOrder = isOverlayLikeLayout && (st.buzzer?.buzzOrder?.length ?? 0) > 0;
  const rankMap = buildRankMap(players, connectionOrderMap);
  const scoreHidden = st.scoreHiddenVisible === true;
  const hiddenScoreSnapshot = Array.isArray(st.ui?.hiddenScoreRankSortOrder) ? st.ui.hiddenScoreRankSortOrder : [];
  const hiddenRankLocked = scoreHidden && hiddenScoreSnapshot.length > 0;
  const boardMode = !!st.boardAnswer?.enabled && !!st.boardAnswer?.visibleOnVisualizer;

  grid.classList.toggle("verticalMode", isVerticalLayout);
  grid.classList.toggle("overlayMode", isOverlayMode);
  grid.classList.toggle("slimMode", isSlimLayout);

  // 並び：押した人（押下順）→ まだ押してない人（名前順）
  const rankSortedPlayers = hiddenRankLocked
    ? buildPlayersFromSnapshot(players, hiddenScoreSnapshot, connectionOrderMap)
    : buildFrozenRankSortedPlayers(st, players, connectionOrderMap);
  const pressed = rankSortedPlayers
    .filter(p => orderMap.has(p.id))
    .sort((a, b) => orderMap.get(a.id).order - orderMap.get(b.id).order);

  const notPressed = rankSortedPlayers.filter(p => !orderMap.has(p.id));

  const rankModePlayers = hiddenRankLocked
    ? rankSortedPlayers
    : showOverlayBuzzOrder
    ? [...pressed, ...notPressed]
    : rankSortedPlayers;
  const sorted = isOverlayLikeLayout
    ? rankModePlayers
    : visualizerSortMode === "rank"
    ? rankModePlayers
    : players;

  const cur = getCurrentRespondent(st);
  const currentPlayerId = cur?.playerId ?? null;
  const wrongSet = st.judge?.wrongSet || {};
  
  function repeatSafe(ch, n, max = 30) {
    const k = Math.max(0, Math.min(Number(n ?? 0) | 0, max));
    return k > 0 ? ch.repeat(k) : "";
  }

  function getVerticalNameClass(name) {
    const len = Array.from(String(name || "")).length;
    if (len >= 20) return "verticalName verticalName-xxxs";
    if (len >= 16) return "verticalName verticalName-xxs";
    if (len >= 13) return "verticalName verticalName-xs";
    if (len >= 10) return "verticalName verticalName-sm";
    return "verticalName";
  }

  function getOverlayNameClass(name) {
    const len = Array.from(String(name || "")).length;
    if (len >= 22) return "overlayName overlayName-xxs";
    if (len >= 18) return "overlayName overlayName-xs";
    if (len >= 14) return "overlayName overlayName-sm";
    return "overlayName";
  }

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;
    const scoreRank = scoreHidden ? null : (rankMap.get(p.id) ?? 1);
    const boardEntry = st.boardAnswer?.responses?.[p.id] || null;
    const boardText = boardEntry?.opened === true ? String(boardEntry?.text || "") : "";
    const boardResult = String(boardEntry?.result || "");

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = formatGapSeconds(info.at - firstAt);
    const gridGapText = info ? gapText : "";
    const buzzOrderText = formatBuzzOrder(order, gapText);

    const isCurrent = currentPlayerId === p.id;
    const isWronged = !!wrongSet[p.id] || boardResult === "wrong";
    const isCorrect =
      (st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === p.id) ||
      boardResult === "correct";

    const restCount = Number(p.restCount ?? 0);
    const isResting = restCount > 0;
    const restBadge = isResting ? `<div class="restBadge" title="休み ${restCount}"><span class="restBadgeIcon">休</span><span class="restBadgeValue">${restCount}</span></div>` : "";

    const status = p.status || "active";
    const isQualified = status === "qualified";
    const isDq = status === "disqualified";

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);
    const boardAnswerHtml = boardMode
      ? `<div class="visualBoardAnswer${boardText ? "" : " is-empty"}">${boardText ? escapeHtml(boardText) : ""}</div>`
      : "";
    const boardResultClass = boardResult === "correct" ? " board-result-correct" : boardResult === "wrong" ? " board-result-wrong" : "";

    const markCorrectText = showMarks && showMarkCorrect ? (scoreHidden ? "?" : repeatSafe("○", correctCount)) : "";
    const markWrongText = showMarks && showMarkWrong ? (scoreHidden ? "?" : repeatSafe("✕", wrongCount)) : "";
    const showMarksRow = !!showMarks;
    const countSummary = [
      showCorrectCount ? `<span class="countSummaryItem countSummaryCorrect">○${scoreHidden ? "?" : correctCount}</span>` : "",
      showWrongCount ? `<span class="countSummaryItem countSummaryWrong">✕${scoreHidden ? "?" : wrongCount}</span>` : ""
    ].filter(Boolean).join("");

    const reachWin = !!p.reach?.qualify;
    const reachLose = !!p.reach?.dq;
    const reachHtml =
      (reachWin ? `<span class="reachTag reach-win">REACH</span>` : "") +
      (reachLose ? `<span class="reachTag reach-lose">REACH</span>` : "");

    const tile = document.createElement("div");
      tile.className =
        "tile" +
      (isVerticalLayout ? " verticalTile" : "") +
      (isSlimLayout ? " slimTile" : "") +
        boardResultClass +
        (isQualified ? " qualified" : "") +
      (isDq ? " disqualified" : "") +
      (info ? " pressed" : "") +
      (order === 1 ? " first" : "") +
      (isCurrent ? " current" : "") +
      (isWronged ? " wrong" : "") +
      (isCorrect ? " correct" : "") +
      (isResting ? " resting" : "");

    if (isVerticalLayout) {
      const verticalBuzzText = showVerticalBuzzOrder ? formatVerticalBuzzOrder(order, gapText) : "";
      const verticalStats = [
        showVerticalScore ? `<span class="verticalStat verticalStat-score">${scoreHidden ? "?" : Number(p.score ?? 0)}</span>` : "",
        showVerticalCorrectCount ? `<span class="verticalStat verticalStat-correct"><span class="verticalStatGlyph verticalStatGlyph-circle"><i class="fa-regular fa-circle" aria-hidden="true"></i></span><span class="verticalStatValue">${scoreHidden ? "?" : correctCount}</span></span>` : "",
        showVerticalWrongCount ? `<span class="verticalStat verticalStat-wrong"><span class="verticalStatGlyph verticalStatGlyph-cross"><i class="fa-solid fa-xmark" aria-hidden="true"></i></span><span class="verticalStatValue">${scoreHidden ? "?" : wrongCount}</span></span>` : "",
        showVerticalRestCount ? `<span class="verticalStat verticalStat-rest"><span class="verticalStatGlyph verticalStatGlyph-rest">休</span><span class="verticalStatValue">${restCount}</span></span>` : ""
      ].filter(Boolean).join("");

      tile.innerHTML = `
        ${renderRankBadge(scoreRank, "verticalRank")}
        <div class="${getVerticalNameClass(p.name)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="verticalBuzzRow${verticalBuzzText ? "" : " is-empty"}">${verticalBuzzText || "&nbsp;"}</div>
        <div class="verticalStats">${verticalStats}</div>
      `;
    } else if (isOverlayLikeLayout) {
      const showBuzzRankOnly = showOverlayBuzzOrder && !!order;
      const overlayPrimaryText = showBuzzRankOnly
        ? (scoreHidden ? "?" : ordinalShortEn(order))
        : (scoreHidden ? "?" : String(Number(p.score ?? 0)));
      const overlayValueClass = showBuzzRankOnly ? "overlayValue is-buzz" : "overlayValue";
      const overlayCrown = !scoreHidden && !showBuzzRankOnly && scoreRank === 1
        ? `<i class="fa-solid fa-crown overlayScoreCrown" aria-hidden="true"></i>`
        : "";

      tile.innerHTML = `
        <div class="overlayTileRow">
          <div class="overlayNameBlock">
            <div class="${getOverlayNameClass(p.name)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          </div>
          <div class="overlayValueBlock">
            <div class="${overlayValueClass}">${overlayCrown}<span>${escapeHtml(overlayPrimaryText)}</span></div>
          </div>
        </div>
      `;
    } else if (mode === "compact") {
      // “名前・得点・押した順”だけ
      tile.innerHTML = `
        <div class="gridRankRow">
          ${renderRankBadge(scoreRank, "gridRank")}
          <div class="gridGap">${restBadge}</div>
        </div>
        <div class="nameRow">
          <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          ${showScore ? `<div class="score">${scoreHidden ? "?" : Number(p.score ?? 0)}</div>` : ``}
        </div>
        ${(countSummary || buzzOrderText) ? `
        <div class="countSummaryRow">
          ${buzzOrderText ? `<div class="buzzOrderInline">${escapeHtml(buzzOrderText)}</div>` : `<div></div>`}
          ${countSummary ? `<div class="countSummary">${countSummary}</div>` : ``}
        </div>
        ` : ``}
      `;
    } else {
      // 従来（full）
      tile.innerHTML = `
        <div class="gridRankRow">
          ${renderRankBadge(scoreRank, "gridRank")}
          <div class="gridGap">${restBadge}</div>
        </div>
        <div class="nameRow">
          <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          ${reachHtml}
          ${showScore ? `<div class="score">${scoreHidden ? "?" : Number(p.score ?? 0)}</div>` : ``}
        </div>
        ${boardAnswerHtml}
        ${(countSummary || buzzOrderText) ? `
        <div class="countSummaryRow">
          ${buzzOrderText ? `<div class="buzzOrderInline">${escapeHtml(buzzOrderText)}</div>` : `<div></div>`}
          ${countSummary ? `<div class="countSummary">${countSummary}</div>` : ``}
        </div>
        ` : ``}

        ${showMarksRow ? `
        <div class="meta marksMeta">
          <div class="marksLine">
            <span class="marksCorrect${markCorrectText ? "" : " is-empty"}">${markCorrectText ? escapeHtml(markCorrectText) : "&nbsp;"}</span>
            <span class="marksWrong${markWrongText ? "" : " is-empty"}">${markWrongText ? escapeHtml(markWrongText) : "&nbsp;"}</span>
          </div>
        </div>
        ` : ``}

      `;
    }

    grid.appendChild(tile);
  }

  applyAdaptiveGridColumns(grid, sorted.length, mode);
}

function rerenderVisualizer() {
  if (!lastState) return;
  const modActive = !!String(lastState?.mods?.active || "").trim() && lastState?.modScoreboardVisible !== true;
  const mode = modActive ? "overlay" : "full";
  renderPlayers(lastState, mode);
}

window.addEventListener("resize", () => {
  rerenderVisualizer();
});


client.onState((st) => {
  lastState = st;
  document.body.classList.toggle("swapJudgeColors", !!st.ui?.swapJudgeColors);
  document.body.classList.toggle("backgroundDarkTheme", !!st.ui?.backgroundDarkTheme);
  document.body.classList.toggle("playerTileDarkTheme", !!st.ui?.playerTileDarkTheme);

  // 先にUIを更新（音で描画が遅れないようにする）
  if(st.buzzer.firstBuzz != null){
    const first = st.buzzer.firstBuzz;
    const firstName = first ? (st.players[first.playerId]?.name ?? first.playerId) : "-";
    const firstEl = document.querySelector("#first");
    if (firstEl) firstEl.textContent = firstName;
  }

  renderJoinQr(st);
  renderRulesOverlay(st);
  renderBoardFocusOverlay(st);

  function computeHudMode(_st, modActive) {
    return modActive ? "overlay" : "full";
  }

  // ここから音（描画の後・awaitしない）
  const s = st.sfx;
  const nonce = Number(s?.nonce ?? 0);

  // MOD切替などでvisualizerが再読込された直後は、
  // 直前stateのSFXを再生せず現在値を基準にする。
  if (lastSfxNonce === 0) {
    lastSfxNonce = nonce;
  }

  if (nonce !== 0 && nonce !== lastSfxNonce) {
    lastSfxNonce = nonce;

    const key = String(s.key || "");
    const chainKey = String(s.chainKey || "");

    // Promiseは待たずに投げる（UIを止めない）
    try {
      if (key === "__stop__") {
        stopAllSfx();
      } else if (key === "thinking") {
        const sec = Number(s.durationSec ?? st.rules?.thinkingSeconds ?? 5);
        void toggleThinking(sec);
      } else if (chainKey) {
        void playSfxSequence([key, chainKey]);
      } else {
        void playSfxOnce(key);
      }
    } catch (e) {
      // 例外で描画が止まらないように握る（必要なら console に出してOK）
      // console.error(e);
    }
  }

    // MODへ state 通知（既に入れてる想定）
  if (window.QUMO_MOD_API) {
    window.QUMO_MOD_API.emitState(st);
  }

  // ★ main をロード
  const modId = st?.mods?.active || null;
  const modActive = !!modId;
  const modScoreboardVisible = modActive && st?.modScoreboardVisible === true;
  const modDisplayActive = modActive && !modScoreboardVisible;

  if (modId) {
    loadMain(modId);
    syncEmbeddedModLayout();
    if (mainFrame && mainFrame.contentWindow) {
      mainFrame.contentWindow.postMessage({ type: "MOD_STATE", state: st }, "*");
    }
  } else {
    // MODなし：iframeを消して、HUDを通常表示に戻す
    currentMainModId = null;
    mainFrame = null;
    const root = document.getElementById("mod-main-root");
    if (root) root.innerHTML = "";
  }

  
  // 1) ベースモードを決める
  let nextHudMode = computeHudMode(st, modDisplayActive);
  hudMode = nextHudMode;
  applyHudClasses(modDisplayActive);

  // 2) まず描画
  renderPlayers(st, hudMode);

  if (!modDisplayActive) {
    hudMode = "full";
    document.body.classList.remove("modView");
    hudRoot?.classList.remove("overlay", "compact", "pressedOnly");
  }


});
