const crypto = require("crypto");
const { C2S, S2C } = require("./protocol");
const { getState, snapshot } = require("./stateStore");
const { getModRuntime } = require("./modRuntimeHub");

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const TUNNEL_FILE = path.resolve(process.cwd(), ".tunnel-url");

let cachedTunnelUrl = null;
let tunnelPollTimer = null;
let cleanupRegistered = false;

function genId(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

function resetBuzzer(st) {
  // 早稲田式：基本は常時受付（結果表示中だけ閉じる）
  st.buzzer.isOpen = true;
  st.buzzer.openedAt = Date.now();
  st.buzzer.firstBuzz = null;
  st.buzzer.buzzOrder = [];

  // 追加：先着確定の収集ウィンドウ
  st.buzzer.collectSeq = 0;
  st.buzzer.collectUntil = null;
}

function resetJudge(st) {
  st.judge.status = "idle";
  st.judge.currentIndex = 0;
  st.judge.wrongSet = {};
  st.judge.lastResult = null;
}

function getBuzzMode(st) {
  const m = String(st.rules?.buzzMode ?? "").toLowerCase();
  if (m === "cultq" || m === "cult" || m === "cartq") return "cultq";
  if (m === "single") return "single";
  if (m === "endless" || m === "all") return "endless";
  return "endless"; // デフォ
}

function pickNextRespondentIndex(st) {
  const wrongSet = st.judge?.wrongSet || {};
  const order = st.buzzer?.buzzOrder || [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i]?.playerId;
    if (!id) continue;
    if (wrongSet[id]) continue;
    if (!canBuzzNow(st, id)) continue;
    return i;
  }
  return -1;
}

function emitSfx(st, key, extra = {}) {
  if (!st.sfx) st.sfx = { nonce: 0, key: null, at: null, durationSec: null, chainKey: null };
  st.sfx.nonce = Number(st.sfx.nonce ?? 0) + 1;
  st.sfx.key = key;
  st.sfx.at = Date.now();
  st.sfx.durationSec = extra.durationSec ?? null; // thinking用
  st.sfx.chainKey = extra.chainKey ?? null;       // 連続再生用
}

function clampInt(n, min, max, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function recomputeScores(st) {
  const cp = clampInt(st.rules?.correctPoints, -1000, 1000000, 1);
  const wp = clampInt(st.rules?.wrongPoints, -1000, 1000000, -1);

  for (const p of Object.values(st.players || {})) {
    const c = clampInt(p.correctCount, 0, 1000000, 0);
    const w = clampInt(p.wrongCount, 0, 1000000, 0);
    p.correctCount = c;
    p.wrongCount = w;
    p.score = c * cp + w * wp;
  }
}

function recomputePlayerStatuses(st) {
  const rules = st.rules || {};

  const qualifyEnabled = !!rules.qualifyEnabled;
  const dqEnabled = !!rules.dqEnabled;
  const qualifyScore = clampInt(rules.qualifyScore, -1000, 1000000, 4);
  const dqScore = clampInt(rules.dqScore, -1000, 1000000, -3);

  const qualifyCountEnabled = !!rules.qualifyCountEnabled;
  const qualifyCorrectCount = clampInt(rules.qualifyCorrectCount, 0, 1000000, 4);

  const dqWrongEnabled = !!rules.dqWrongEnabled;
  const dqWrongCount = clampInt(rules.dqWrongCount, 0, 1000000, 3);

  const cp = clampInt(rules.correctPoints, -1000, 1000000, 1);
  const wp = clampInt(rules.wrongPoints, -1000, 1000000, -1);

  // 1) qualifiedAt / dqAt の付与・解除
  for (const p of Object.values(st.players || {})) {
    const score = Number(p.score ?? 0);
    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);

    const isQualify =
      (qualifyEnabled && score >= qualifyScore) ||
      (qualifyCountEnabled && correctCount >= qualifyCorrectCount);

    const isDq =
      (dqEnabled && score <= dqScore) ||
      (dqWrongEnabled && wrongCount >= dqWrongCount);

    // 同時成立は失格優先
    if (isDq) {
      if (!p.dqAt) p.dqAt = Date.now();
      p.qualifiedAt = null;
    } else {
      p.dqAt = null;
      if (isQualify) {
        if (!p.qualifiedAt) p.qualifiedAt = Date.now();
      } else {
        p.qualifiedAt = null;
      }
    }
  }

  // 2) 勝ち抜け順位
  const qualified = Object.values(st.players || {})
    .filter(p => p.qualifiedAt)
    .sort((a, b) => a.qualifiedAt - b.qualifiedAt);

  qualified.forEach((p, idx) => { p.passRank = idx + 1; });
  for (const p of Object.values(st.players || {})) {
    if (!p.qualifiedAt) p.passRank = null;
  }

  // 3) status と reach
  const qualifyReachEnabled = !!rules.qualifyReachEnabled;
  const dqReachEnabled = !!rules.dqReachEnabled;

  for (const p of Object.values(st.players || {})) {
    const score = Number(p.score ?? 0);
    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);

    const isQualified = !!p.qualifiedAt;
    const isDisqualified = !!p.dqAt;

    if (isDisqualified) p.status = "disqualified";
    else if (isQualified) p.status = "qualified";
    else p.status = "active";

    p.reach = { qualify: false, dq: false };

    if (p.status === "active") {
      if (qualifyEnabled && qualifyReachEnabled) {
        if (score + cp >= qualifyScore) p.reach.qualify = true;
      }
      if (qualifyCountEnabled && qualifyReachEnabled) {
        if (correctCount + 1 >= qualifyCorrectCount) p.reach.qualify = true;
      }

      if (dqEnabled && dqReachEnabled) {
        if (score + wp <= dqScore) p.reach.dq = true;
      }
      if (dqWrongEnabled && dqReachEnabled) {
        if (wrongCount + 1 >= dqWrongCount) p.reach.dq = true;
      }
    }
  }
}

