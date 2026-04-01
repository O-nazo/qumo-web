import { createClient } from "/common/common.js";

const client = createClient({ screen: "controller" });

const overlay = document.getElementById("overlay");
const rulesPanel = document.getElementById("rulesPanel");
const settingsPanel = document.getElementById("settingsPanel");
const visualSettingsPanel = document.getElementById("visualSettingsPanel");
const modsSettingPanel = document.getElementById("modsSettingPanel");

// --- MOD panel loader ---
const modPanel = document.getElementById("modPanel");
const modPanelBody = document.getElementById("modPanelBody");

const modSelect = document.getElementById("modSelect");
const modApply = document.getElementById("modApply");
const toggleJoinQrTop = document.getElementById("toggleJoinQrTop");
const playerCountEl = document.getElementById("playerCount");
const playersGridEl = document.getElementById("playersGrid");
const playersViewGridBtn = document.getElementById("playersViewGrid");
const playersViewTableBtn = document.getElementById("playersViewTable");
const playerTileLayoutGridBtn = document.getElementById("playerTileLayoutGrid");
const playerTileLayoutVerticalBtn = document.getElementById("playerTileLayoutVertical");
const controllerSortModeEl = document.getElementById("controllerSortMode");
const visualizerSortModeEl = document.getElementById("visualizerSortMode");
const gridVisualOptionsEl = document.getElementById("gridVisualOptions");
const verticalVisualOptionsEl = document.getElementById("verticalVisualOptions");

let currentModId = null;
let playersViewMode = "grid";
let draggedPlayerId = null;
let playerTileLayoutMode = "grid";

function setModPanelVisible(v){
  modPanel.hidden = !v;
}

function loadModPanel(modId){
  const id = String(modId || "").trim();
  const panel = document.getElementById("modPanel");
  const body = document.getElementById("modPanelBody");

  if (!panel || !body) return;

  if (!id) {
    currentModId = null;
    panel.hidden = true;
    body.innerHTML = "";
    return;
  }

  if (currentModId === id) return;
  currentModId = id;

  panel.hidden = false;

  body.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = `/mods/${encodeURIComponent(id)}/controller/panel.html`;
  iframe.addEventListener("load", () => {
    iframe.contentWindow?.postMessage({ type: "MOD_INIT", modId: id }, "*");
  });
  body.appendChild(iframe);
}

function applyPlayersViewMode() {
  if (playersGridEl) {
    playersGridEl.classList.toggle("tableMode", playersViewMode === "table");
  }
  playersViewGridBtn?.classList.toggle("is-active", playersViewMode === "grid");
  playersViewTableBtn?.classList.toggle("is-active", playersViewMode === "table");
}

