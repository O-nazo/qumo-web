import { createClient } from "/common/common.js?v=20260108_01";

const indicatorEl = document.querySelector("#indicator");
const bigBtn = document.querySelector("#bigBtn");
const bigBtnLabel = document.querySelector("#bigBtnLabel");

// 右パネル
const nameEl = document.querySelector("#name");
const scoreEl = document.querySelector("#score");
const restEl = document.querySelector("#rest");
const rankEl = document.querySelector("#rank");
const pointRankEl = document.querySelector("#pointRank");
const wrongCountEl = document.querySelector("#wrongCount");
const editNameBtn = document.querySelector("#editNameBtn");

const client = createClient({ screen: "player", autoJoin: false });

const PLAYER_NAME_STORAGE_KEY = "qumo_player_name";
const PLAYER_NAME_TTL_MS = 12 * 60 * 60 * 1000;

let joined = false;
let joining = false;
let joinedAt = 0;

let gapDigits = 5;

let myPlayerId = null;
let myName = ""; // 未入力
let nameInputEl = null;
let nameEditMode = null;
let pendingNameChange = null;
let isQualified = null;
let isDq = null;

function readSavedName() {
  try {
    const raw = sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (!raw) return "";

    const parsed = JSON.parse(raw);
    const value = String(parsed?.value ?? "").slice(0, 20);
    const expiresAt = Number(parsed?.expiresAt ?? 0);

    if (!value || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      sessionStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
      return "";
    }

    return value;
  } catch {
    return "";
  }
}

function writeSavedName(name) {
  const value = String(name ?? "").trim().slice(0, 20);
  if (!value) {
    sessionStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, JSON.stringify({
    value,
    expiresAt: Date.now() + PLAYER_NAME_TTL_MS
  }));
}

client.onSelf(({ playerId }) => {
  myPlayerId = playerId;
  joined = true;
  joining = false;
  joinedAt = Date.now(); // 追加：JOIN直後ガード用
});

client.onMessage?.((msg) => {
  if (msg?.type === "RELOAD") {
    console.log("[visualizer] reload by MOD change");
    location.reload();
    return;
  }

  if (msg?.type === "ERROR") {
    if (pendingNameChange) {
      myName = pendingNameChange.previous;
      pendingNameChange = null;
      nameEl.textContent = myName || "-";
    }
    joining = false;
    bigBtnLabel.textContent = joined ? "PUSH" : "CONNECT";
    setIndicatorError(toShortErrorText(msg.error));
  }
});

window.addEventListener("error", (e) => {
  setIndicatorError(toShortErrorText(e.message));
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message ?? String(e.reason);
  setIndicatorError(toShortErrorText(msg));
});

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getCurrentRespondent(st) {
  if (st.judge?.status !== "in_progress") return null;
  return st.buzzer?.buzzOrder?.[st.judge.currentIndex] ?? null;
}

function applyBtnState({ isBlink, isLit, isWrong, isCorrect, isDisabledDim }) {
  bigBtn.classList.toggle("state-blink", !!isBlink);
  bigBtn.classList.toggle("state-lit", !!isLit);
  bigBtn.classList.toggle("state-wrong", !!isWrong);
  bigBtn.classList.toggle("state-correct", !!isCorrect);
  bigBtn.classList.toggle("state-disabledDim", !!isDisabledDim);
  bigBtn.classList.toggle("state-qualified", isQualified);
  bigBtn.classList.toggle("state-dq", isDq);
}

function setIndicatorText(text) {
  indicatorEl.classList.remove("is-error");
  indicatorEl.textContent = text;
}

function setIndicatorError(text) {
  indicatorEl.classList.add("is-error");
  indicatorEl.textContent = text;
}

function toShortErrorText(raw) {
  const msg = String(raw ?? "").trim();
  if (!msg) return "ERROR";
  if (msg.includes("使用中") || msg.includes("使われ")) return "名前重複";
  if (msg.includes("名前")) return "名前エラー";
  if (msg.includes("JSON") || msg.includes("WS")) return "通信異常";
  return "ERROR";
}

