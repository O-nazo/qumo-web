import { createClient } from "/common/common.js";

const client = createClient({ screen: "controller" });

const overlay = document.getElementById("overlay");
const rulesPanel = document.getElementById("rulesPanel");
const settingsPanel = document.getElementById("settingsPanel");
const modsSettingPanel = document.getElementById("modsSettingPanel");

// --- MOD panel loader ---
const modPanel = document.getElementById("modPanel");
const modPanelBody = document.getElementById("modPanelBody");
const modTitle = document.getElementById("modTitle");
const modCloseBtn = document.getElementById("modCloseBtn");

const modSelect = document.getElementById("modSelect");
const modApply = document.getElementById("modApply");

let currentModId = null;

function setModPanelVisible(v){
  modPanel.hidden = !v;
}

function loadModPanel(modId){
  const id = String(modId || "").trim();
  const panel = document.getElementById("modPanel");
  const body = document.getElementById("modPanelBody");
  const title = document.getElementById("modTitle");

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
  if (title) title.textContent = `MOD: ${id}`;

  body.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = `/mods/${encodeURIComponent(id)}/controller/panel.html`;
  body.appendChild(iframe);
}

// 右パネルを閉じるだけ（MODのON/OFFは後で）
document.getElementById("modCloseBtn")?.addEventListener("click", () => {
  const panel = document.getElementById("modPanel");
  if (panel) panel.hidden = true;
});


// 最新stateを保持（正解/誤答を「判定」か「SE再生」か切り替えるため）
let lastState = null;

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
  current: document.querySelector("#current"),
  judgeStatus: document.querySelector("#judgeStatus"),
  result: document.querySelector("#result"),
  playersGrid: document.querySelector("#playersGrid"),
  restPenalty: document.querySelector("#restPenalty"),
  thinkingSeconds: document.querySelector("#thinkingSeconds"),
  autoNextEnabled: document.querySelector("#autoNextEnabled"),
  autoNextDelayMs: document.querySelector("#autoNextDelayMs"),

  correctPoints: document.querySelector("#correctPoints"),
  wrongPoints: document.querySelector("#wrongPoints"),
  present: document.querySelector("#present"),
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
  showWrongCount: document.querySelector("#showWrongCount"),
  showMarks: document.querySelector("#showMarks"),
  showMarkCorrect: document.querySelector("#showMarkCorrect"),
  showMarkWrong: document.querySelector("#showMarkWrong"),

  qualifyReachEnabled: document.querySelector("#qualifyReachEnabled"),
  dqReachEnabled: document.querySelector("#dqReachEnabled"),
  acReset: document.querySelector("#acReset"),

};

// 旧: 受付開始/リセット/次問 は廃止（自動進行）

els.present.addEventListener("click", () => {
  client.emit("NEXT_QUESTION"); // 出題
  client.emit("PLAY_SFX", { key: "attack" });
});
els.thinking.addEventListener("click", () => client.emit("PLAY_SFX", { key: "thinking" }));
els.correct.addEventListener("click", () => {
  // 受付中＆回答者がいるときだけ「判定」。それ以外はSEだけ鳴らす。
  if (canJudgeFromState(lastState)) client.emit("JUDGE_CORRECT");
  else client.emit("PLAY_SFX", { key: "correct" });
});
els.wrong.addEventListener("click", () => {
  // 受付中＆回答者がいるときだけ「判定」。それ以外はSEだけ鳴らす。
  if (canJudgeFromState(lastState)) client.emit("JUDGE_WRONG");
  else client.emit("PLAY_SFX", { key: "wrong" });
});
els.skip.addEventListener("click", () => client.emit("JUDGE_SKIP"));

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

els.toggleJoinQr.addEventListener("click", () => {
  const cur = !!lastState?.ui?.joinQrVisible;
  client.emit("SET_JOIN_QR_VISIBLE", { visible: !cur });
});

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
  els.showWrongCount,
  els.showMarks,
  els.showMarkCorrect,
  els.showMarkWrong
].forEach(el => el?.addEventListener("change", emitUiPrefs));


