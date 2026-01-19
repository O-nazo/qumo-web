import { createClient } from "/common/common.js?v=20260108_01";

const indicatorEl = document.querySelector("#indicator");
const bigBtn = document.querySelector("#bigBtn");
const bigBtnLabel = document.querySelector("#bigBtnLabel");

// 右パネル
const nameEl = document.querySelector("#name");
const scoreEl = document.querySelector("#score");
const restEl = document.querySelector("#rest");
const rankEl = document.querySelector("#rank");
const gapEl = document.querySelector("#gap");
const pointRankEl = document.querySelector("#pointRank");
const wrongCountEl = document.querySelector("#wrongCount");

const client = createClient({ screen: "player", autoJoin: false });

let joined = false;
let joining = false;
let joinedAt = 0;

let gapDigits = 5;

let myPlayerId = null;
let myName = ""; // 未入力
let nameInputEl = null;
let isQualified = null;
let isDq = null;

client.onSelf(({ playerId }) => {
  myPlayerId = playerId;
  joined = true;
  joining = false;
  joinedAt = Date.now(); // 追加：JOIN直後ガード用
});

window.addEventListener("error", (e) => {
  indicatorEl.textContent = `ERR: ${e.message}`;
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message ?? String(e.reason);
  indicatorEl.textContent = `ERR: ${msg}`;
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
  indicatorEl.textContent = text;
}

function showNamePrompt() {
  // 指定：接続前は「(名前を入力>)」
  setIndicatorText(myName ? myName : "(名前を入力>)");
}

function commitNameIfEditing() {
  const input = indicatorEl.querySelector("input.indicatorInput");
  if (!input) return;

  const v = input.value.trim().slice(0, 20);
  myName = v;

  // 表示に戻す（既存の関数があるならそれを使ってOK）
  showNamePrompt();
  nameEl.textContent = myName || "-";

  // フォーカスを外してキーボードを閉じる
  input.blur();
}

function beginNameEdit() {
  if (joined) return; // 接続後は編集しない（必要なら外す）

  indicatorEl.innerHTML = "";
  const input = document.createElement("input");
  nameInputEl = input;
  input.type = "text";
  input.className = "indicatorInput";
  input.placeholder = "名前";
  input.value = myName;
  indicatorEl.appendChild(input);
  input.focus();
  input.select();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      finishNameEdit();
      input.blur(); // 追加：キーボードを閉じる
    }
    if (e.key === "Escape") {
      showNamePrompt();
      nameInputEl = null;
    }
  });

  input.addEventListener("blur", finishNameEdit);
}

function finishNameEdit() {
  if (!nameInputEl) return;
  const v = nameInputEl.value.trim().slice(0, 20);
  myName = v;
  nameInputEl = null;
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
  if (p.screen && p.screen !== "player") return false;
  if (p.role && p.role !== "player") return false;
  return true;
}

function computePointsRankFromPlayers(playersById, myPlayerId) {
  const list = Object.entries(playersById || {})
    .map(([id, p]) => ({ ...p, _id: id }))
    .filter(isPlayerLike);

  const total = list.length;
  if (!myPlayerId || total === 0) return { rank: null, total, tied: false, tieCount: 0 };

  const me =
    list.find((p) => p.playerId === myPlayerId) ||
    list.find((p) => p._id === myPlayerId);

  if (!me) return { rank: null, total, tied: false, tieCount: 0 };

  const myScore = getPlayerScore(me);

  const higherCount = list.filter((p) => getPlayerScore(p) > myScore).length;
  const rank = higherCount + 1; // 同点は同順位（dense）

  const tieCount = list.filter((p) => getPlayerScore(p) === myScore).length;
  const tied = tieCount >= 2;

  return { rank, total, tied, tieCount };
}

// インジケータクリックで名前入力
indicatorEl.addEventListener("click", beginNameEdit);
indicatorEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") beginNameEdit();
});