function showNamePrompt() {
  setIndicatorText(myName ? myName : "(名前入力)");
}

function commitNameIfEditing() {
  const input = indicatorEl.querySelector("input.indicatorInput");
  if (!input) return false;

  finalizeNameEdit({ submit: true });
  return true;
}

function beginNameEdit(mode = "join") {
  if (mode !== "rename" && joined) return;

  indicatorEl.innerHTML = "";
  const input = document.createElement("input");
  nameInputEl = input;
  nameEditMode = mode;
  input.type = "text";
  input.className = "indicatorInput";
  input.placeholder = "名前";
  input.value = myName;
  indicatorEl.appendChild(input);
  input.focus();
  input.select();

  input.addEventListener("input", () => {
    writeSavedName(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      finalizeNameEdit({ submit: true });
      input.blur(); // 追加：キーボードを閉じる
    }
    if (e.key === "Escape") {
      finalizeNameEdit({ submit: false });
    }
  });

  input.addEventListener("blur", () => finalizeNameEdit({ submit: true }));
}

function requestNameChange(nextName) {
  if (!joined || !myPlayerId) return;
  const previous = myName;
  if (nextName === previous) return;

  myName = nextName;
  pendingNameChange = { previous, next: nextName };
  nameEl.textContent = nextName || "-";
  client.emit("CHANGE_NAME", { name: nextName });
}

function finalizeNameEdit({ submit }) {
  if (!nameInputEl) return;
  const nextName = nameInputEl.value.trim().slice(0, 20);
  const mode = nameEditMode;
  nameInputEl = null;
  nameEditMode = null;

  if (!submit) {
    showNamePrompt();
    return;
  }

  if (!nextName) {
    writeSavedName("");
    showNamePrompt();
    setIndicatorText("名前入力");
    nameEl.textContent = myName || "-";
    return;
  }

  if (mode === "rename" && joined) {
    showNamePrompt();
    requestNameChange(nextName);
    return;
  }

  myName = nextName;
  writeSavedName(myName);
  showNamePrompt();
  nameEl.textContent = myName || "-";
}

function getPlayerScore(p) {
  // プロジェクト内の実フィールド名に合わせて増やしてください
  if (typeof p.score === "number") return p.score;
  if (typeof p.points === "number") return p.points;
  if (typeof p.point === "number") return p.point;
  return 0;
}

function isPlayerLike(p) {
  // プレイヤー以外（admin/controller等）を弾きたい場合の保険
  // 使ってない/無いプロパティは自然にスルーされます
  if (p == null) return false;
  if (p.connected === false) return false;
  if (p.screen && p.screen !== "player") return false;
  if (p.role && p.role !== "player") return false;
  return true;
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
    const scoreDiff = getPlayerScore(b) - getPlayerScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const wrongDiff = Number(a?.wrongCount ?? 0) - Number(b?.wrongCount ?? 0);
    if (wrongDiff !== 0) return wrongDiff;
    return (connectionOrderMap.get(a?._id ?? a?.playerId) ?? Number.MAX_SAFE_INTEGER) - (connectionOrderMap.get(b?._id ?? b?.playerId) ?? Number.MAX_SAFE_INTEGER);
  }

  const wrongDiff = Number(a?.wrongCount ?? 0) - Number(b?.wrongCount ?? 0);
  if (wrongDiff !== 0) return wrongDiff;
  const connectionDiff = (connectionOrderMap.get(a?._id ?? a?.playerId) ?? Number.MAX_SAFE_INTEGER) - (connectionOrderMap.get(b?._id ?? b?.playerId) ?? Number.MAX_SAFE_INTEGER);
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
    return getPlayerScore(a) === getPlayerScore(b) &&
      Number(a?.wrongCount ?? 0) === Number(b?.wrongCount ?? 0);
  }
  return Number(a?.wrongCount ?? 0) === Number(b?.wrongCount ?? 0);
}