function recomputeFirstBuzz(st) {
  const first = st.buzzer.buzzOrder[0] ?? null;
  st.buzzer.firstBuzz = first ? { playerId: first.playerId, at: first.at } : null;
}

function consumeRestForThisQuestion(st) {
  // この問題で「休み状態だった人」だけ 1 消費（=restCount--）
  for (const p of Object.values(st.players || {})) {
    if (Number(p.restCount ?? 0) > 0) {
      p.restCount = Math.max(0, Number(p.restCount) - 1);
    }
  }
}

function applyPendingRestForNextQuestion(st) {
  // 次問開始時に pendingRestAdd を restCount に加算
  for (const p of Object.values(st.players || {})) {
    const add = Number(p.pendingRestAdd ?? 0);
    if (add > 0) {
      p.restCount = Number(p.restCount ?? 0) + add;
      p.pendingRestAdd = 0;
    }
  }
}

function setResult(st, result) {
  st.judge.status = "result";
  st.judge.lastResult = result;
  st.phase = "result";
  st.buzzer.isOpen = false; // 結果確定時は受付停止

  // 問題消化タイミングで休みを消費（誤答罰は pending なのでここでは減らない）
  consumeRestForThisQuestion(st);
}

function startQuestion(st, { increment = false } = {}) {
  if (increment) st.questionNo = Number(st.questionNo ?? 1) + 1;

  // 次問開始：pending を restCount に反映
  applyPendingRestForNextQuestion(st);

  resetBuzzer(st);
  resetJudge(st);

  st.phase = "open";
  st.buzzer.isOpen = true;
  st.buzzer.openedAt = Date.now();
}

function hasAnyEligiblePlayer(st) {
  const wrongSet = st.judge?.wrongSet || {};
  return Object.values(st.players || {}).some((p) => {
    const id = p.id;
    if (!id) return false;
    if (Number(p.restCount ?? 0) > 0) return false;
    if (wrongSet[id]) return false;
    const status = p.status || "active";
    if (status === "qualified" || status === "disqualified") return false;
    return true;
  });
}

function getCurrentRespondent(st) {
  if (st.judge.status !== "in_progress") return null;
  return st.buzzer.buzzOrder[st.judge.currentIndex] ?? null;
}

