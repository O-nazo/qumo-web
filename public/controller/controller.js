import { createClient } from "/common/common.js";
import { RULE_PROFILE_DEFINITIONS } from "/common/ruleCatalog.js";

const client = createClient({ screen: "controller" });

const overlay = document.getElementById("overlay");
const rulesPanel = document.getElementById("rulesPanel");
const settingsPanel = document.getElementById("settingsPanel");
const visualSettingsPanel = document.getElementById("visualSettingsPanel");
const modsSettingPanel = document.getElementById("modsSettingPanel");
const helpPanel = document.getElementById("helpPanel");

// --- MOD panel loader ---
const modPanel = document.getElementById("modPanel");
const modPanelBody = document.getElementById("modPanelBody");

const modSelect = document.getElementById("modSelect");
const modApply = document.getElementById("modApply");
const modBackgroundDarkThemeEl = document.getElementById("modBackgroundDarkTheme");
const modPlayerTileDarkThemeEl = document.getElementById("modPlayerTileDarkTheme");
const toggleJoinQrTop = document.getElementById("toggleJoinQrTop");
const toggleRulesOverlayBtn = document.getElementById("toggleRulesOverlay");
const toggleBoardAnswerModeBtn = document.getElementById("toggleBoardAnswerMode");
const toggleModScoreboardBtn = document.getElementById("toggleModScoreboard");
const toggleScoreHiddenBtn = document.getElementById("toggleScoreHidden");
const toggleTitleScreenBtn = document.getElementById("toggleTitleScreen");
const playerCountEl = document.getElementById("playerCount");
const playersGridEl = document.getElementById("playersGrid");
const playersViewGridBtn = document.getElementById("playersViewGrid");
const playersViewTableBtn = document.getElementById("playersViewTable");
const playerTileLayoutGridBtn = document.getElementById("playerTileLayoutGrid");
const playerTileLayoutVerticalBtn = document.getElementById("playerTileLayoutVertical");
const playerTileLayoutSlimBtn = document.getElementById("playerTileLayoutSlim");
const controllerSortModeEl = document.getElementById("controllerSortMode");
const visualizerSortModeEl = document.getElementById("visualizerSortMode");
const gridVisualOptionsEl = document.getElementById("gridVisualOptions");
const verticalVisualOptionsEl = document.getElementById("verticalVisualOptions");

let currentModId = null;
const latestModEvents = new Map();
let playersViewMode = "grid";
let draggedPlayerId = null;
let playerTileLayoutMode = "grid";

function getSelectedModThemePrefs(st, modId) {
  const id = String(modId || "").trim();
  const defaults = st?.mods?.meta?.[id]?.uiDefaults || {};
  const prefs = st?.ui?.modThemePrefs?.[id] || {};
  return {
    backgroundDarkTheme: prefs.backgroundDarkTheme ?? !!defaults.backgroundDarkTheme,
    playerTileDarkTheme: prefs.playerTileDarkTheme ?? !!defaults.playerTileDarkTheme
  };
}

function syncModThemePrefInputs(st) {
  const modId = String(modSelect?.value || "").trim();
  const hasMod = !!modId;
  const prefs = getSelectedModThemePrefs(st || lastState || {}, modId);
  if (modBackgroundDarkThemeEl) {
    modBackgroundDarkThemeEl.disabled = !hasMod;
    modBackgroundDarkThemeEl.checked = hasMod ? !!prefs.backgroundDarkTheme : false;
  }
  if (modPlayerTileDarkThemeEl) {
    modPlayerTileDarkThemeEl.disabled = !hasMod;
    modPlayerTileDarkThemeEl.checked = hasMod ? !!prefs.playerTileDarkTheme : false;
  }
}

function emitModThemePrefs() {
  const modId = String(modSelect?.value || "").trim();
  if (!modId) return;
  client.emit("SET_MOD_THEME_PREFS", {
    modId,
    backgroundDarkTheme: !!modBackgroundDarkThemeEl?.checked,
    playerTileDarkTheme: !!modPlayerTileDarkThemeEl?.checked
  });
}

function setModPanelVisible(v){
  modPanel.hidden = !v;
}