function applyPlayerTileLayoutMode() {
  playerTileLayoutGridBtn?.classList.toggle("is-active", playerTileLayoutMode === "grid");
  playerTileLayoutVerticalBtn?.classList.toggle("is-active", playerTileLayoutMode === "vertical");
  if (gridVisualOptionsEl) gridVisualOptionsEl.hidden = playerTileLayoutMode !== "grid";
  if (verticalVisualOptionsEl) verticalVisualOptionsEl.hidden = playerTileLayoutMode !== "vertical";
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

function buildConnectionOrderMap(st, players) {
  const orderMap = new Map();
  players.forEach((p, idx) => {
    orderMap.set(p.id, idx);
  });
  return orderMap;
}

function clearTableDragState() {
  for (const el of document.querySelectorAll(".playersGrid.tableMode .tile")) {
    el.classList.remove("dragging", "dragTargetTop", "dragTargetBottom");
  }
}

function emitPlayerOrderFromDom() {
  if (!playersGridEl) return;
  const playerOrder = Array.from(playersGridEl.querySelectorAll('.tile[data-player-id]'))
    .map((el) => String(el.dataset.playerId || ""))
    .filter(Boolean);
  client.emit("SET_PLAYER_ORDER", { playerOrder });
}

// 最新stateを保持（正解/誤答を「判定」か「SE再生」か切り替えるため）
let lastState = null;

client.onMessage?.((msg) => {
  if (msg?.type === "RELOAD") {
    console.log("[controller] reload by MOD change");
    location.reload();
    return;
  }

  if (msg?.type === "ERROR") {
    alert(String(msg.error || "エラーが発生しました"));
    return;
  }

  if (msg?.type !== "MOD_EVENT") return;

  const activeId = String(lastState?.mods?.active || "");
  if (!activeId) return;
  if (msg.modId !== activeId) return;

  const iframe = document.querySelector("#modPanelBody iframe");
  iframe?.contentWindow?.postMessage(
    { type: "MOD_EVENT", modId: msg.modId, event: msg.event },
    "*"
  );

  console.log("[controller] forwarded MOD_EVENT", msg.event?.type);
});


let gapDigits = 5;

function canJudgeFromState(st) {
  const cur = getCurrentRespondent(st || {});
  return st?.judge?.status === "in_progress" && !!cur;
}


// 早稲田式：進行は自動。判定とSE操作のみ。 

const els = {
  qno: document.querySelector("#qno"),

  buzzMode: document.querySelector("#buzzMode"),
  joinUrls: document.querySelector("#joinUrls"),
  toggleJoinQr: document.querySelector("#toggleJoinQr"),
  playersGrid: document.querySelector("#playersGrid"),
  restPenalty: document.querySelector("#restPenalty"),
  thinkingSeconds: document.querySelector("#thinkingSeconds"),
  autoNextEnabled: document.querySelector("#autoNextEnabled"),
  autoNextDelayMs: document.querySelector("#autoNextDelayMs"),
  rulePresetSelect: document.querySelector("#rulePresetSelect"),
  exportRulePreset: document.querySelector("#exportRulePreset"),
  applyRulePreset: document.querySelector("#applyRulePreset"),
  refreshRulePresets: document.querySelector("#refreshRulePresets"),
  resetControllerPrefs: document.querySelector("#resetControllerPrefs"),

  correctPoints: document.querySelector("#correctPoints"),
  wrongPoints: document.querySelector("#wrongPoints"),
  present: document.querySelector("#present"),
  buzzerReset: document.querySelector("#buzzerReset"),
  thinking: document.querySelector("#thinking"),
  correct: document.querySelector("#correct"),
  wrong: document.querySelector("#wrong"),
  skip: document.querySelector("#skip"),

  qualifyEnabled: document.querySelector("#qualifyEnabled"),
  qualifyScore: document.querySelector("#qualifyScore"),
  dqEnabled: document.querySelector("#dqEnabled"),
  dqScore: document.querySelector("#dqScore"),
  qualifyCountEnabled: document.querySelector("#qualifyCountEnabled"),
  qualifyCorrectCount: document.querySelector("#qualifyCorrectCount"),
  dqWrongEnabled: document.querySelector("#dqWrongEnabled"),
  dqWrongCount: document.querySelector("#dqWrongCount"),

  showScore: document.querySelector("#showScore"),
  showCorrectCount: document.querySelector("#showCorrectCount"),
  showWrongCount: document.querySelector("#showWrongCount"),
  prioritizePressedPlayers: document.querySelector("#prioritizePressedPlayers"),
  controllerSortMode: document.querySelector("#controllerSortMode"),
  visualizerSortMode: document.querySelector("#visualizerSortMode"),
  showVerticalScore: document.querySelector("#showVerticalScore"),
  showVerticalCorrectCount: document.querySelector("#showVerticalCorrectCount"),
  showVerticalWrongCount: document.querySelector("#showVerticalWrongCount"),
  showVerticalRestCount: document.querySelector("#showVerticalRestCount"),
  showVerticalBuzzOrder: document.querySelector("#showVerticalBuzzOrder"),
  swapJudgeColors: document.querySelector("#swapJudgeColors"),
  showMarks: document.querySelector("#showMarks"),
  showMarkCorrect: document.querySelector("#showMarkCorrect"),
  showMarkWrong: document.querySelector("#showMarkWrong"),

  qualifyReachEnabled: document.querySelector("#qualifyReachEnabled"),
  dqReachEnabled: document.querySelector("#dqReachEnabled"),
  acReset: document.querySelector("#acReset"),

};

// 旧: 受付開始/リセット/次問 は廃止（自動進行）

function getActiveModId() {
  return String(lastState?.mods?.active || "").trim();
}

function sendModPanelCmd(cmd) {
  const modId = getActiveModId();
  if (!modId || !cmd || typeof cmd.type !== "string") return;

  client.send({
    type: "MOD_CMD",
    modId,
    cmd
  });
}

function syncVisualQuizPresentIfActive() {
  if (getActiveModId() !== "visual_quiz") return;
  sendModPanelCmd({ type: "VQ_PRESENT" });
}

function commitQuestionNo() {
  if (!els.qno) return;
  const n = Number(els.qno.value);
  if (!Number.isFinite(n)) return;

  const questionNo = Math.max(0, Math.floor(n));
  els.qno.value = String(questionNo);
  client.emit("SET_QUESTION_NO", { questionNo });
}

function toggleJoinQrVisibility() {
  const cur = !!lastState?.ui?.joinQrVisible;
  client.emit("SET_JOIN_QR_VISIBLE", { visible: !cur });
}

function handlePresent() {
  commitQuestionNo();
  client.emit("NEXT_QUESTION"); // 出題
  client.emit("PLAY_SFX", { key: "attack" });
  syncVisualQuizPresentIfActive();
}

function handleCorrect() {
  // 受付中＆回答者がいるときだけ「判定」。それ以外はSEだけ鳴らす。
  if (canJudgeFromState(lastState)) client.emit("JUDGE_CORRECT");
  else client.emit("PLAY_SFX", { key: "correct" });
}

function handleWrong() {
  // 受付中＆回答者がいるときだけ「判定」。それ以外はSEだけ鳴らす。
  if (canJudgeFromState(lastState)) client.emit("JUDGE_WRONG");
  else client.emit("PLAY_SFX", { key: "wrong" });
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!target.closest?.('[contenteditable="true"]');
}

els.present.addEventListener("click", handlePresent);
els.buzzerReset?.addEventListener("click", () => client.emit("BUZZER_RESET"));
els.thinking.addEventListener("click", () => client.emit("PLAY_SFX", { key: "thinking" }));
els.correct.addEventListener("click", handleCorrect);
els.wrong.addEventListener("click", handleWrong);
els.skip.addEventListener("click", () => client.emit("JUDGE_SKIP"));

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat) return;
  if (isTypingTarget(e.target)) return;

  const key = String(e.key || "").toLowerCase();
  if (key === "o") {
    e.preventDefault();
    handleCorrect();
  } else if (key === "x") {
    e.preventDefault();
    handleWrong();
  }
});