function handleBigBtn(e) {
  // blur(click消失)より先に確実に拾う
  e.preventDefault();
  e.stopPropagation();

  if (joined && Date.now() - joinedAt < 400) return;

  // 二重送信防止（pointerdown + touchstart 両方来る端末対策）
  if (e.type !== "click") {
    if (handleBigBtn._last && Date.now() - handleBigBtn._last < 250) return;
    handleBigBtn._last = Date.now();
  }

  // 入力中ならこの場で確定（blur待ちにしない）
  commitNameIfEditing();

  if (!joined) {
    if (joining) return;
    joining = true;

    const nameToSend = (myName || "Player").trim().slice(0, 20);
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
      indicatorEl.textContent = `WS state: ${ws.readyState}`;
    }

    client.join({ screen: "player", name: myName });
    return;

  }

  client.emit("BUZZ", {
    // サーバー側の期待キー：tPress（互換で at も受けるが統一）
    tPress: (typeof client.nowServerMs === "function") ? client.nowServerMs() : Date.now()
  });
}

// ★ここが肝：capture + pointerdown/touchstart
bigBtn.addEventListener("pointerdown", handleBigBtn, { capture: true, passive: false });
bigBtn.addEventListener("touchstart", handleBigBtn, { capture: true, passive: false });

// 初期表示
showNamePrompt();
nameEl.textContent = "-";

client.onState((st) => {
  // まだJOINしてない場合でもSTATEは来るのでUIは更新する
  const my = (myPlayerId && st.players) ? st.players[myPlayerId] : null;

  const score = Number(my?.score ?? 0);
  scoreEl.textContent = String(score);

  wrongCountEl.textContent = String(my?.wrongCount ?? 0);
  wrongCountEl.parentElement.style.display =
    st.ui?.showWrongCount !== false ? "" : "none";

  const restCount = Number(my?.restCount ?? 0);
  restEl.textContent = `休み あと${restCount}問`;

  const status = my?.status || "active";
  isQualified = status === "qualified";
  isDq = status === "disqualified";

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
    // +12.34ms みたいに2桁小数で
    return `+${ms.toFixed(2)}ms`;
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
    !isQualified &&
    !isDq;

  if (idx === -1) {
    rankEl.textContent = "-";
    gapEl.textContent = "-";
  } else {
    const rank = idx + 1;
    rankEl.textContent = `${rank}位`;
    if (rank >= 2 && st.buzzer.firstBuzz?.at != null) {
      const gap = order[idx].at - st.buzzer.firstBuzz.at;
      gapEl.textContent = `+${gap.toFixed(gapDigits)}ms`;
    } else {
      gapEl.textContent = "-";
    }
  }

    // ポイント順位（サーバー値があればそれを優先）
  if (pointRankEl) {
    const serverRank =
      (typeof my?.pointRank === "number") ? my.pointRank :
      (typeof my?.pointsRank === "number") ? my.pointsRank :
      null;

    const serverTotal =
      (typeof my?.pointRankTotal === "number") ? my.pointRankTotal :
      null;

    const serverTied =
      (typeof my?.pointRankTied === "boolean") ? my.pointRankTied :
      null;

    if (serverRank != null) {
      const total = serverTotal ?? Object.values(st.players || {}).filter(isPlayerLike).length;
      pointRankEl.textContent = serverTied ? `同率${serverRank}位 / ${total}` : `${serverRank}位 / ${total}`;
    } else {
      const pr = computePointsRankFromPlayers(st.players, myPlayerId);
      pointRankEl.textContent =
        pr.rank == null ? "-" :
        pr.tied ? `同率${pr.rank}位 / ${pr.total}` :
        `${pr.rank}位 / ${pr.total}`;
    }
  }

    // ---- ボタン演出状態 ----
  const cur = getCurrentRespondent(st);
  const isCurrent = !!(cur && myPlayerId && cur.playerId === myPlayerId);
  const isAnswering = isCurrent && st.judge?.status === "in_progress";

  // インジケータ表示
  if (!joined) {
    // 接続前は名前プロンプト（指定）
    showNamePrompt();
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
  else if (alreadyBuzzed && myRank >= 0) {
    const r = myRank + 1;
    if (r === 1) {
      setIndicatorText(ordinalShort(r));           // 1st
    } else {
      const gap = (sorted[myRank].at - sorted[0].at);
      setIndicatorText(`${ordinalShort(r)} ${fmtGapMs(gap)}`); // 2nd 
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
    } else if (!isLockedForUi && st.buzzer.isOpen && restCount === 0) {
      setIndicatorText("READY");
    } else {
      setIndicatorText("WAIT");
    }
  }

  bigBtnLabel.textContent =
    isAnswering ? "ANSWER" :
    canBuzz ? "PUSH" :
    (restCount > 0 ? "REST" :
    (isWronged ? "MISS" : "WAIT"));

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