function loadModPanel(modId, options = {}){
  const id = String(modId || "").trim();
  const force = !!options.force;
  const panel = document.getElementById("modPanel");
  const body = document.getElementById("modPanelBody");

  if (!panel || !body) return;

  if (!id) {
    currentModId = null;
    panel.hidden = true;
    body.innerHTML = "";
    return;
  }

  if (!force && currentModId === id) return;
  currentModId = id;

  panel.hidden = false;

  body.innerHTML = "";
  const iframe = document.createElement("iframe");
  const bust = force ? `?v=${Date.now()}` : "";
  iframe.src = `/mods/${encodeURIComponent(id)}/controller/panel.html${bust}`;
  iframe.addEventListener("load", () => {
    iframe.contentWindow?.postMessage({ type: "MOD_INIT", modId: id }, "*");
    const latestEvent = latestModEvents.get(id);
    if (latestEvent) {
      iframe.contentWindow?.postMessage(
        { type: "MOD_EVENT", modId: id, event: latestEvent },
        "*"
      );
    }
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
  playerTileLayoutSlimBtn?.classList.toggle("is-active", playerTileLayoutMode === "slim");
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
    console.log("[controller] soft reload by MOD change");
    const activeModId = String(lastState?.mods?.active || currentModId || "").trim();
    if (activeModId) {
      loadModPanel(activeModId, { force: true });
      return;
    }
    location.reload();
    return;
  }

  if (msg?.type === "ERROR") {
    alert(String(msg.error || "エラーが発生しました"));
    return;
  }

  if (msg?.type !== "MOD_EVENT") return;

  if (msg.modId) {
    latestModEvents.set(String(msg.modId), msg.event || null);
  }

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
  ruleProfile: document.querySelector("#ruleProfile"),
  displayQualifyPlayerCount: document.querySelector("#displayQualifyPlayerCount"),
  displayDisqualifiedPlayerCount: document.querySelector("#displayDisqualifiedPlayerCount"),
  joinUrls: document.querySelector("#joinUrls"),
  lanModeEnabled: document.querySelector("#lanModeEnabled"),
  toggleJoinQr: document.querySelector("#toggleJoinQr"),
  playersGrid: document.querySelector("#playersGrid"),
  restPenalty: document.querySelector("#restPenalty"),
  thinkingSeconds: document.querySelector("#thinkingSeconds"),
  autoResetEnabled: document.querySelector("#autoResetEnabled"),
  autoResetDelayMs: document.querySelector("#autoResetDelayMs"),
  autoNextEnabled: document.querySelector("#autoNextEnabled"),
  autoNextDelayMs: document.querySelector("#autoNextDelayMs"),
  presetExportName: document.querySelector("#presetExportName"),
  rulePresetSelect: document.querySelector("#rulePresetSelect"),
  exportRulePreset: document.querySelector("#exportRulePreset"),
  applyRulePreset: document.querySelector("#applyRulePreset"),
  refreshRulePresets: document.querySelector("#refreshRulePresets"),
  resetControllerPrefs: document.querySelector("#resetControllerPrefs"),

  correctPoints: document.querySelector("#correctPoints"),
  wrongPoints: document.querySelector("#wrongPoints"),
  attackStartPoints: document.querySelector("#attackStartPoints"),
  attackCorrectDamage: document.querySelector("#attackCorrectDamage"),
  attackWrongDamage: document.querySelector("#attackWrongDamage"),
  upDownCorrectGain: document.querySelector("#upDownCorrectGain"),
  upDownQualifyScore: document.querySelector("#upDownQualifyScore"),
  upDownDqWrongCount: document.querySelector("#upDownDqWrongCount"),
  boardAnswerEnabled: document.querySelector("#boardAnswerEnabled"),
  boardJudge: document.querySelector("#boardJudge"),
  boardAnswerClear: document.querySelector("#boardAnswerClear"),
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
  backgroundDarkTheme: document.querySelector("#backgroundDarkTheme"),
  playerTileDarkTheme: document.querySelector("#playerTileDarkTheme"),
  showMarks: document.querySelector("#showMarks"),
  showMarkCorrect: document.querySelector("#showMarkCorrect"),
  showMarkWrong: document.querySelector("#showMarkWrong"),

  qualifyReachEnabled: document.querySelector("#qualifyReachEnabled"),
  dqReachEnabled: document.querySelector("#dqReachEnabled"),
  acReset: document.querySelector("#acReset"),
  ruleProfileGroups: Array.from(document.querySelectorAll(".ruleProfileGroup"))
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

function getBoardEntry(st, playerId) {
  return st.boardAnswer?.responses?.[playerId] || null;
}

function getBoardResultBadge(result) {
  if (result === "correct") return `<span class="boardResultBadge is-correct">○</span>`;
  if (result === "wrong") return `<span class="boardResultBadge is-wrong">✕</span>`;
  return "";
}

function setBoardAnswerFlag(playerId, flag) {
  const current = sanitizeBoardFlag(getBoardEntry(lastState || {}, playerId)?.flag);
  const nextFlag = current === flag ? "" : flag;
  client.emit("SET_BOARD_ANSWER_FLAG", { playerId, flag: nextFlag });
}

function sanitizeBoardFlag(raw) {
  const value = String(raw || "").toLowerCase();
  return value === "correct" || value === "wrong" ? value : "";
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

function handleBoardJudge() {
  client.emit("APPLY_BOARD_ANSWER_JUDGMENTS");
}

function handleReset() {
  client.emit("BUZZER_RESET");
  client.emit("PLAY_SFX", { key: "__stop__" });
  syncVisualQuizPresentIfActive();
}

function toggleTitleScreen() {
  const nextVisible = !(lastState?.titleScreenVisible === true);
  client.emit("SET_TITLE_SCREEN", { visible: nextVisible });
}

function toggleModScoreboard() {
  if (!getActiveModId()) return;
  const nextVisible = !(lastState?.modScoreboardVisible === true);
  client.emit("SET_MOD_SCOREBOARD_VISIBLE", { visible: nextVisible });
}

function toggleScoreHidden() {
  const nextVisible = !(lastState?.scoreHiddenVisible === true);
  client.emit("SET_SCORE_HIDDEN", { visible: nextVisible });
}

function toggleRulesOverlay() {
  const nextVisible = !(lastState?.ui?.rulesOverlayVisible === true);
  client.emit("SET_RULES_OVERLAY_VISIBLE", { visible: nextVisible });
}

function handleThinking() {
  client.emit("PLAY_SFX", { key: "thinking" });
}

function handleSkipOrWrong() {
  if (canJudgeFromState(lastState)) {
    handleWrong();
    return;
  }
  client.emit("JUDGE_SKIP");
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!target.closest?.('[contenteditable="true"]');
}

function isKeyboardShortcut(event, { code, key }) {
  const eventCode = String(event?.code || "");
  const eventKey = String(event?.key || "").toLowerCase();
  if (code && eventCode === code) return true;
  if (key && eventKey === String(key).toLowerCase()) return true;
  return false;
}

function getLatestModState(modId) {
  return latestModEvents.get(String(modId || "").trim())?.state || null;
}

function notifyActiveModShortcut(shortcut) {
  const activeModId = String(lastState?.mods?.active || currentModId || "").trim();
  if (!activeModId) return;

  const iframe = document.querySelector("#modPanelBody iframe");
  iframe?.contentWindow?.postMessage({
    type: "CONTROLLER_SHORTCUT_TRIGGERED",
    modId: activeModId,
    shortcut
  }, "*");
}

function triggerActiveModPrimaryAction() {
  const activeModId = String(lastState?.mods?.active || currentModId || "").trim();
  if (!activeModId) return false;

  if (activeModId === "visual_quiz") {
    client.send({
      type: "MOD_CMD",
      modId: activeModId,
      cmd: { type: "VQ_START" }
    });
    return true;
  }

  if (activeModId === "timerace") {
    const state = getLatestModState(activeModId);
    const canPass = !!state?.passEnabled
      && Number(state.passRemaining ?? 0) > 0
      && (state.phase === "running" || state.phase === "countdown" || state.phase === "stopped");
    if (!canPass) return false;

    client.send({
      type: "MOD_CMD",
      modId: activeModId,
      cmd: { type: "TR_PASS" }
    });
    handleReset();
    return true;
  }

  if (activeModId === "intro_quiz") {
    const modState = getLatestModState(activeModId);
    const isPlaying = modState?.playbackStatus?.paused === false;
    client.send({
      type: "MOD_CMD",
      modId: activeModId,
      cmd: { type: isPlaying ? "IQ_HARD_STOP" : "IQ_PLAY" }
    });
    return true;
  }

  return false;
}

function handleControllerShortcut(shortcut) {
  const action = String(shortcut || "").trim();
  if (!action) return false;

  if (action === "PRESENT") {
    handlePresent();
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "RESET") {
    handleReset();
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "THINKING") {
    handleThinking();
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "CORRECT") {
    handleCorrect();
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "SKIP_OR_WRONG") {
    handleSkipOrWrong();
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "SKIP") {
    client.emit("JUDGE_SKIP");
    notifyActiveModShortcut(action);
    return true;
  }
  if (action === "MOD_PRIMARY") {
    const handled = triggerActiveModPrimaryAction();
    if (handled) notifyActiveModShortcut(action);
    return handled;
  }
  return false;
}

els.present.addEventListener("click", handlePresent);
els.buzzerReset?.addEventListener("click", handleReset);
els.thinking.addEventListener("click", handleThinking);
els.correct.addEventListener("click", handleCorrect);
els.wrong.addEventListener("click", handleWrong);
els.boardJudge?.addEventListener("click", handleBoardJudge);
els.skip.addEventListener("click", () => client.emit("JUDGE_SKIP"));

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat) return;
  if (isTypingTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = String(e.key || "").toLowerCase();
  if (isKeyboardShortcut(e, { code: "Numpad2" }) || key === "q") {
    e.preventDefault();
    handleControllerShortcut("PRESENT");
  } else if (
    isKeyboardShortcut(e, { code: "Numpad1" }) ||
    key === "r"
  ) {
    e.preventDefault();
    handleControllerShortcut("RESET");
  } else if (isKeyboardShortcut(e, { code: "Numpad3" }) || key === "t") {
    e.preventDefault();
    handleControllerShortcut("THINKING");
  } else if (isKeyboardShortcut(e, { code: "Numpad0" }) || key === "o") {
    e.preventDefault();
    handleControllerShortcut("CORRECT");
  } else if (
    isKeyboardShortcut(e, { code: "NumpadDecimal" }) ||
    key === "x"
  ) {
    e.preventDefault();
    handleControllerShortcut("SKIP_OR_WRONG");
  } else if (isKeyboardShortcut(e, { key: "backspace" })) {
    e.preventDefault();
    handleControllerShortcut("SKIP");
  } else if (isKeyboardShortcut(e, { code: "NumpadEnter" })) {
    if (handleControllerShortcut("MOD_PRIMARY")) {
      e.preventDefault();
    }
  }
});

/* ルールUI */

els.buzzMode?.addEventListener("change", () => {
  const v = String(els.buzzMode.value || "");
  client.emit("SET_BUZZ_MODE", { buzzMode: v });
});

els.ruleProfile?.addEventListener("change", () => {
  const v = String(els.ruleProfile.value || "standard");
  updateRuleProfileGroups(v);
  client.emit("SET_RULE_PROFILE", { ruleProfile: v });
});

els.correctPoints.addEventListener("change", emitRulePoints);
els.wrongPoints.addEventListener("change", emitRulePoints);
[
  els.displayQualifyPlayerCount,
  els.displayDisqualifiedPlayerCount,
  els.attackStartPoints,
  els.attackCorrectDamage,
  els.attackWrongDamage,
  els.upDownCorrectGain,
  els.upDownQualifyScore,
  els.upDownDqWrongCount
].forEach((el) => el?.addEventListener("change", emitRuleProfileConfig));

els.thinkingSeconds.addEventListener("change", () => {
  const n = Number(els.thinkingSeconds.value);
  client.emit("SET_THINKING_SECONDS", { thinkingSeconds: n });
});

els.restPenalty.addEventListener("change", () => {
  const n = Number(els.restPenalty.value);
  client.emit("SET_REST_PENALTY", { restPenalty: n });
});

els.toggleJoinQr?.addEventListener("click", toggleJoinQrVisibility);
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
  els.backgroundDarkTheme,
  els.playerTileDarkTheme,
  els.showMarks,
  els.showMarkCorrect,
  els.showMarkWrong
].forEach(el => el?.addEventListener("change", emitUiPrefs));


