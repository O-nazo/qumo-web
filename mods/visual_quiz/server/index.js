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
    if (st.phase !== "LOADED") return;
    st.phase = "REVEALED";
    st.lidOpen = true;
    st.showAnswer = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  ctx.on("VQ_OPEN", () => {
    st.lidOpen = true;
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
    st.qIndex = Math.min(st.qIndex + 1, st.questions.length - 1);
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
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
    if (st.phase !== "REVEALED") return;
    if (ev.rank !== 1) return;

    st.phase = "BUZZED";
    st.lidOpen = false;
    st.lastBuzzPlayerId = ev.playerId;
    emitState();
  });
}
