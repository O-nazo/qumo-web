import { createClient } from "/common/common.js";
import { playSfxOnce, playSfxSequence, stopAllSfx, toggleThinking, warmupSfx } from "/common/sfx.js";

const client = createClient({ screen: "visualizer" });
const joinQrOverlay = document.querySelector("#joinQrOverlay");
const joinQrImg = document.querySelector("#joinQrImg");
const joinQrText = document.querySelector("#joinQrText");
const joinQrHint = document.querySelector("#joinQrHint");

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
const MOD_OVERLAY_WIDTH = 252;
const MOD_OVERLAY_GUTTER = 28;

function loadMain(modId) {
  const id = String(modId || "").trim();
  if (!id) return;

  if (currentMainModId === id) return;
  currentMainModId = id;

  const root = document.getElementById("mod-main-root");
  if (!root) {
    console.warn("[MOD] #mod-main-root not found");
    return;
  }

  root.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.src = `/mods/${encodeURIComponent(id)}/visualizer/main.html`;
  iframe.className = "modMainFrame";
  iframe.setAttribute("title", `MOD main: ${id}`);
  iframe.addEventListener("load", () => {
    syncEmbeddedModLayout();
    iframe.contentWindow?.postMessage({ type: "MOD_INIT", modId: id }, "*");
    if (lastState) {
      iframe.contentWindow?.postMessage({ type: "MOD_STATE", state: lastState }, "*");
    }
    if (id === "visual_quiz") {
      client.send({
        type: "MOD_CMD",
        modId: id,
        cmd: { type: "VQ_SYNC_STATE" }
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
    console.log("[visualizer] reload by MOD change");
    location.reload();
    return;
  }

  // 汎用：MOD_EVENT を受け取ったら
  if (msg?.type === "MOD_EVENT") {
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
    return `<span class="verticalBuzzRank">${ord}</span>`;
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
    return `<span class="${className} rankBadge is-hidden"><span>?th</span></span>`;
  }
  const text = ordinalShortEn(rank);
  if (rank === 1) {
    return `<span class="${className} rankBadge is-first"><i class="fa-solid fa-crown" aria-hidden="true"></i><span>${text}</span></span>`;
  }
  return `<span class="${className} rankBadge"><span>${text}</span></span>`;
}

function renderJoinQr(st) {
  const on = !!st.ui?.joinQrVisible;

  if (!on) {
    joinQrOverlay.hidden = true;
    return;
  }

  joinQrOverlay.hidden = false;

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

function renderPlayers(st, mode = "full") {
  const grid = document.querySelector("#playersGrid");
  grid.innerHTML = "";

  const players = getOrderedConnectedPlayers(st);
  const connectionOrderMap = buildConnectionOrderMap(players);
  const { orderMap, firstAt } = buildBuzzInfo(st);
  const ui = st.ui || {};
  const showScore = ui.showScore !== false;
  const showCorrectCount = ui.showCorrectCount !== false;
  const showWrongCount = ui.showWrongCount !== false;
  const showMarks = !!ui.showMarks;
  const showMarkCorrect = ui.showMarkCorrect !== false;
  const showMarkWrong = ui.showMarkWrong !== false;
  const isOverlayMode = mode === "overlay";
  const isVerticalLayout = ui.playerTileLayout === "vertical" && mode === "full";
  const visualizerSortMode = String(ui.visualizerSortMode || "manual");
  const showVerticalScore = ui.showVerticalScore !== false;
  const showVerticalCorrectCount = ui.showVerticalCorrectCount !== false;
  const showVerticalWrongCount = ui.showVerticalWrongCount !== false;
  const showVerticalRestCount = ui.showVerticalRestCount !== false;
  const showVerticalBuzzOrder = ui.showVerticalBuzzOrder !== false;
  const showOverlayBuzzOrder = isOverlayMode && (st.buzzer?.buzzOrder?.length ?? 0) > 0;
  const rankMap = buildRankMap(players, connectionOrderMap);
  const scoreHidden = st.scoreHiddenVisible === true;
  const hiddenScoreSnapshot = Array.isArray(st.ui?.hiddenScoreRankSortOrder) ? st.ui.hiddenScoreRankSortOrder : [];
  const hiddenRankLocked = scoreHidden && hiddenScoreSnapshot.length > 0;

  grid.classList.toggle("verticalMode", isVerticalLayout);
  grid.classList.toggle("overlayMode", isOverlayMode);

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
  const sorted = isOverlayMode
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

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = formatGapSeconds(info.at - firstAt);
    const gridGapText = info ? gapText : "";
    const buzzOrderText = formatBuzzOrder(order, gapText);

    const isCurrent = currentPlayerId === p.id;
    const isWronged = !!wrongSet[p.id];
    const isCorrect =
      st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === p.id;

    const restCount = Number(p.restCount ?? 0);
    const isResting = restCount > 0;
    const restBadge = isResting ? `<div class="restBadge" title="休み ${restCount}"><span class="restBadgeIcon">休</span><span class="restBadgeValue">${restCount}</span></div>` : "";

    const status = p.status || "active";
    const isQualified = status === "qualified";
    const isDq = status === "disqualified";

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);

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
        showVerticalCorrectCount ? `<span class="verticalStat verticalStat-correct"><span class="verticalStatGlyph verticalStatGlyph-circle">○</span><span class="verticalStatValue">${scoreHidden ? "?" : correctCount}</span></span>` : "",
        showVerticalWrongCount ? `<span class="verticalStat verticalStat-wrong"><span class="verticalStatGlyph verticalStatGlyph-cross">✕</span><span class="verticalStatValue">${scoreHidden ? "?" : wrongCount}</span></span>` : "",
        showVerticalRestCount ? `<span class="verticalStat verticalStat-rest"><span class="verticalStatGlyph verticalStatGlyph-rest">休</span><span class="verticalStatValue">${restCount}</span></span>` : ""
      ].filter(Boolean).join("");

      tile.innerHTML = `
        ${renderRankBadge(scoreRank, "verticalRank")}
        <div class="${getVerticalNameClass(p.name)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="verticalBuzzRow${verticalBuzzText ? "" : " is-empty"}">${verticalBuzzText || "&nbsp;"}</div>
        <div class="verticalStats">${verticalStats}</div>
      `;
    } else if (isOverlayMode) {
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
}


client.onState((st) => {
  lastState = st;
  document.body.classList.toggle("swapJudgeColors", !!st.ui?.swapJudgeColors);
  document.body.classList.toggle("playerTileDarkTheme", !!st.ui?.playerTileDarkTheme);

  // 先にUIを更新（音で描画が遅れないようにする）
  if(st.buzzer.firstBuzz != null){
    const first = st.buzzer.firstBuzz;
    const firstName = first ? (st.players[first.playerId]?.name ?? first.playerId) : "-";
    const firstEl = document.querySelector("#first");
    if (firstEl) firstEl.textContent = firstName;
  }

  renderJoinQr(st);

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