els.acReset.addEventListener("click", () => {
  if (!confirm("本当にリセットしますか？")) return;
  client.emit("AC_RESET");
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

function setCounts(playerId, correctCount, wrongCount) {
  client.emit("SET_COUNTS", {
    playerId,
    correctCount: clampCount(correctCount),
    wrongCount: clampCount(wrongCount)
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
    showWrongCount: els.showWrongCount.checked,
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

/* ゲームUI */
function getCurrentRespondent(st) {
  if (st.judge?.status !== "in_progress") return null;
  return st.buzzer?.buzzOrder?.[st.judge.currentIndex] ?? null;
}

function buildBuzzInfo(st) {
  const orderMap = new Map(); // playerId -> { order, at }
  (st.buzzer?.buzzOrder || []).forEach((b, idx) => {
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

function renderPlayersGrid(st) {
  const grid = els.playersGrid;
  grid.innerHTML = "";

  const players = Object.values(st.players || {});
  const { orderMap, firstAt } = buildBuzzInfo(st);

  const pressed = players
    .filter(p => orderMap.has(p.id))
    .sort((a, b) => orderMap.get(a.id).order - orderMap.get(b.id).order);

  const notPressed = players
    .filter(p => !orderMap.has(p.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));

  const sorted = [...pressed, ...notPressed];

  const cur = getCurrentRespondent(st);
  const currentPlayerId = cur?.playerId ?? null;

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = `+${(info.at - firstAt).toFixed(gapDigits)}ms`;

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

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);
    const score = Number(p.score ?? 0);

    tile.innerHTML = `
      <div class="row1">
        <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="right">
          ${reachHtml}
          <div class="score">${score}</div>
        </div>
      </div>

      <div class="row2">
        <div class="label">正答</div>
        <div class="countEdit">
          <button class="countBtn" data-kind="correct" data-delta="-1" title="-1">-</button>
          <input class="countInput" data-kind="correct" type="number" min="0" max="999" step="1" value="${correctCount}" />
          <button class="countBtn" data-kind="correct" data-delta="1" title="+1">+</button>
        </div>
      </div>

      <div class="row3">
        <div class="label">誤答</div>
        <div class="countEdit">
          <button class="countBtn" data-kind="wrong" data-delta="-1" title="-1">-</button>
          <input class="countInput" data-kind="wrong" type="number" min="0" max="999" step="1" value="${wrongCount}" />
          <button class="countBtn" data-kind="wrong" data-delta="1" title="+1">+</button>
        </div>
      </div>

      <div class="meta">
        <div class="kv2">
          <div class="k2">押した順</div>
          <div class="v2">${order ? `${order}位` : "-"}</div>
        </div>
        <div class="kv2">
          <div class="k2">先着差</div>
          <div class="v2">${gapText}</div>
        </div>
        <div class="kv2">
          <div class="k2">休み</div>
          <div class="v2">${restCount}</div>
        </div>
      </div>
    `;

    const getInput = (kind) => tile.querySelector(`.countInput[data-kind="${kind}"]`);

    function commitCounts() {
      const c = getInput("correct")?.value ?? 0;
      const w = getInput("wrong")?.value ?? 0;
      setCounts(p.id, c, w);
    }

    for (const inp of tile.querySelectorAll(".countInput")) {
      inp.addEventListener("change", commitCounts);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") inp.blur();
      });
    }

    for (const btn of tile.querySelectorAll(".countBtn")) {
      btn.addEventListener("click", () => {
        const kind = String(btn.dataset.kind || "");
        const delta = Number(btn.dataset.delta || 0);

        const inp = getInput(kind);
        if (!inp) return;

        const cur = clampCount(inp.value);
        const next = clampCount(cur + delta);
        inp.value = String(next);

        commitCounts();
      });
    }

    grid.appendChild(tile);
  }
}

function renderResultText(st) {
  const r = st.judge?.lastResult;
  if (!r) return "-";
  if (r.type === "correct") {
    const name = st.players?.[r.playerId]?.name ?? r.playerId;
    return `正解: ${name}`;
  }
  if (r.type === "skip") return "スルー";
  if (r.type === "all_wrong") return "全員不正解";
  return JSON.stringify(r);
}

client.onState((st) => {
  lastState = st;
  els.qno.textContent = String(st.questionNo ?? 1);
  renderJoinUrls(st);

  const cur = getCurrentRespondent(st);
  els.current.textContent = cur ? (st.players?.[cur.playerId]?.name ?? cur.playerId) : "-";
  els.judgeStatus.textContent = st.judge?.status ?? "-";
  els.result.textContent = renderResultText(st);
  renderPlayersGrid(st);

  if (els.buzzMode) {
  const m = String(st.rules?.buzzMode ?? "endless").toLowerCase();
  els.buzzMode.value =
    (m === "cultq" || m === "cult" || m === "cartq") ? "cultq" :
    (m === "single") ? "single" :
    "endless";
  }
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
  els.showWrongCount.checked = st.ui?.showWrongCount !== false;
  els.showMarks.checked = !!st.ui?.showMarks;
  els.showMarkCorrect.checked = st.ui?.showMarkCorrect !== false;
  els.showMarkWrong.checked = st.ui?.showMarkWrong !== false;
  const qrOn = !!st.ui?.joinQrVisible;
  els.toggleJoinQr.textContent = qrOn ? "QRコードを非表示" : "QRコードを表示";
  els.toggleJoinQr.dataset.on = qrOn ? "1" : "0";
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
  // 最初は安全のため allowlist
  if (cmd.type === "PLAY_SFX") {
    const key = String(cmd.key || "").trim();
    if (!key) return;
    client.send({ type: "PLAY_SFX", key }); // 既存プロトコルに乗せる
  }

  if (cmd.type === "RELOAD") {
    location.reload();
  }
});

modApply?.addEventListener("click", () => {
  const modId = String(modSelect?.value || "").trim();
  client.emit("SET_ACTIVE_MOD", { modId });
});

function openPanel(panel) {
  overlay.hidden = false;
  rulesPanel.hidden = true;
  settingsPanel.hidden = true;
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

document.getElementById("openSettings")
  ?.addEventListener("click", () => openPanel(settingsPanel));

document.getElementById("openModsSettings")
  ?.addEventListener("click", () => openPanel(modsSettingPanel));

overlay?.querySelector(".overlayBg")
  ?.addEventListener("click", closeOverlay);