/* ルールUI */

els.buzzMode?.addEventListener("change", () => {
  const v = String(els.buzzMode.value || "");
  client.emit("SET_BUZZ_MODE", { buzzMode: v });
});

els.correctPoints.addEventListener("change", emitRulePoints);
els.wrongPoints.addEventListener("change", emitRulePoints);

els.thinkingSeconds.addEventListener("change", () => {
  const n = Number(els.thinkingSeconds.value);
  client.emit("SET_THINKING_SECONDS", { thinkingSeconds: n });
});

els.restPenalty.addEventListener("change", () => {
  const n = Number(els.restPenalty.value);
  client.emit("SET_REST_PENALTY", { restPenalty: n });
});

els.toggleJoinQr.addEventListener("click", toggleJoinQrVisibility);
toggleJoinQrTop?.addEventListener("click", toggleJoinQrVisibility);

[
  els.qualifyEnabled,
  els.qualifyScore,
  els.dqEnabled,
  els.dqScore,
  els.qualifyReachEnabled,
  els.dqReachEnabled
].forEach(el => el.addEventListener("change", emitAdvanceRules));

[
  els.qualifyCountEnabled,
  els.qualifyCorrectCount,
  els.dqWrongEnabled,
  els.dqWrongCount
].forEach(el => el?.addEventListener("change", emitCountRules));

[
  els.showScore,
  els.showCorrectCount,
  els.showWrongCount,
  els.prioritizePressedPlayers,
  els.controllerSortMode,
  els.visualizerSortMode,
  els.showVerticalScore,
  els.showVerticalCorrectCount,
  els.showVerticalWrongCount,
  els.showVerticalRestCount,
  els.showVerticalBuzzOrder,
  els.swapJudgeColors,
  els.showMarks,
  els.showMarkCorrect,
  els.showMarkWrong
].forEach(el => el?.addEventListener("change", emitUiPrefs));


els.acReset.addEventListener("click", () => {
  if (!confirm("本当にリセットしますか？")) return;
  client.emit("AC_RESET");
});

els.qno?.addEventListener("change", commitQuestionNo);
els.qno?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    commitQuestionNo();
    els.qno.blur();
  }
});
els.qno?.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (document.activeElement !== els.qno) {
    els.qno.focus({ preventScroll: true });
  }

  const cur = Number(els.qno.value || 0);
  const next = Math.max(0, Math.floor(cur + (e.deltaY < 0 ? 1 : -1)));
  els.qno.value = String(next);
  commitQuestionNo();
}, { passive: false });

function emitRulePoints() {
  client.emit("SET_RULE_POINTS", {
    correctPoints: Number(els.correctPoints.value),
    wrongPoints: Number(els.wrongPoints.value)
  });
}

function clampCount(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(999, Math.trunc(x)));
}