els.acReset.addEventListener("click", () => {
  if (!confirm("本当にリセットしますか？")) return;
  client.emit("AC_RESET");
});
toggleModScoreboardBtn?.addEventListener("click", toggleModScoreboard);
toggleRulesOverlayBtn?.addEventListener("click", toggleRulesOverlay);
toggleScoreHiddenBtn?.addEventListener("click", toggleScoreHidden);
toggleTitleScreenBtn?.addEventListener("click", toggleTitleScreen);

els.qno?.addEventListener("change", commitQuestionNo);
els.qno?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    commitQuestionNo();
    els.qno.blur();
  }
});

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

function populateRuleProfileOptions() {
  const select = els.ruleProfile;
  if (!select) return;
  const currentValue = String(select.value || "");
  select.innerHTML = "";
  for (const rule of RULE_PROFILE_DEFINITIONS) {
    const option = document.createElement("option");
    option.value = rule.id;
    option.textContent = rule.label;
    select.appendChild(option);
  }
  select.value = RULE_PROFILE_DEFINITIONS.some((rule) => rule.id === currentValue)
    ? currentValue
    : (RULE_PROFILE_DEFINITIONS[0]?.id || "standard");
}

function updateRuleProfileGroups(ruleProfile) {
  const activeProfile = String(ruleProfile || "standard");
  for (const group of els.ruleProfileGroups || []) {
    const profiles = String(group?.dataset?.ruleProfile || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    group.hidden = profiles.length > 0 && !profiles.includes(activeProfile);
  }
}

function setCounts(playerId, correctCount, wrongCount, restCount, score) {
  const payload = {
    playerId,
    correctCount: clampCount(correctCount),
    wrongCount: clampCount(wrongCount),
    restCount: clampCount(restCount)
  };
  if (score !== undefined) {
    payload.score = Number(score);
  }
  client.emit("SET_COUNTS", payload);
}

function renderJoinUrls(st) {
  if (!els.joinUrls) return;

  const base = st?.publicBaseUrl;
  const lanModeEnabled = !!st?.ui?.lanModeEnabled;

  els.joinUrls.innerHTML = "";

  if (!base) {
    els.joinUrls.textContent = lanModeEnabled
      ? "LAN URL 準備中…"
      : "トンネルURL取得中…（cloudflared起動待ち）";
  }else{
    els.joinUrls.textContent = lanModeEnabled ? `${base} (LAN)` : base;
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

function emitRuleProfileConfig() {
  client.emit("SET_RULE_PROFILE_CONFIG", {
    config: {
      displayQualifyPlayerCount: Number(els.displayQualifyPlayerCount?.value),
      displayDisqualifiedPlayerCount: Number(els.displayDisqualifiedPlayerCount?.value),
      attackStartPoints: Number(els.attackStartPoints?.value),
      attackCorrectDamage: Number(els.attackCorrectDamage?.value),
      attackWrongDamage: Number(els.attackWrongDamage?.value),
      upDownCorrectGain: Number(els.upDownCorrectGain?.value),
      upDownQualifyScore: Number(els.upDownQualifyScore?.value),
      upDownDqWrongCount: Number(els.upDownDqWrongCount?.value)
    }
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
    playersViewMode,
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
      backgroundDarkTheme: !!els.backgroundDarkTheme?.checked,
      playerTileDarkTheme: !!els.playerTileDarkTheme?.checked,
      showMarks: els.showMarks.checked,
    showMarkCorrect: els.showMarkCorrect.checked,
    showMarkWrong: els.showMarkWrong.checked
  });
}

function emitAutoNextSettings() {
  client.emit("SET_AUTO_RESET", {
    enabled: !!els.autoResetEnabled?.checked,
    delayMs: Number(els.autoResetDelayMs?.value)
  });
  client.emit("SET_AUTO_NEXT", {
    enabled: !!els.autoNextEnabled?.checked,
    delayMs: Number(els.autoNextDelayMs?.value)
  });
}

function emitLanModeSetting() {
  client.emit("SET_LAN_MODE", {
    enabled: !!els.lanModeEnabled?.checked
  });
}

els.autoResetEnabled?.addEventListener("change", emitAutoNextSettings);
els.autoResetDelayMs?.addEventListener("change", emitAutoNextSettings);
els.autoNextEnabled?.addEventListener("change", emitAutoNextSettings);
els.autoNextDelayMs?.addEventListener("change", emitAutoNextSettings);
els.lanModeEnabled?.addEventListener("change", emitLanModeSetting);
els.exportRulePreset?.addEventListener("click", () => {
  client.send({
    type: "EXPORT_RULE_PRESET",
    fileName: String(els.presetExportName?.value || "")
  });
});
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
  const crown = rank === 1
    ? `<i class="fa-solid fa-crown" aria-hidden="true"></i>`
    : `<span aria-hidden="true">&nbsp;</span>`;
  if (rank === 1) {
    return `<span class="rankBadge is-first"><span class="rankBadgeCrown">${crown}</span><span>${text}</span></span>`;
  }
  return `<span class="rankBadge"><span class="rankBadgeCrown">${crown}</span><span>${text}</span></span>`;
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

function buildFrozenRankSortedPlayers(st, players, connectionOrderMap) {
  const snapshot = Array.isArray(st.ui?.rankSortOrder) ? st.ui.rankSortOrder : [];
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

function renderPlayersGrid(st) {
  const grid = els.playersGrid;
  grid.innerHTML = "";

  const players = getOrderedConnectedPlayers(st);
  const connectionOrderMap = buildConnectionOrderMap(st, players);
  const { orderMap, firstAt } = buildBuzzInfo(st);
  const rankMap = buildRankMap(players, connectionOrderMap);
  const controllerSortMode = String(st.ui?.controllerSortMode || "manual");

  const rankSortedPlayers = buildFrozenRankSortedPlayers(st, players, connectionOrderMap);
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
  const boardMode = !!st.boardAnswer?.enabled;

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;
    const rankValue = rankMap.get(p.id) ?? 1;
    const rankText = renderRankBadge(rankValue);

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = formatGapSeconds(info.at - firstAt);
    const buzzOrderText = formatBuzzOrder(order, gapText);
    const boardEntry = getBoardEntry(st, p.id);
    const boardText = String(boardEntry?.text || "");
    const boardFlag = sanitizeBoardFlag(boardEntry?.flag);
    const boardResult = sanitizeBoardFlag(boardEntry?.result);

    const isCurrent = currentPlayerId === p.id;
    const isWronged = !!st.judge?.wrongSet?.[p.id];
    const isCorrect =
      (st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === p.id) ||
      boardResult === "correct";
    const isBoardWrong = boardResult === "wrong";

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
      (isWronged || isBoardWrong ? " wrong" : "") +
      (isCorrect ? " correct" : "") +
      (isResting ? " resting" : "");
    tile.dataset.playerId = p.id;
    tile.draggable = playersViewMode === "table";

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);
    const score = Number(p.score ?? 0);
    const boardAnswerHtml = boardMode
      ? `<div class="boardAnswerInline${boardText ? "" : " is-empty"}">${boardText ? escapeHtml(boardText) : ""}</div>`
      : "";
    const boardJudgeHtml = boardMode
      ? `<div class="boardAnswerJudge">
          <span class="boardJudgeBtn${boardFlag === "correct" ? " is-active" : ""}" data-flag="correct" title="○">○</span>
          <span class="boardJudgeBtn${boardFlag === "wrong" ? " is-active" : ""}" data-flag="wrong" title="✕">✕</span>
          ${getBoardResultBadge(boardResult)}
        </div>`
      : "";

    if (playersViewMode === "table") {
      tile.innerHTML = `
        <div class="nameCell">
          <div class="tileRank">${rankText}</div>
          <div class="${getControllerNameClass(p.name)}" title="名前を変更" aria-label="名前を変更" tabindex="0">${escapeHtml(p.name)}</div>
        </div>
        ${boardMode ? boardAnswerHtml : `<div class="tableSpacer">${reachHtml}</div>`}
        <div class="right">
          <div class="v2 buzzOrderLine">${buzzOrderText}</div>
          ${boardMode ? boardJudgeHtml : ""}
        </div>
        <div class="score countEdit">
          <input class="countInput countInputScore" data-kind="score" type="number" min="-1000000" max="1000000" step="1" value="${score}" />
        </div>
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
      if (boardMode) {
        tile.innerHTML = `
          <div class="row1 boardTopRow">
            <div class="nameCell">
              <div class="tileRank">${rankText}</div>
              <div class="${getControllerNameClass(p.name)}" title="名前を変更" aria-label="名前を変更" tabindex="0">${escapeHtml(p.name)}</div>
            </div>
            <div class="right">
              <div class="v2 buzzOrderLine">${buzzOrderText}</div>
            </div>
          </div>

          ${boardAnswerHtml}
          <div class="meta">
            <div class="kv2">
              <div>${reachHtml}</div>
              <div class="score countEdit">
                <input class="countInput countInputScore" data-kind="score" type="number" min="-1000000" max="1000000" step="1" value="${score}" />
              </div>
            </div>
          </div>
          <div class="meta">
            <div class="kv2">
              <div></div>
              ${boardJudgeHtml}
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
              <div class="score countEdit">
                <input class="countInput countInputScore" data-kind="score" type="number" min="-1000000" max="1000000" step="1" value="${score}" />
              </div>
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
    }

    if (boardMode) tile.classList.add("boardMode");

    const getInput = (kind) => tile.querySelector(`.countInput[data-kind="${kind}"]`);
    const renameNameText = tile.querySelector(".renameNameText");
    const correctFlagBtn = tile.querySelector('.boardJudgeBtn[data-flag="correct"]');
    const wrongFlagBtn = tile.querySelector('.boardJudgeBtn[data-flag="wrong"]');

    function commitCounts(options = {}) {
      const c = getInput("correct")?.value ?? 0;
      const w = getInput("wrong")?.value ?? 0;
      const r = getInput("rest")?.value ?? 0;
      const s = options.includeScore ? (getInput("score")?.value ?? 0) : undefined;
      setCounts(p.id, c, w, r, s);
    }

    for (const inp of tile.querySelectorAll(".countInput")) {
      inp.addEventListener("change", () => commitCounts({ includeScore: inp.dataset.kind === "score" }));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") inp.blur();
      });
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

    correctFlagBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setBoardAnswerFlag(p.id, "correct");
    });

    wrongFlagBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setBoardAnswerFlag(p.id, "wrong");
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
  emitUiPrefs();
  if (lastState) renderPlayersGrid(lastState);
});