function canBuzzNow(st, playerId) {
  const p = st.players?.[playerId];
  if (!p) return false;
  if (Number(p.restCount ?? 0) > 0) return false; // 休み中は回答権なし
  if (st.judge?.wrongSet?.[playerId]) return false; // この問題で誤答した人は押せない
  if (p.status === "qualified" || p.status === "disqualified") return false; // 勝ち抜けor失格は押せない
  return true;
}

/* URL関連 */
function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}

function readTunnelUrlIfReady() {
  try {
    const u = fs.readFileSync(TUNNEL_FILE, "utf8").trim();
    if (u.startsWith("https://") && u.includes(".trycloudflare.com")) return u;
  } catch {}
  return null;
}

function readTunnelUrl() {
try {
  const p = path.resolve(process.cwd(), ".tunnel-url");
  const u = fs.readFileSync(p, "utf8").trim();
  return u.startsWith("https://") ? u : null;
} catch {
  return null;
}
}

function createWsServer(httpServer) {
  const { WebSocketServer } = require("ws");
  const wss = new WebSocketServer({ server: httpServer });

  const sockets = new Set();

  // 早稲田式：問題進行はサーバーで自動化
  let autoNextTimer = null;

  function scheduleNextQuestion() {
    const st = getState();

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
      broadcastState();
    }, delayMs);
  }

  function ensureInitialized() {
    const st = getState();
    if (!st.rules) st.rules = {};
    if (!st.players) st.players = {};
    if (!st.buzzer) st.buzzer = {};
    if (!st.judge) st.judge = {};
    if (st.rules.autoNextEnabled == null) st.rules.autoNextEnabled = false; // デフォ: 手動
    if (st.rules.autoNextDelayMs == null) st.rules.autoNextDelayMs = 800;   // 自動ON時の待ち
    if (!st.ui) st.ui = {};
    if (st.ui.showScore == null) st.ui.showScore = true;
    if (st.ui.showWrongCount == null) st.ui.showWrongCount = true;
    if (st.ui.showMarks == null) st.ui.showMarks = false;
    if (st.ui.showMarkCorrect == null) st.ui.showMarkCorrect = true;
    if (st.ui.showMarkWrong == null) st.ui.showMarkWrong = true;

    if (st.ui.joinQrVisible == null) st.ui.joinQrVisible = false;
    if (st.ui.joinQrTargetUrl == null) st.ui.joinQrTargetUrl = null;
    if (st.ui.joinQrDataUrl == null) st.ui.joinQrDataUrl = null;

    if (st.questionNo == null) st.questionNo = 1;

    // 初期状態：即受付
    if (!st.phase || st.phase === "lobby") {
      startQuestion(st, { increment: false });
    }
  }

  ensureInitialized();

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
    tunnelPollTimer = setInterval(() => {
      const u = readTunnelUrlIfReady();
      if (!u) return;

      if (u !== cachedTunnelUrl) {
        cachedTunnelUrl = u;
        broadcastState(); // ここで controller に即反映させる
      }

      clearInterval(tunnelPollTimer);
      tunnelPollTimer = null;
    }, 200);
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

  function broadcastState() {
    ensureInitialized();
    const st = snapshot();
    st.publicBaseUrl = cachedTunnelUrl; // 追加
    broadcast({ type: S2C.STATE, state: st });
  }

  function clampRulePoints(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(-1000, Math.min(1000000, Math.trunc(x)));
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
          const name = String(sanitizeName(msg.name) || "Player").slice(0, 20);
          const playerId = genId(6);
          ws.meta.playerId = playerId;

          st.players[playerId] = {
            id: playerId,
            name,
            correctCount: 0,
            wrongCount: 0,
            score: 0,
            restCount: 0,
            pendingRestAdd: 0
          };

          send(ws, { type: S2C.SELF, playerId });
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
        broadcastState();
        return;
      }

      // 早押しルール切替
      if (type === (C2S.SET_BUZZ_MODE || "SET_BUZZ_MODE")) {
        if (ws.meta.screen !== "controller") return;

        const mode = getBuzzMode({ rules: { buzzMode: msg.buzzMode } });
        st.rules.buzzMode = mode;

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
        
        broadcastState();
        return;
      }

      if (type === C2S.BUZZER_OPEN) {
        if (ws.meta.screen !== "controller") return;
        // 結果表示中なら次問へ、そうでなければ同じ問を受付再開
        startQuestion(st, { increment: (st.judge?.status === "result" || st.phase === "result") });
        broadcastState();
        return;
      }

      if (type === C2S.BUZZER_RESET) {
        if (ws.meta.screen !== "controller") return;
        startQuestion(st, { increment: false });
        broadcastState();
        return;
      }

      if (type === C2S.NEXT_QUESTION) {
        if (ws.meta.screen !== "controller") return;

        // 追加: 自動遷移の予約があればキャンセル（手動が優先）
        if (autoNextTimer) {
          clearTimeout(autoNextTimer);
          autoNextTimer = null;
        }

        startQuestion(st, { increment: true });
        broadcastState();
        return;
      }

      if (type === (C2S.SET_AUTO_NEXT || "SET_AUTO_NEXT")) {
        if (ws.meta.screen !== "controller") return;

        st.rules.autoNextEnabled = !!msg.enabled;

        const d = Number(msg.delayMs);
        st.rules.autoNextDelayMs = Number.isFinite(d) ? Math.max(0, Math.min(10000, Math.floor(d))) : 800;

        broadcastState();
        return;
      }

      if (type === C2S.JUDGE_CORRECT) {
        if (ws.meta.screen !== "controller") return;

        const cur = getCurrentRespondent(st);
        if (!cur) return;

        const p = st.players[cur.playerId];
        if (p) {
          p.correctCount = Number(p.correctCount ?? 0) + 1;
        }
        recomputeScores(st);

        emitSfx(st, "correct");
        recomputePlayerStatuses(st);
        setResult(st, { type: "correct", playerId: cur.playerId });
        broadcastState();
        scheduleNextQuestion();
        return;
      }

      if (type === C2S.JUDGE_WRONG) {
        if (ws.meta.screen !== "controller") return;

        const cur = getCurrentRespondent(st);
        if (!cur) return;

        const p = st.players[cur.playerId];
        if (p) {
          p.wrongCount = Number(p.wrongCount ?? 0) + 1;
        }
        recomputeScores(st);

        // 誤答罰：次問から休みを付与
        const penalty = Number(st.rules?.restPenalty ?? 0);
        if (penalty > 0) {
          const p = st.players[cur.playerId];
          if (p) p.pendingRestAdd = Number(p.pendingRestAdd ?? 0) + penalty;
        }

        st.judge.wrongSet[cur.playerId] = true;

        const buzzMode = getBuzzMode(st);

        if (buzzMode === "single") {
          emitSfx(st, "wrong");
          setResult(st, { type: "single_wrong", playerId: cur.playerId });
          broadcastState();
          scheduleNextQuestion();
          return;
        } 
        else if (buzzMode === "endless") {
          const nextIdx = pickNextRespondentIndex(st);

          if (nextIdx >= 0) {
            // すでに押している人の中で次がいる → その人へ回答権
            emitSfx(st, "wrong", { chainKey: "buzzer" });
            st.judge.status = "in_progress";
            st.judge.currentIndex = nextIdx;
            st.phase = "locked";
            broadcastState();
            return;
          }

          // まだ次の押下者がいない → 受付に戻して押下待ち（buzzOrderは保持）
          if (!hasAnyEligiblePlayer(st)) {
            emitSfx(st, "wrong");
            setResult(st, { type: "all_wrong" });
            broadcastState();
            scheduleNextQuestion();
            return;
          }

          emitSfx(st, "wrong");
          st.judge.status = "idle";
          st.phase = "open";
          st.buzzer.isOpen = true;
          broadcastState();
          return;
        }
        else if(buzzMode === "cultq")
        {
          if (!hasAnyEligiblePlayer(st)) {
            emitSfx(st, "wrong");
            setResult(st, { type: "all_wrong" });
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
          broadcastState();
          return;
        }
        return;
      }

      if (type === C2S.JUDGE_SKIP) {
        if (ws.meta.screen !== "controller") return;

        emitSfx(st, "skip");

        setResult(st, { type: "skip" });
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

        broadcastState();
        return;
      }

      if (type === C2S.SET_THINKING_SECONDS) {
        if (ws.meta.screen !== "controller") return;

        const n = Number(msg.thinkingSeconds);
        const clamped = Number.isFinite(n) ? Math.max(0, Math.min(60, Math.floor(n))) : 0;
        st.rules.thinkingSeconds = clamped;

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

        p.correctCount = c;
        p.wrongCount = w;

        recomputeScores(st);
        recomputePlayerStatuses(st);
        broadcastState();
        return;
      }
      if (type === "SET_RULE_POINTS") {
        if (ws.meta.screen !== "controller") return;

        st.rules.correctPoints = clampRulePoints(msg.correctPoints);
        st.rules.wrongPoints = clampRulePoints(msg.wrongPoints);

        recomputeScores(st);
        recomputePlayerStatuses(st);
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
        broadcastState();
        return;
      }
      if (type === "SET_RULE_COUNTS") {
        st.rules.qualifyCountEnabled = !!msg.qualifyCountEnabled;
        st.rules.qualifyCorrectCount = Number(msg.qualifyCorrectCount ?? 0);

        st.rules.dqWrongEnabled = !!msg.dqWrongEnabled;
        st.rules.dqWrongCount = Number(msg.dqWrongCount ?? 0);

        recomputePlayerStatuses(st);
        broadcastState();
        return;
      }

      if (type === "SET_UI_PREFS") {
        st.ui = st.ui || {};

        st.ui.showScore = msg.showScore !== false;
        st.ui.showWrongCount = msg.showWrongCount !== false;
        st.ui.showMarks = !!msg.showMarks;
        st.ui.showMarkCorrect = msg.showMarkCorrect !== false;
        st.ui.showMarkWrong = msg.showMarkWrong !== false;

        broadcastState();
        return;
      }
      if (type === "AC_RESET") {
        if (ws.meta.screen !== "controller") return;

        for (const p of Object.values(st.players || {})) {
          p.correctCount = 0;
          p.wrongCount = 0;
          p.score = 0;

          p.qualifiedAt = null;
          p.dqAt = null;
          p.passRank = null;
          p.status = "active";
          p.reach = { qualify: false, dq: false };

          p.restCount = 0;
          p.pendingRestAdd = 0;
        }
        recomputeScores(st);

        // 問題中の判定も安全側でリセット（おすすめ）
        resetBuzzer(st);
        resetJudge(st);
        st.phase = "lobby";

        recomputePlayerStatuses(st);
        broadcastState();
        return;
      }
      if (type === "SET_JOIN_QR_VISIBLE") {
        if (ws.meta.screen !== "controller") return;

        const visible = !!msg.visible;
        st.ui = st.ui || {};
        st.ui.joinQrVisible = visible;

        const base = readTunnelUrl();
        const targetUrl = base ? `${base}` : null;

        // まずは即時反映（visibleだけ先に反映）
        st.ui.joinQrTargetUrl = targetUrl;
        st.ui.joinQrDataUrl = null;
        broadcastState();

        // ON かつ URLが取れている時だけ、非同期でQR生成→完成後に再配信
        if (visible && targetUrl) {
          QRCode.toDataURL(targetUrl, { margin: 1, width: 360 })
            .then((dataUrl) => {
              const st2 = getState();
              st2.ui = st2.ui || {};
              // 生成中にOFFになってたら上書きしない（事故防止）
              if (!st2.ui.joinQrVisible) return;
              st2.ui.joinQrTargetUrl = targetUrl;
              st2.ui.joinQrDataUrl = dataUrl;
              broadcastState();
            })
            .catch(() => {
              // 失敗しても visible 状態は維持（visualizer側で「生成失敗」表示も可）
            });
        }
        return;
      }

      // --- Player操作 ---
      if (type === C2S.BUZZ) {
        if (ws.meta.screen !== "player" || !ws.meta.playerId) return;

        // 結果表示中は押せない
        if (st.phase === "result" || st.judge?.status === "result") return;

        if (!st.buzzer.isOpen) return;

        const playerId = ws.meta.playerId;

        const buzzMode = getBuzzMode(st);
        if (buzzMode === "cultq" && st.judge?.status === "in_progress") return;

        // 休み中は押せない
        if (!canBuzzNow(st, playerId)) return;

        // 受信時刻
        const recvAt = Date.now();

        // 押下時刻（クライアント同梱があれば採用。ただしズレが大きい時は無視）
        let at = recvAt;
        const tPress = Number(msg.tPress ?? msg.at);
        const MAX_SKEW_MS = 500;
        if (Number.isFinite(tPress) && Math.abs(tPress - recvAt) <= MAX_SKEW_MS) at = tPress;

        // ★重複ガードは「push前」
        // 同一問で同じ人が2回以上押すのは無視（多重発火・連打対策）
        if (st.buzzer?.buzzOrder?.some(b => b.playerId === playerId)) {
          return;
        }

        // ★ここで1回だけ記録
        st.buzzer.buzzOrder.push({ playerId, at, recvAt });

        // 着順・着差のために常に時刻順に整列
        st.buzzer.buzzOrder.sort((a, b) => (a.at - b.at) || (a.recvAt - b.recvAt));
        recomputeFirstBuzz(st);

        // ここから「このBUZZで回答者が立つか？」を判定
        const wrongSet = st.judge?.wrongSet || {};
        const existsUnwrongedPlayer = Object.values(st.players || {}).some(
          p => !wrongSet[p.id]
        );

        // 「回答者がいない」かつ「まだ誤答してない人がいる」なら、回答開始（buzzer）
        const willStartResponding =
          st.judge?.status !== "in_progress" &&
          existsUnwrongedPlayer;

        if (willStartResponding) {
          const nextIdx = pickNextRespondentIndex(st);
          if (nextIdx >= 0) {
            st.phase = "locked";
            st.judge.status = "in_progress";
            st.judge.currentIndex = nextIdx;
            st.judge.lastResult = null;
            emitSfx(st, "buzzer");
          }

          broadcastState();
          return;
        }

        // それ以外は「2着以下の押下音（push）」
        // ※この時点で「この押下の順位」が確定している
        const idx = st.buzzer.buzzOrder.findIndex(b => b.playerId === playerId);
        if (idx >= 1) {
          emitSfx(st, "push");
        }

        broadcastState();
        return;
      }

      if (type === C2S.SET_ACTIVE_MOD) {
        if (ws.meta.screen !== "controller") return;

        const modIdRaw = String(msg.modId || "").trim();

        // ★ 解除（Reset）
        if (modIdRaw === "") {
          st.mods.active = null;
          broadcastState();
          broadcast({ type: S2C.RELOAD });
          return;
        }

        // ★ 適用（Apply）
        if (!st.mods?.available?.includes(modIdRaw)) {
          send(ws, { type: S2C.ERROR, error: "Unknown MOD" });
          return;
        }

        st.mods.active = modIdRaw;
        const active = String(getState()?.mods?.active || "");
        if (active) {
          getModRuntime()?.emit?.(active, "MOD_ACTIVATED", {});
        }
        broadcastState();
        broadcast({ type: S2C.RELOAD });
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

        const rt = getModRuntime();
        rt?.emit?.(modId, cmd.type, cmd);
        return;
      }

      // visualizer(QUMO_MOD_API.dispatch) -> server -> mod(server/index.js)
      if (type === "MOD_DISPATCH") {
        const action = msg?.action;
        if (!action || typeof action.type !== "string") return;

        const st = getState();
        const modId = String(st?.mods?.active || "");
        if (!modId) return;

        const rt = getModRuntime();
        if (rt?.emit) {
          rt.emit(modId, "DISPATCH", action);
        }
        return;
      }

      send(ws, { type: S2C.ERROR, error: `Unknown type: ${type}` });
    });

    ws.on("close", () => {
      sockets.delete(ws);

      const st = getState();

      if (ws.meta?.screen === "player" && ws.meta.playerId) {
        const playerId = ws.meta.playerId;

        if (st.players && st.players[playerId]) delete st.players[playerId];

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