function setCounts(playerId, correctCount, wrongCount, restCount) {
  client.emit("SET_COUNTS", {
    playerId,
    correctCount: clampCount(correctCount),
    wrongCount: clampCount(wrongCount),
    restCount: clampCount(restCount)
  });
}

function renderJoinUrls(st) {
  if (!els.joinUrls) return;

  const base = st?.publicBaseUrl;

  els.joinUrls.innerHTML = "";

  if (!base) {
    els.joinUrls.textContent = "トンネルURL取得中…（cloudflared起動待ち）";
  }else{
    els.joinUrls.textContent = base;
    return;
  }

}

function renderRulePresets(st) {
  const select = els.rulePresetSelect;
  if (!select) return;

  const files = Array.isArray(st?.configPresets?.files) ? st.configPresets.files : [];
  const prev = String(select.value || "");
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = files.length ? "プリセットを選択" : "プリセットなし";
  select.appendChild(placeholder);

  for (const fileName of files) {
    const opt = document.createElement("option");
    opt.value = fileName;
    opt.textContent = fileName;
    select.appendChild(opt);
  }

  if (files.includes(prev)) {
    select.value = prev;
  } else {
    select.value = "";
  }
}

function emitAdvanceRules() {
  client.emit("SET_RULE_ADVANCE", {
    qualifyEnabled: els.qualifyEnabled.checked,
    qualifyScore: Number(els.qualifyScore.value),

    dqEnabled: els.dqEnabled.checked,
    dqScore: Number(els.dqScore.value),

    qualifyReachEnabled: els.qualifyReachEnabled.checked,
    dqReachEnabled: els.dqReachEnabled.checked
  });
}

function emitCountRules() {
  client.emit("SET_RULE_COUNTS", {
    qualifyCountEnabled: els.qualifyCountEnabled.checked,
    qualifyCorrectCount: Number(els.qualifyCorrectCount.value),
    dqWrongEnabled: els.dqWrongEnabled.checked,
    dqWrongCount: Number(els.dqWrongCount.value)
  });
}

function emitUiPrefs() {
  client.emit("SET_UI_PREFS", {
    showScore: els.showScore.checked,
    showCorrectCount: els.showCorrectCount.checked,
    showWrongCount: els.showWrongCount.checked,
    playerTileLayout: playerTileLayoutMode,
    controllerSortMode: String(els.controllerSortMode?.value || "manual"),
    visualizerSortMode: String(els.visualizerSortMode?.value || "manual"),
    prioritizePressedPlayers: !!els.prioritizePressedPlayers?.checked,
    showVerticalScore: els.showVerticalScore?.checked !== false,
    showVerticalCorrectCount: els.showVerticalCorrectCount?.checked !== false,
    showVerticalWrongCount: els.showVerticalWrongCount?.checked !== false,
    showVerticalRestCount: els.showVerticalRestCount?.checked !== false,
    showVerticalBuzzOrder: els.showVerticalBuzzOrder?.checked !== false,
    swapJudgeColors: !!els.swapJudgeColors?.checked,
    showMarks: els.showMarks.checked,
    showMarkCorrect: els.showMarkCorrect.checked,
    showMarkWrong: els.showMarkWrong.checked
  });
}

function emitAutoNextSettings() {
  client.emit("SET_AUTO_NEXT", {
    enabled: !!els.autoNextEnabled?.checked,
    delayMs: Number(els.autoNextDelayMs?.value)
  });
}

els.autoNextEnabled?.addEventListener("change", emitAutoNextSettings);
els.autoNextDelayMs?.addEventListener("change", emitAutoNextSettings);
els.exportRulePreset?.addEventListener("click", () => client.send({ type: "EXPORT_RULE_PRESET" }));
els.refreshRulePresets?.addEventListener("click", () => client.send({ type: "LIST_RULE_PRESETS" }));
els.applyRulePreset?.addEventListener("click", () => {
  const fileName = String(els.rulePresetSelect?.value || "");
  if (!fileName) return;
  client.send({ type: "APPLY_RULE_PRESET", fileName });
});
els.resetControllerPrefs?.addEventListener("click", () => {
  if (!confirm("ルール・表示設定・設定を初期値に戻しますか？")) return;
  client.send({ type: "RESET_CONTROLLER_PREFS" });
});

/* ゲームUI */
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
  return `+${(ms / 1000).toFixed(3)}s`;
}

function formatBuzzOrder(order, gapText) {
  if (!order) return "-";
  const ord = ordinalShortEn(order);
  if (order === 1 || !gapText || gapText === "-") return ord;
  return `${ord} ${gapText}`;
}