playersViewTableBtn?.addEventListener("click", () => {
  playersViewMode = "table";
  applyPlayersViewMode();
  emitUiPrefs();
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

playerTileLayoutSlimBtn?.addEventListener("click", () => {
  if (playerTileLayoutMode === "slim") return;
  playerTileLayoutMode = "slim";
  applyPlayerTileLayoutMode();
  emitUiPrefs();
});

controllerSortModeEl?.addEventListener("change", emitUiPrefs);
visualizerSortModeEl?.addEventListener("change", emitUiPrefs);
els.boardAnswerEnabled?.addEventListener("click", () => {
  client.emit("SET_BOARD_ANSWER_MODE", { enabled: !(lastState?.boardAnswer?.enabled === true) });
});
toggleBoardAnswerModeBtn?.addEventListener("click", () => {
  client.emit("SET_BOARD_ANSWER_MODE", { enabled: !(lastState?.boardAnswer?.enabled === true) });
});
els.boardAnswerClear?.addEventListener("click", () => {
  client.emit("CLEAR_BOARD_ANSWERS");
});

applyPlayersViewMode();
applyPlayerTileLayoutMode();
populateRuleProfileOptions();
updateRuleProfileGroups(els.ruleProfile?.value || "standard");

client.onState((st) => {
  lastState = st;
  if (document.activeElement !== els.qno) {
    els.qno.value = String(st.questionNo ?? 1);
  }
  playersViewMode = String(st.ui?.playersViewMode || "grid") === "table" ? "table" : "grid";
  applyPlayersViewMode();
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
  if (els.ruleProfile) {
    const profile = String(st.rules?.ruleProfile || "standard");
    els.ruleProfile.value = RULE_PROFILE_DEFINITIONS.some((rule) => rule.id === profile)
      ? profile
      : (RULE_PROFILE_DEFINITIONS[0]?.id || "standard");
    updateRuleProfileGroups(els.ruleProfile.value);
  }
  if (els.displayQualifyPlayerCount) {
    els.displayQualifyPlayerCount.value = String(st.rules?.displayQualifyPlayerCount ?? 0);
  }
  if (els.displayDisqualifiedPlayerCount) {
    els.displayDisqualifiedPlayerCount.value = String(st.rules?.displayDisqualifiedPlayerCount ?? 0);
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
  if (els.attackStartPoints) {
    els.attackStartPoints.value = String(st.rules?.attackStartPoints ?? 20);
  }
  if (els.attackCorrectDamage) {
    els.attackCorrectDamage.value = String(st.rules?.attackCorrectDamage ?? 1);
  }
  if (els.attackWrongDamage) {
    els.attackWrongDamage.value = String(st.rules?.attackWrongDamage ?? 1);
  }
  if (els.upDownCorrectGain) {
    els.upDownCorrectGain.value = String(st.rules?.upDownCorrectGain ?? 1);
  }
  if (els.upDownQualifyScore) {
    els.upDownQualifyScore.value = String(st.rules?.upDownQualifyScore ?? 7);
  }
  if (els.upDownDqWrongCount) {
    els.upDownDqWrongCount.value = String(st.rules?.upDownDqWrongCount ?? 2);
  }
  if (els.boardAnswerEnabled) {
    els.boardAnswerEnabled.dataset.on = st.boardAnswer?.enabled ? "1" : "0";
    els.boardAnswerEnabled.title = st.boardAnswer?.enabled ? "ボード解答を無効" : "ボード解答を有効";
  }
  if (toggleBoardAnswerModeBtn) {
    toggleBoardAnswerModeBtn.dataset.on = st.boardAnswer?.enabled ? "1" : "0";
    toggleBoardAnswerModeBtn.title = st.boardAnswer?.enabled ? "ボード解答を無効" : "ボード解答を有効";
  }
  if (els.boardAnswerClear) {
    els.boardAnswerClear.disabled = !st.boardAnswer?.enabled || Object.keys(st.boardAnswer?.responses || {}).length === 0;
  }
  if (els.boardJudge) {
    const flagged = Object.values(st.boardAnswer?.responses || {}).filter((entry) => sanitizeBoardFlag(entry?.flag)).length;
    els.boardJudge.disabled = !st.boardAnswer?.enabled || flagged === 0;
    els.boardJudge.textContent = flagged > 0 ? `判定(${flagged})` : "判定";
  }
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
  playerTileLayoutMode = ["grid", "vertical", "slim"].includes(String(st.ui?.playerTileLayout || "grid"))
    ? String(st.ui?.playerTileLayout || "grid")
    : "grid";
  applyPlayerTileLayoutMode();
  if (els.prioritizePressedPlayers) els.prioritizePressedPlayers.checked = !!st.ui?.prioritizePressedPlayers;
  if (els.showVerticalScore) els.showVerticalScore.checked = st.ui?.showVerticalScore !== false;
  if (els.showVerticalCorrectCount) els.showVerticalCorrectCount.checked = st.ui?.showVerticalCorrectCount !== false;
  if (els.showVerticalWrongCount) els.showVerticalWrongCount.checked = st.ui?.showVerticalWrongCount !== false;
  if (els.showVerticalRestCount) els.showVerticalRestCount.checked = st.ui?.showVerticalRestCount !== false;
    if (els.showVerticalBuzzOrder) els.showVerticalBuzzOrder.checked = st.ui?.showVerticalBuzzOrder !== false;
    if (els.swapJudgeColors) els.swapJudgeColors.checked = !!st.ui?.swapJudgeColors;
   if (els.backgroundDarkTheme) els.backgroundDarkTheme.checked = !!st.ui?.backgroundDarkTheme;
   if (els.playerTileDarkTheme) els.playerTileDarkTheme.checked = !!st.ui?.playerTileDarkTheme;
    els.showMarks.checked = !!st.ui?.showMarks;
    els.showMarkCorrect.checked = st.ui?.showMarkCorrect !== false;
    els.showMarkWrong.checked = st.ui?.showMarkWrong !== false;
    document.body.classList.toggle("swapJudgeColors", !!st.ui?.swapJudgeColors);
    document.body.classList.toggle("backgroundDarkTheme", !!st.ui?.backgroundDarkTheme);
  const qrOn = !!st.ui?.joinQrVisible;
  if (els.toggleJoinQr) {
    els.toggleJoinQr.textContent = qrOn ? "QRコードを非表示" : "QRコードを表示";
    els.toggleJoinQr.dataset.on = qrOn ? "1" : "0";
  }
  if (toggleJoinQrTop) {
    toggleJoinQrTop.dataset.on = qrOn ? "1" : "0";
    toggleJoinQrTop.title = qrOn ? "QRコードを非表示" : "QRコードを表示";
  }
  if (els.autoNextEnabled) els.autoNextEnabled.checked = !!st.rules?.autoNextEnabled;
  if (els.autoNextDelayMs) els.autoNextDelayMs.value = Number(st.rules?.autoNextDelayMs ?? 800);
  if (els.autoResetEnabled) els.autoResetEnabled.checked = !!st.rules?.autoResetEnabled;
  if (els.autoResetDelayMs) els.autoResetDelayMs.value = Number(st.rules?.autoResetDelayMs ?? 1500);
  if (els.lanModeEnabled) els.lanModeEnabled.checked = !!st.ui?.lanModeEnabled;
  if (toggleTitleScreenBtn) {
    const on = st.titleScreenVisible === true;
    toggleTitleScreenBtn.dataset.on = on ? "1" : "0";
    toggleTitleScreenBtn.title = on ? "蓋画を隠す" : "蓋画を表示";
  }
  if (toggleModScoreboardBtn) {
    const modActive = !!String(st?.mods?.active || "").trim();
    const on = modActive && st.modScoreboardVisible === true;
    toggleModScoreboardBtn.disabled = !modActive;
    toggleModScoreboardBtn.dataset.on = on ? "1" : "0";
    toggleModScoreboardBtn.title = !modActive
      ? "MOD適用時に使用できます"
        : on
        ? "MOD表示に戻す"
        : "得点板を表示";
  }
  if (toggleRulesOverlayBtn) {
    const on = st.ui?.rulesOverlayVisible === true;
    toggleRulesOverlayBtn.dataset.on = on ? "1" : "0";
    toggleRulesOverlayBtn.title = on ? "ルール表示を隠す" : "ルールを表示";
  }
  if (toggleScoreHiddenBtn) {
    const on = st.scoreHiddenVisible === true;
    toggleScoreHiddenBtn.dataset.on = on ? "1" : "0";
    toggleScoreHiddenBtn.title = on ? "得点非表示を解除" : "得点を非表示";
  }

  els.qualifyEnabled.checked = !!st.rules?.qualifyEnabled;
  els.qualifyScore.value = String(st.rules?.qualifyScore ?? 4);

  els.dqEnabled.checked = !!st.rules?.dqEnabled;
  els.dqScore.value = String(st.rules?.dqScore ?? -3);

  els.qualifyReachEnabled.checked = !!st.rules?.qualifyReachEnabled;
  els.dqReachEnabled.checked = !!st.rules?.dqReachEnabled;

  const mods = st?.mods?.available || [];
  const active = st?.mods?.active || "";
  const modMeta = st?.mods?.meta || {};

  if (modSelect && modSelect.options.length === 0) {
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(none)";
    modSelect.appendChild(noneOpt);

    mods.forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = String(modMeta?.[id]?.name || id);
      modSelect.appendChild(opt);
    });
  }
  if (modSelect) modSelect.value = active;
  syncModThemePrefInputs(st);

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

  if (cmd.type === "CONTROLLER_SHORTCUT") {
    handleControllerShortcut(cmd.shortcut);
    return;
  }

  // allowlist
  if (cmd.type === "PLAY_SFX") {
    const key = String(cmd.key || "").trim();
    if (!key) return;
    client.send({ type: "PLAY_SFX", key });
    return;
  }

  if (cmd.type === "BUZZER_RESET") {
    client.emit("BUZZER_RESET");
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

  if (cmd.type === "BUZZER_RESET") {
    handleReset();
    return;
  }

  if (cmd.type === "SKIP_OR_WRONG") {
    handleSkipOrWrong();
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

modSelect?.addEventListener("change", () => {
  syncModThemePrefInputs(lastState);
});

modBackgroundDarkThemeEl?.addEventListener("change", emitModThemePrefs);
modPlayerTileDarkThemeEl?.addEventListener("change", emitModThemePrefs);

function openPanel(panel) {
  overlay.hidden = false;
  rulesPanel.hidden = true;
  settingsPanel.hidden = true;
  visualSettingsPanel.hidden = true;
  modsSettingPanel.hidden = true;
  helpPanel.hidden = true;
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

document.getElementById("openHelp")
  ?.addEventListener("click", () => openPanel(helpPanel));

document.getElementById("openModsSettings")
  ?.addEventListener("click", () => openPanel(modsSettingPanel));

overlay?.querySelector(".overlayBg")
  ?.addEventListener("click", closeOverlay);
