import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const modId = "visual_quiz";

// __dirname 相当（ESMでは自前で作る）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function registerVisualQuiz(ctx) {
  /** --------------------
   * static assets
   * ------------------- */
  const assetsDir = path.join(__dirname, "../assets");
  const base = `/mods/${modId}/assets`;

  ctx.app.use(base, express.static(assetsDir));
  console.log("[visual_quiz] static mounted:", base);

  /** --------------------
   * state
   * ------------------- */
  const st = {
    questions: [],
    qIndex: 0,

    phase: "LOADED", // LOADED | REVEALED | BUZZED | ANSWER | ENDED
    lidOpen: false,
    showAnswer: false,
    thinking: false,        // ★追加：シンキングBGMのON/OFF

    lastBuzzPlayerId: null
  };

  /** --------------------
   * utils
   * ------------------- */
  function emitState() {
    console.log("[visual_quiz] emitState", st.phase, st.qIndex);
    ctx.broadcast({
      type: "MOD_EVENT",
      modId,
      event: {
        type: "STATE",
        state: {
          ...st,
          current: st.questions[st.qIndex] || null
        }
      }
    });
  }

  function loadQuestions() {
    try {
      const p = path.join(
        __dirname,
        "../assets/q/questions.json"
      );
      const json = JSON.parse(fs.readFileSync(p, "utf-8"));
      st.questions = json;
      st.qIndex = 0;
      console.log("[visual_quiz] questions loaded:", json.length);
    } catch (e) {
      console.error("[visual_quiz] failed to load questions", e);
      st.questions = [];
    }
  }

  /** --------------------
   * init
   * ------------------- */
  loadQuestions();
  emitState();

  ctx.on("CLIENT_CONNECTED", emitState);
  ctx.on("MOD_ACTIVATED", emitState);

  /** --------------------
   * MOD commands
   * ------------------- */
  ctx.on("VQ_START", () => {
    // 初回 or 誤答後にもう一度見せたい時を許可
    if (st.phase !== "LOADED" && st.phase !== "BUZZED") return;
    ctx.coreSfx("thinking", { durationSec: Number(st.rules?.thinkingSeconds ?? 999999) });
    st.phase = "REVEALED";
    st.lidOpen = true;
    st.showAnswer = false;
    st.thinking = true;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  ctx.on("VQ_OPEN", () => {
    st.lidOpen = true;

    if (st.phase === "ENDED") {
      st.showAnswer = true;
    }

    emitState();
  });


  ctx.on("VQ_CLOSE", () => {
    st.lidOpen = false;
    emitState();
  });

  ctx.on("VQ_TOGGLE_ANSWER", () => {
    st.showAnswer = !st.showAnswer;
    emitState();
  });

  ctx.on("VQ_SKIP", () => {
    st.phase = "ENDED";
    st.lidOpen = false;
    emitState();
  });

  ctx.on("VQ_NEXT", () => {
    if (st.phase !== "ENDED" && st.phase !== "ANSWER") return;

    st.qIndex = Math.min(st.qIndex + 1, st.questions.length - 1);
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });


  ctx.on("VQ_SELECT_Q", (cmd) => {
    if (typeof cmd.qIndex !== "number") return;
    if (cmd.qIndex < 0 || cmd.qIndex >= st.questions.length) return;
    st.qIndex = cmd.qIndex;
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  /** --------------------
   * BUZZ
   * ------------------- */
  ctx.on("BUZZ", (ev) => {
    console.log("buzz");
    if (st.phase !== "REVEALED") return;
    if (ev.rank !== 1) return;

    ctx.coreSfx("thinking", { durationSec: 0 });
    st.phase = "BUZZED";
    st.lidOpen = false;
    st.thinking = false;      // ★追加
    st.lastBuzzPlayerId = ev.playerId;
    emitState();
  });

  // 正解：蓋を開けて答え表示
  ctx.on("JUDGE_CORRECT", () => {
    // 画像は見せて良い。答えも表示
    st.phase = "ANSWER";
    st.lidOpen = true;
    st.showAnswer = true;
    st.thinking = false;
    emitState();
  });

  // 誤答：蓋は閉じたまま。次にSTARTを押したら再オープンできる状態へ
  ctx.on("JUDGE_WRONG", () => {
    // 画像は隠す（そのまま）
    st.phase = "BUZZED";      // ★「再開待ち」扱い
    st.lidOpen = false;
    st.showAnswer = false;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  // スルー：問題終了状態へ
  ctx.on("JUDGE_SKIP", () => {
    st.phase = "ENDED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.thinking = false;
    emitState();
  });


}