function requestPlayerRename(playerId, currentName) {
  const name = String(currentName || "").trim();
  if (!name) {
    alert("名前を入力してください");
    return;
  }

  client.emit("CHANGE_NAME", { playerId, name });
}

function renderRankBadge(rank) {
  const text = ordinalShortEn(rank);
  if (rank === 1) {
    return `<span class="rankBadge is-first"><i class="fa-solid fa-crown" aria-hidden="true"></i><span>${text}</span></span>`;
  }
  return `<span class="rankBadge"><span>${text}</span></span>`;
}

function getControllerNameClass(name) {
  const len = Array.from(String(name || "")).length;
  if (len >= 16) return "name name-xxs renameNameText";
  if (len >= 13) return "name name-xs renameNameText";
  if (len >= 10) return "name name-sm renameNameText";
  return "name renameNameText";
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
    return Number(a?.qualifiedAt ?? Number.MAX_SAFE_INTEGER) - Number(b?.qualifiedAt ?? Number.MAX_SAFE_INTEGER);
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
  return Number(a?.dqAt ?? Number.MAX_SAFE_INTEGER) - Number(b?.dqAt ?? Number.MAX_SAFE_INTEGER);
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
  let currentRank = 0;
  let lastPlayer = null;

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

function renderPlayersGrid(st) {
  const grid = els.playersGrid;
  grid.innerHTML = "";

  const players = getOrderedConnectedPlayers(st);
  const connectionOrderMap = buildConnectionOrderMap(st, players);
  const { orderMap, firstAt } = buildBuzzInfo(st);
  const rankMap = buildRankMap(players, connectionOrderMap);
  const controllerSortMode = String(st.ui?.controllerSortMode || "manual");

  const rankSortedPlayers = [...players].sort((a, b) => compareRankOrder(a, b, connectionOrderMap));
  const sorted = controllerSortMode === "rank"
    ? [
        ...rankSortedPlayers
          .filter((p) => orderMap.has(p.id))
          .sort((a, b) => orderMap.get(a.id).order - orderMap.get(b.id).order),
        ...rankSortedPlayers.filter((p) => !orderMap.has(p.id))
      ]
    : players;

  const cur = getCurrentRespondent(st);
  const currentPlayerId = cur?.playerId ?? null;

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;
    const rankValue = rankMap.get(p.id) ?? 1;
    const rankText = renderRankBadge(rankValue);

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = formatGapSeconds(info.at - firstAt);
    const buzzOrderText = formatBuzzOrder(order, gapText);

    const isCurrent = currentPlayerId === p.id;
    const isWronged = !!st.judge?.wrongSet?.[p.id];
    const isCorrect =
      st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === p.id;

    const restCount = Number(p.restCount ?? 0);
    const isResting = restCount > 0;

    const status = p.status || "active";
    const isQualified = status === "qualified";
    const isDq = status === "disqualified";

    const reachWin = !!p.reach?.qualify;
    const reachLose = !!p.reach?.dq;

    const reachHtml =
      (reachWin ? `<span class="reachTag reach-win">REACH</span>` : "") +
      (reachLose ? `<span class="reachTag reach-lose">REACH</span>` : "");

    const tile = document.createElement("div");
    tile.className =
      "tile" +
      (isQualified ? " qualified" : "") +
      (isDq ? " disqualified" : "") +
      (info ? " pressed" : "") +
      (order === 1 ? " first" : "") +
      (isCurrent ? " current" : "") +
      (isWronged ? " wrong" : "") +
      (isCorrect ? " correct" : "") +
      (isResting ? " resting" : "");
    tile.dataset.playerId = p.id;
    tile.draggable = playersViewMode === "table";

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);
    const score = Number(p.score ?? 0);

    if (playersViewMode === "table") {
      tile.innerHTML = `
        <div class="nameRow">
          <div class="nameCell">
            <div class="tileRank">${rankText}</div>
            <div class="${getControllerNameClass(p.name)}" title="名前を変更" aria-label="名前を変更" tabindex="0">${escapeHtml(p.name)}</div>
          </div>
          <div class="right">
            ${reachHtml}
          </div>
        </div>

        <div class="score">${score}</div>

        <div class="row2">
          <div class="label label-correct">○</div>
          <div class="countEdit">
            <input class="countInput" data-kind="correct" type="number" min="0" max="999" step="1" value="${correctCount}" />
          </div>
        </div>

        <div class="row3">
          <div class="label label-wrong">✕</div>
          <div class="countEdit">
            <input class="countInput" data-kind="wrong" type="number" min="0" max="999" step="1" value="${wrongCount}" />
          </div>
        </div>

        <div class="row4">
          <div class="label label-rest">休</div>
          <div class="countEdit">
            <input class="countInput" data-kind="rest" type="number" min="0" max="999" step="1" value="${restCount}" />
          </div>
        </div>
      `;
    } else {
      tile.innerHTML = `
        <div class="tileRank">${rankText}</div>
        <div class="row1">
          <div class="nameCell">
            <div class="${getControllerNameClass(p.name)}" title="名前を変更" aria-label="名前を変更" tabindex="0">${escapeHtml(p.name)}</div>
          </div>
          <div class="right">
            ${reachHtml}
            <div class="score">${score}</div>
          </div>
        </div>

        <div class="row2">
          <div class="countsInline">
            <div class="countPair">
              <div class="label label-correct">○</div>
              <div class="countEdit">
                <input class="countInput" data-kind="correct" type="number" min="0" max="999" step="1" value="${correctCount}" />
              </div>
            </div>
            <div class="countPair">
              <div class="label label-wrong">✕</div>
              <div class="countEdit">
                <input class="countInput" data-kind="wrong" type="number" min="0" max="999" step="1" value="${wrongCount}" />
              </div>
            </div>
            <div class="countPair">
              <div class="label label-rest">休</div>
              <div class="countEdit">
                <input class="countInput" data-kind="rest" type="number" min="0" max="999" step="1" value="${restCount}" />
              </div>
            </div>
          </div>
        </div>

        <div class="meta">
          <div class="v2 buzzOrderLine">${buzzOrderText}</div>
        </div>
      `;
    }

    const getInput = (kind) => tile.querySelector(`.countInput[data-kind="${kind}"]`);
    const renameNameText = tile.querySelector(".renameNameText");

    function commitCounts() {
      const c = getInput("correct")?.value ?? 0;
      const w = getInput("wrong")?.value ?? 0;
      const r = getInput("rest")?.value ?? 0;
      setCounts(p.id, c, w, r);
    }

    for (const inp of tile.querySelectorAll(".countInput")) {
      inp.addEventListener("change", commitCounts);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") inp.blur();
      });
      inp.addEventListener("wheel", (e) => {
        if (document.activeElement !== inp) inp.focus({ preventScroll: true });
        e.preventDefault();

        const step = Number(inp.step || 1);
        const delta = e.deltaY < 0 ? step : -step;
        const next = clampCount(Number(inp.value || 0) + delta);
        inp.value = String(next);
        commitCounts();
      }, { passive: false });
    }

    renameNameText?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const originalName = String(p.name || "");
      const el = renameNameText;
      if (!el || el.isContentEditable) return;

      el.contentEditable = "true";
      el.classList.add("isEditing");
      el.textContent = originalName;

      const finish = (submit) => {
        if (submit) {
          const nextName = String(el.textContent || "").trim();
          if (nextName && nextName !== originalName) {
            requestPlayerRename(p.id, nextName);
          } else {
            el.textContent = originalName;
          }
        } else {
          el.textContent = originalName;
        }
        el.contentEditable = "false";
        el.classList.remove("isEditing");
      };

      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);

      el.addEventListener("keydown", function onKeydown(ev) {
        ev.stopPropagation();
        if (ev.key === "Enter") {
          ev.preventDefault();
          el.removeEventListener("keydown", onKeydown);
          finish(true);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          el.removeEventListener("keydown", onKeydown);
          finish(false);
        }
      });

      el.addEventListener("blur", () => {
        finish(true);
      }, { once: true });
    });

    if (playersViewMode === "table") {
      tile.addEventListener("dragstart", (e) => {
        draggedPlayerId = p.id;
        tile.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
      });

      tile.addEventListener("dragend", () => {
        draggedPlayerId = null;
        clearTableDragState();
      });

      tile.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedPlayerId || draggedPlayerId === p.id) return;

        const rect = tile.getBoundingClientRect();
        const placeBefore = e.clientY < rect.top + rect.height / 2;
        tile.classList.toggle("dragTargetTop", placeBefore);
        tile.classList.toggle("dragTargetBottom", !placeBefore);
      });

      tile.addEventListener("dragleave", () => {
        tile.classList.remove("dragTargetTop", "dragTargetBottom");
      });

      tile.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!draggedPlayerId || draggedPlayerId === p.id || !playersGridEl) return;

        const draggedEl = playersGridEl.querySelector(`.tile[data-player-id="${draggedPlayerId}"]`);
        if (!draggedEl) return;

        const rect = tile.getBoundingClientRect();
        const placeBefore = e.clientY < rect.top + rect.height / 2;
        playersGridEl.insertBefore(draggedEl, placeBefore ? tile : tile.nextSibling);
        clearTableDragState();
        emitPlayerOrderFromDom();
      });
    }

    grid.appendChild(tile);
  }
}

