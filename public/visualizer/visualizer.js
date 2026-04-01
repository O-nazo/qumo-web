import { createClient } from "/common/common.js";
import { playSfxOnce, playSfxSequence, toggleThinking, warmupSfx } from "/common/sfx.js";

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
    iframe.contentWindow?.postMessage({ type: "MOD_INIT", modId: id }, "*");
  });

  // main側で操作したいので pointer events は ON
  iframe.style.pointerEvents = "auto";

  root.appendChild(iframe);
  mainFrame = iframe;
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

let hudMode = "full"; // "full" | "compact" | "pressedOnly"

function applyHudClasses(modActive) {
  document.body.classList.toggle("modView", !!modActive);

  if (hudRoot) {
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

function buildConnectionOrderMap(players) {
  const orderMap = new Map();
  players.forEach((p, idx) => {
    orderMap.set(p.id, idx);
  });
  return orderMap;
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
  const isVerticalLayout = ui.playerTileLayout === "vertical" && mode === "full";
  const visualizerSortMode = String(ui.visualizerSortMode || "manual");
  const showVerticalScore = ui.showVerticalScore !== false;
  const showVerticalCorrectCount = ui.showVerticalCorrectCount !== false;
  const showVerticalWrongCount = ui.showVerticalWrongCount !== false;
  const showVerticalRestCount = ui.showVerticalRestCount !== false;
  const showVerticalBuzzOrder = ui.showVerticalBuzzOrder !== false;
  const rankMap = buildRankMap(players, connectionOrderMap);

  grid.classList.toggle("verticalMode", isVerticalLayout);

  // 並び：押した人（押下順）→ まだ押してない人（名前順）
  const rankSortedPlayers = [...players].sort((a, b) => compareRankOrder(a, b, connectionOrderMap));
  const pressed = rankSortedPlayers
    .filter(p => orderMap.has(p.id))
    .sort((a, b) => orderMap.get(a.id).order - orderMap.get(b.id).order);

  const notPressed = rankSortedPlayers.filter(p => !orderMap.has(p.id));

  const sorted = visualizerSortMode === "rank"
    ? [...pressed, ...notPressed]
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

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;
    const scoreRank = rankMap.get(p.id) ?? 1;

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

    const markCorrectText = showMarks && showMarkCorrect ? repeatSafe("○", correctCount) : "";
    const markWrongText = showMarks && showMarkWrong ? repeatSafe("✕", wrongCount) : "";
    const showMarksRow = !!showMarks;
    const countSummary = [
      showCorrectCount ? `<span class="countSummaryItem countSummaryCorrect">○${correctCount}</span>` : "",
      showWrongCount ? `<span class="countSummaryItem countSummaryWrong">✕${wrongCount}</span>` : ""
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
        showVerticalScore ? `<span class="verticalStat verticalStat-score">${Number(p.score ?? 0)}</span>` : "",
        showVerticalCorrectCount ? `<span class="verticalStat verticalStat-correct"><span class="verticalStatGlyph verticalStatGlyph-circle">○</span><span class="verticalStatValue">${correctCount}</span></span>` : "",
        showVerticalWrongCount ? `<span class="verticalStat verticalStat-wrong"><span class="verticalStatGlyph verticalStatGlyph-cross">✕</span><span class="verticalStatValue">${wrongCount}</span></span>` : "",
        showVerticalRestCount ? `<span class="verticalStat verticalStat-rest"><span class="verticalStatGlyph verticalStatGlyph-rest">休</span><span class="verticalStatValue">${restCount}</span></span>` : ""
      ].filter(Boolean).join("");

      tile.innerHTML = `
        ${renderRankBadge(scoreRank, "verticalRank")}
        <div class="${getVerticalNameClass(p.name)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="verticalBuzzRow${verticalBuzzText ? "" : " is-empty"}">${verticalBuzzText || "&nbsp;"}</div>
        <div class="verticalStats">${verticalStats}</div>
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
          ${showScore ? `<div class="score">${Number(p.score ?? 0)}</div>` : ``}
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
          ${showScore ? `<div class="score">${Number(p.score ?? 0)}</div>` : ``}
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

  // 先にUIを更新（音で描画が遅れないようにする）
  if(st.buzzer.firstBuzz != null){
    const first = st.buzzer.firstBuzz;
    const firstName = first ? (st.players[first.playerId]?.name ?? first.playerId) : "-";
    const firstEl = document.querySelector("#first");
    if (firstEl) firstEl.textContent = firstName;
  }

  renderJoinQr(st);

  function computeHudMode(st, modActive) {
    // MOD VIEW時は最初から full は使わない（要求どおり）
    const base = modActive ? "compact" : "full";

    // 人数が多ければ先に落とす（目安）
    const n = Object.values(st.players || {}).filter((p) => p?.connected !== false).length;
    let mode = base;
    if (modActive && n >= 9) mode = "pressedOnly"; // 目安：増えたら一気に押した人だけ

    return mode;
  }

  function isHudOverflowing() {
    if (!hudRoot) return false;
    return hudRoot.scrollHeight > hudRoot.clientHeight + 2;
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
      if (key === "thinking") {
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

  if (modId) {
    loadMain(modId);
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
  let nextHudMode = computeHudMode(st, modActive);
  hudMode = nextHudMode;
  applyHudClasses(modActive);

  // 2) まず描画
  renderPlayers(st, hudMode);

  // 3) 入りきらなければ段階的に落として再描画
  if (modActive && isHudOverflowing() && hudMode === "full") {
    hudMode = "compact";
    applyHudClasses(modActive);
    renderPlayers(st, hudMode);
  }

  if (modActive && isHudOverflowing() && hudMode !== "pressedOnly") {
    hudMode = "pressedOnly";
    applyHudClasses(modActive);
    renderPlayers(st, "compact"); // 見た目はcompactのまま、CSSでpressed以外を消す
  }

  if (!modActive) {
    hudMode = "full";
    document.body.classList.remove("modView");
    hudRoot?.classList.remove("compact", "pressedOnly");
  }


});