function computePointsRankFromPlayers(playersById, myPlayerId, playerOrder = []) {
  const list = Object.entries(playersById || {})
    .map(([id, p]) => ({ ...p, _id: id }))
    .filter(isPlayerLike);
  const connectionOrderMap = new Map();
  playerOrder.forEach((id, idx) => connectionOrderMap.set(String(id), idx));
  list.forEach((p, idx) => {
    if (!connectionOrderMap.has(p._id)) connectionOrderMap.set(p._id, playerOrder.length + idx);
  });

  const total = list.length;
  if (!myPlayerId || total === 0) return { rank: null, total, tied: false, tieCount: 0 };

  const me =
    list.find((p) => p.playerId === myPlayerId) ||
    list.find((p) => p._id === myPlayerId);

  if (!me) return { rank: null, total, tied: false, tieCount: 0 };

  const sorted = [...list].sort((a, b) => compareRankOrder(a, b, connectionOrderMap));
  let rank = null;
  let tieCount = 0;
  let lastPlayer = null;
  let currentRank = 0;

  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i];
    if (!lastPlayer || !isSameRankBucket(lastPlayer, player)) {
      currentRank = i + 1;
    }
    if (player._id === me._id || player.playerId === me.playerId) {
      rank = currentRank;
      tieCount = sorted.filter((x) => isSameRankBucket(player, x)).length;
      break;
    }
    lastPlayer = player;
  }

  return { rank, total, tied: tieCount >= 2, tieCount };
}

// インジケータクリックで名前入力
indicatorEl.addEventListener("click", () => beginNameEdit("join"));
indicatorEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") beginNameEdit("join");
});
editNameBtn?.addEventListener("click", () => beginNameEdit("rename"));

function handleBigBtn(e) {
  // blur(click消失)より先に確実に拾う
  e.preventDefault();
  e.stopPropagation();

  if (joined && Date.now() - joinedAt < 400) return;

  // 二重送信防止（click + pointer/touch の重複対策）
  if (handleBigBtn._last && Date.now() - handleBigBtn._last < 250) return;
  handleBigBtn._last = Date.now();

  // 入力中ならこの場で確定（blur待ちにしない）
  const wasEditing = commitNameIfEditing();
  if (wasEditing && joined) return;

  if (!joined) {
    if (joining) return;

    if (!myName.trim()) {
      setIndicatorText("名前入力");
      return;
    }

    joining = true;

    const nameToSend = myName.trim().slice(0, 20);
    myName = nameToSend;
    nameEl.textContent = myName;

    // ユーザーが「押した」ことが分かるように（デバッグ兼ね）
    bigBtnLabel.textContent = "CONNECTING";

    function findWs(obj) {
      for (const v of Object.values(obj)) {
        if (v instanceof WebSocket) return v;
      }
      return null;
    }

    const ws = findWs(client);
    if (ws) {
      // 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED
      setIndicatorText("接続中");
    }

    client.join({ screen: "player", name: myName });
    return;

  }

  client.emit("BUZZ", {
    // サーバー側の期待キー：tPress（互換で at も受けるが統一）
    tPress: (typeof client.nowServerMs === "function") ? client.nowServerMs() : Date.now()
  });
}

// iPhone Safari では touchstart/pointerdown + preventDefault の組み合わせで
// button の通常操作が不安定になりやすいので、click を主系にする。
bigBtn.addEventListener("click", handleBigBtn, { passive: false });

if (window.PointerEvent) {
  bigBtn.addEventListener("pointerdown", handleBigBtn, { capture: true, passive: false });
} else {
  bigBtn.addEventListener("touchstart", handleBigBtn, { capture: true, passive: false });
}

// 初期表示
myName = readSavedName().slice(0, 20);
showNamePrompt();
nameEl.textContent = myName || "-";