playersViewGridBtn?.addEventListener("click", () => {
  playersViewMode = "grid";
  applyPlayersViewMode();
  if (lastState) renderPlayersGrid(lastState);
});

playersViewTableBtn?.addEventListener("click", () => {
  playersViewMode = "table";
  applyPlayersViewMode();
  if (lastState) renderPlayersGrid(lastState);
});

playerTileLayoutGridBtn?.addEventListener("click", () => {
  if (playerTileLayoutMode === "grid") return;
  playerTileLayoutMode = "grid";
  applyPlayerTileLayoutMode();
  emitUiPrefs();
});

playerTileLayoutVerticalBtn?.addEventListener("click", () => {
  if (playerTileLayoutMode === "vertical") return;
  playerTileLayoutMode = "vertical";
  applyPlayerTileLayoutMode();
  emitUiPrefs();
});

controllerSortModeEl?.addEventListener("change", emitUiPrefs);
visualizerSortModeEl?.addEventListener("change", emitUiPrefs);

applyPlayersViewMode();
applyPlayerTileLayoutMode();

client.onState((st) => {
  lastState = st;
  if (document.activeElement !== els.qno) {
    els.qno.value = String(st.questionNo ?? 1);
  }
  renderJoinUrls(st);
  renderRulePresets(st);
  if (playerCountEl) {
    const connectedCount = Object.values(st.players || {}).filter((p) => p?.connected !== false).length;
    playerCountEl.textContent = `${connectedCount}人接続中`;
  }
  renderPlayersGrid(st);

  if (els.buzzMode) {
  const m = String(st.rules?.buzzMode ?? "endless").toLowerCase();
  els.buzzMode.value =
    (m === "cultq" || m === "cult" || m === "cartq") ? "cultq" :
    (m === "single") ? "single" :
    "endless";
  }
  const cur = getCurrentRespondent(st);
  const canJudge = st.judge?.status === "in_progress" && !!cur;
  els.correct.dataset.mode = canJudge ? "judge" : "sfx";
  els.wrong.dataset.mode = canJudge ? "judge" : "sfx";
  els.correct.disabled = false;
  els.wrong.disabled = false;
  els.skip.disabled = st.judge?.status === "result";
  els.restPenalty.value = String(st.rules?.restPenalty ?? 0);
  els.thinkingSeconds.value = String(st.rules?.thinkingSeconds ?? 5);
  els.correctPoints.value = String(st.rules?.correctPoints ?? 1);
  els.wrongPoints.value = String(st.rules?.wrongPoints ?? -1);
  // 回数ルール
  els.qualifyCountEnabled.checked = !!st.rules?.qualifyCountEnabled;
  els.qualifyCorrectCount.value = String(st.rules?.qualifyCorrectCount ?? 4);
  els.dqWrongEnabled.checked = !!st.rules?.dqWrongEnabled;
  els.dqWrongCount.value = String(st.rules?.dqWrongCount ?? 3);
  // 表示設定
  els.showScore.checked = st.ui?.showScore !== false;
  els.showCorrectCount.checked = st.ui?.showCorrectCount !== false;
  els.showWrongCount.checked = st.ui?.showWrongCount !== false;
  if (els.controllerSortMode) els.controllerSortMode.value = String(st.ui?.controllerSortMode || "manual");
  if (els.visualizerSortMode) els.visualizerSortMode.value = String(st.ui?.visualizerSortMode || "manual");
  playerTileLayoutMode = String(st.ui?.playerTileLayout || "grid");
  applyPlayerTileLayoutMode();
  if (els.prioritizePressedPlayers) els.prioritizePressedPlayers.checked = !!st.ui?.prioritizePressedPlayers;
  if (els.showVerticalScore) els.showVerticalScore.checked = st.ui?.showVerticalScore !== false;
  if (els.showVerticalCorrectCount) els.showVerticalCorrectCount.checked = st.ui?.showVerticalCorrectCount !== false;
  if (els.showVerticalWrongCount) els.showVerticalWrongCount.checked = st.ui?.showVerticalWrongCount !== false;
  if (els.showVerticalRestCount) els.showVerticalRestCount.checked = st.ui?.showVerticalRestCount !== false;
  if (els.showVerticalBuzzOrder) els.showVerticalBuzzOrder.checked = st.ui?.showVerticalBuzzOrder !== false;
  if (els.swapJudgeColors) els.swapJudgeColors.checked = !!st.ui?.swapJudgeColors;
  els.showMarks.checked = !!st.ui?.showMarks;
  els.showMarkCorrect.checked = st.ui?.showMarkCorrect !== false;
  els.showMarkWrong.checked = st.ui?.showMarkWrong !== false;
  document.body.classList.toggle("swapJudgeColors", !!st.ui?.swapJudgeColors);
  const qrOn = !!st.ui?.joinQrVisible;
  els.toggleJoinQr.textContent = qrOn ? "QRコードを非表示" : "QRコードを表示";
  els.toggleJoinQr.dataset.on = qrOn ? "1" : "0";
  if (toggleJoinQrTop) {
    toggleJoinQrTop.dataset.on = qrOn ? "1" : "0";
    toggleJoinQrTop.title = qrOn ? "QRコードを非表示" : "QRコードを表示";
  }
  if (els.autoNextEnabled) els.autoNextEnabled.checked = !!st.rules?.autoNextEnabled;
  if (els.autoNextDelayMs) els.autoNextDelayMs.value = Number(st.rules?.autoNextDelayMs ?? 800);

  els.qualifyEnabled.checked = !!st.rules?.qualifyEnabled;
  els.qualifyScore.value = String(st.rules?.qualifyScore ?? 4);

  els.dqEnabled.checked = !!st.rules?.dqEnabled;
  els.dqScore.value = String(st.rules?.dqScore ?? -3);

  els.qualifyReachEnabled.checked = !!st.rules?.qualifyReachEnabled;
  els.dqReachEnabled.checked = !!st.rules?.dqReachEnabled;

  const mods = st?.mods?.available || [];
  const active = st?.mods?.active || "";
  modSelect.value = st?.mods?.active ?? "";

  if (modSelect && modSelect.options.length === 0) {
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(none)";
    modSelect.appendChild(noneOpt);

    mods.forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      modSelect.appendChild(opt);
    });
  }
  if (modSelect) modSelect.value = active;

  // MODが有効なら右パネルを出す（今は仮で st.mods.active を見る）
  if (st?.mods?.active) {
    loadModPanel(st.mods.active);
  } else {
    loadModPanel(null); // パネル非表示
  }

});

window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || data.type !== "MOD_PANEL_CMD") return;

  const cmd = data.cmd || {};
  if (!cmd || typeof cmd.type !== "string") return;

  // allowlist
  if (cmd.type === "PLAY_SFX") {
    const key = String(cmd.key || "").trim();
    if (!key) return;
    client.send({ type: "PLAY_SFX", key });
    return;
  }

  if (cmd.type === "PRESENT") {
    handlePresent();
    return;
  }

  if (cmd.type === "JUDGE_CORRECT") {
    handleCorrect();
    return;
  }

  if (cmd.type === "JUDGE_WRONG") {
    handleWrong();
    return;
  }

  if (cmd.type === "RELOAD") {
    location.reload();
    return;
  }

  // それ以外は MOD_CMD としてサーバへ
  client.send({
    type: "MOD_CMD",
    modId: currentModId, // いま表示しているパネルのmodId
    cmd
  });
});

modApply?.addEventListener("click", () => {
  const modId = String(modSelect?.value || "").trim();
  client.emit("SET_ACTIVE_MOD", { modId });
});

function openPanel(panel) {
  overlay.hidden = false;
  rulesPanel.hidden = true;
  settingsPanel.hidden = true;
  visualSettingsPanel.hidden = true;
  modsSettingPanel.hidden = true;
  panel.hidden = false;
}
const modReset = document.getElementById("modReset");

modReset?.addEventListener("click", () => {
  console.log("[MOD] reset");
  client.emit("SET_ACTIVE_MOD", { modId: "" }); // 空＝解除
});

function closeOverlay() {
  overlay.hidden = true;
}

document.getElementById("openRules")
  ?.addEventListener("click", () => openPanel(rulesPanel));

document.getElementById("openVisualSettings")
  ?.addEventListener("click", () => openPanel(visualSettingsPanel));

document.getElementById("openSettings")
  ?.addEventListener("click", () => openPanel(settingsPanel));

document.getElementById("openModsSettings")
  ?.addEventListener("click", () => openPanel(modsSettingPanel));

overlay?.querySelector(".overlayBg")
  ?.addEventListener("click", closeOverlay);