client.onState((st) => {
  // まだJOINしてない場合でもSTATEは来るのでUIは更新する
  const my = (myPlayerId && st.players) ? st.players[myPlayerId] : null;
  if (my?.name) {
    myName = my.name;
    writeSavedName(myName);
    nameEl.textContent = my.name;
    if (pendingNameChange?.next === my.name) pendingNameChange = null;
  }

  const score = Number(my?.score ?? 0);
  scoreEl.textContent = String(score);

  wrongCountEl.textContent = String(my?.wrongCount ?? 0);
  wrongCountEl.parentElement.style.display =
    st.ui?.showWrongCount !== false ? "" : "none";

  const restCount = Number(my?.restCount ?? 0);
  restEl.textContent = `あと${restCount}問`;

  const status = my?.status || "active";
  isQualified = status === "qualified";
  isDq = status === "disqualified";
  const isModDisabled = !!my?.modDisabled;

    // --- 早押し順関連（必須） ---
  const order = st.buzzer?.buzzOrder || [];
  const idx = myPlayerId ? order.findIndex(b => b.playerId === myPlayerId) : -1;
  const alreadyBuzzed = !!myPlayerId && order.some(b => b.playerId === myPlayerId);

  // 自分の押下順・着差
  const sorted = order.slice().sort((a,b) => (a.at - b.at) || (a.recvAt - b.recvAt));
  const myRank = myPlayerId ? sorted.findIndex(b => b.playerId === myPlayerId) : -1;

  function ordinalShort(n) {
    const x = n % 100;
    if (x >= 11 && x <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }
  function fmtGapMs(ms) {
    if (!Number.isFinite(ms) || ms >= 10000) return null;
    return `+${(ms / 1000).toFixed(3)}s`;
  }
  function nextEligiblePlayerId(st, sorted) {
    const curIdx = Number(st.judge?.currentIndex ?? -1);
    if (curIdx < 0) return null;

    const cur = st.buzzer?.buzzOrder?.[curIdx];
    if (!cur) return null;

    const wrongSet = st.judge?.wrongSet || {};
    const curAt = cur.at;
    const curRecvAt = cur.recvAt;

    // "currentIndex の次" を sorted 基準で探す
    const startPos = sorted.findIndex(b => b.playerId === cur.playerId && b.at === curAt && b.recvAt === curRecvAt);
    for (let i = startPos + 1; i < sorted.length; i++) {
      const pid = sorted[i].playerId;
      if (!pid) continue;
      if (wrongSet[pid]) continue;

      const p = st.players?.[pid];
      const rest = Number(p?.restCount ?? 0);
      if (rest > 0) continue;
      if (p?.dq) continue;
      if (p?.qualified) continue;

      return pid;
    }
    return null;
  }

  // ボタン有効/無効（早稲田式）
  // - 判定中（回答権が誰かにある間）は全員押せない
  // - 自分がこの問題で誤答済みなら、その問題終了まで押せない
  // - 休み/勝ち抜け/失格は押せない
  // 結果表示だけは全モード共通でロック
  const bmRaw = String(st.rules?.buzzMode ?? "endless").toLowerCase();
  const buzzMode = (bmRaw === "cultq" || bmRaw === "cult" || bmRaw === "cartq") ? "cultq" :
                (bmRaw === "single") ? "single" :
                "endless";

  const isWronged = !!(myPlayerId && st.judge?.wrongSet?.[myPlayerId]);

  // カルトQ方式は「判定中は他の人が押せない」
  const isCultqLock = (buzzMode === "cultq") && (st.judge?.status === "in_progress" || st.phase === "locked");

  const canBuzz =
    st.buzzer.isOpen &&
    !isCultqLock &&
    !alreadyBuzzed &&
    restCount === 0 &&
    !isModDisabled &&
    !isQualified &&
    !isDq;

  if (rankEl) {
    if (idx === -1) {
      rankEl.textContent = "-";
    } else {
      const rank = idx + 1;
      rankEl.textContent = ordinalShort(rank);
    }
  }

    // ポイント順位（サーバー値があればそれを優先）
  if (pointRankEl) {
    const pr = computePointsRankFromPlayers(st.players, myPlayerId, st.ui?.playerOrder || []);
    pointRankEl.textContent =
      pr.rank == null ? "-" :
      pr.tied ? `T${ordinalShort(pr.rank)} / ${pr.total}` :
      `${ordinalShort(pr.rank)} / ${pr.total}`;
  }

    // ---- ボタン演出状態 ----
  const cur = getCurrentRespondent(st);
  const isCurrent = !!(cur && myPlayerId && cur.playerId === myPlayerId);
  const isAnswering = isCurrent && st.judge?.status === "in_progress";

  // インジケータ表示
  if (!joined) {
    // 接続前は名前プロンプト（指定）
    showNamePrompt();
    restEl.textContent = "あと0問";
    bigBtnLabel.textContent = "CONNECT";
    bigBtn.disabled = false; // 接続ボタンとして押せる
    return;
  }

  if (isQualified) {
    const r = Number(my.passRank ?? 0);
    setIndicatorText(r ? `QUALIFIED ${ordinal(r)}` : "QUALIFIED");
  } 
  else if (isDq) {
    setIndicatorText("DISQUALIFIED");
  }
  else if (isModDisabled) {
    setIndicatorText("CLEARED");
  }
  else if (alreadyBuzzed && myRank >= 0) {
    const r = myRank + 1;
    if (r === 1) {
      setIndicatorText(ordinalShort(r));           // 1st
    } else {
      const gap = sorted[0] ? (sorted[myRank].at - sorted[0].at) : null;
      const gapText = fmtGapMs(gap);
      setIndicatorText(gapText ? `${ordinalShort(r)} ${gapText}` : ordinalShort(r));
    }
  } 
  else {
    const isWronged = !!st.judge?.wrongSet?.[myPlayerId];

    // 結果表示だけは全モード共通でロック
    const isResultPhase = (st.phase === "result" || st.judge?.status === "result");

    // カルトQだけ「判定中ロック」扱い
    const isCultqLock =
      (buzzMode === "cultq") &&
      (st.judge?.status === "in_progress" || st.phase === "locked");

    const isLockedForUi = isResultPhase || isCultqLock;

    if (isWronged) {
      setIndicatorText("MISS");
    } else if (isAnswering) {
      setIndicatorText("ANSWER");
    } else if (!isLockedForUi && st.buzzer.isOpen && restCount === 0 && !alreadyBuzzed && !isModDisabled) {
      setIndicatorText("READY");
    } else {
      setIndicatorText("WAIT");
    }
  }

  bigBtnLabel.textContent =
    isAnswering ? "ANSWER" :
    canBuzz ? "PUSH" :
    (isModDisabled ? "CLEAR" :
    (restCount > 0 ? "REST" :
    (isWronged ? "MISS" :
    ((!isCultqLock && st.buzzer.isOpen && restCount === 0 && !alreadyBuzzed && !isModDisabled && !isQualified && !isDq) ? "READY" : "WAIT"))));

  bigBtn.disabled = !canBuzz;

  // 不正解（この問題で誤答した）
  const isWrong = !!(myPlayerId && st.judge?.wrongSet?.[myPlayerId]);

  // 正解（この問題の正解者）
  const isCorrect =
    !!(myPlayerId &&
      st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === myPlayerId);

  // 点滅：回答権（現在の解答者）で、正解/不正解ではない時
  const isBlink = isCurrent && !isCorrect && !isWrong;

  // 点灯
  const nextPid =
    (buzzMode === "endless" && st.judge?.status === "in_progress")
      ? nextEligiblePlayerId(st, sorted)
      : null;

  // 点灯するのは「次に回ってくる人」だけ
  const isLit =
    !!myPlayerId &&
    !!nextPid &&
    myPlayerId === nextPid &&
    st.phase !== "result" &&
    st.judge?.status !== "result"; 

  // disableは誤答と同じ暗さ（ただし正解/誤答の方が優先）
  const isDisabledDim =
    !isCorrect &&
    !isWrong &&
    (
      isWronged ||      // 誤答＝押せない
      restCount > 0 ||  // 休み＝押せない
      isModDisabled ||  // MODで勝ち抜け済み
      isQualified ||    // 勝ち抜け＝押せない
      isDq              // 失格＝押せない
    );

  // 不正解は暗く（優先）
  applyBtnState({
    isBlink,
    isLit,
    isWrong,
    isCorrect,
    isDisabledDim
  });
});
