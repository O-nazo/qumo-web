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
    selectedQIndex: 0,

    phase: "LOADED", // LOADED | REVEALED | BUZZED | ANSWER | ENDED
    lidOpen: false,
    showAnswer: false,
    showQuestionText: true,
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
          current: typeof st.qIndex === "number" ? (st.questions[st.qIndex] || null) : null
        }
      }
    });
  }

  function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;

    function pushField() {
      row.push(field);
      field = "";
    }

    function pushRow() {
      if (row.length === 1 && row[0] === "" && rows.length === 0) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    }

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === "\"") {
          if (text[i + 1] === "\"") {
            field += "\"";
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === "\"") {
        inQuotes = true;
        continue;
      }

      if (ch === ",") {
        pushField();
        continue;
      }

      if (ch === "\n") {
        pushField();
        pushRow();
        continue;
      }

      if (ch === "\r") {
        continue;
      }

      field += ch;
    }

    pushField();
    if (row.length > 1 || row[0] !== "") {
      pushRow();
    }

    return rows;
  }

  function normalizeNo(value) {
    const n = Number(String(value ?? "").trim());
    if (!Number.isFinite(n)) return null;
    return String(Math.trunc(n));
  }

  function loadQuestionImageMap() {
    const imagesDir = path.join(__dirname, "../assets/q/images");
    const imageMap = new Map();
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const parsed = path.parse(entry.name);
      const normalized = normalizeNo(parsed.name);
      if (normalized == null) continue;

      if (!imageMap.has(normalized)) {
        imageMap.set(normalized, entry.name);
      }
    }

    return imageMap;
  }

  function loadQuestions() {
    try {
      const p = path.join(
        __dirname,
        "../assets/q/questions.csv"
      );
      const csvText = fs.readFileSync(p, "utf-8");
      const rows = parseCsv(csvText);
      const [header = [], ...dataRows] = rows;
      const columns = header.map((col) => String(col || "").trim());
      const imageMap = loadQuestionImageMap();

      st.questions = dataRows
        .filter((cols) => cols.some((value) => String(value || "").trim() !== ""))
        .map((cols) => {
          const raw = Object.fromEntries(
            columns.map((key, idx) => [key, String(cols[idx] ?? "").trim()])
          );
          const normalizedNo = normalizeNo(raw.no);

          return {
            no: Number(raw.no || 0),
            question: raw.question || "",
            answer: raw.answer || "",
            file: normalizedNo == null ? "" : (imageMap.get(normalizedNo) || "")
          };
        });
      st.qIndex = 0;
      st.selectedQIndex = st.questions.length > 0 ? 0 : null;
      console.log("[visual_quiz] questions loaded:", st.questions.length);
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

  function resetForPresent() {
    st.qIndex = null;
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = false;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    st.selectedQIndex = null;
  }

  /** --------------------
   * MOD commands
   * ------------------- */
  ctx.on("VQ_PRESENT", () => {
    resetForPresent();
    emitState();
  });

  ctx.on("VQ_START", () => {
    // 初回 or 誤答後にもう一度見せたい時を許可
    if (st.phase !== "LOADED" && st.phase !== "BUZZED") return;
    if (typeof st.qIndex !== "number" || !st.questions[st.qIndex]) return;

    ctx.coreSfx("thinking", {
      durationSec: Number(ctx.getState()?.rules?.thinkingSeconds ?? 999999)
    });
    st.phase = "REVEALED";
    st.lidOpen = true;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = true;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  ctx.on("VQ_OPEN", () => {
    st.lidOpen = true;
    st.showQuestionText = true;

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
    st.selectedQIndex = st.qIndex;
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });


  ctx.on("VQ_SELECT_Q", (cmd) => {
    if (typeof cmd.qIndex !== "number") return;
    if (cmd.qIndex < 0 || cmd.qIndex >= st.questions.length) return;
    st.qIndex = cmd.qIndex;
    st.selectedQIndex = cmd.qIndex;
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  /** --------------------
   * BUZZ
   * ------------------- */
  ctx.on("BUZZ", (ev) => {
    console.log("buzz");
    if (st.phase !== "REVEALED") return;
    if (st.lastBuzzPlayerId) return;

    st.phase = "BUZZED";
    st.lidOpen = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.lastBuzzPlayerId = ev.playerId;
    emitState();
  });

  // 正解：蓋を開けて答え表示
  ctx.on("JUDGE_CORRECT", () => {
    // 画像は見せて良い。答えも表示
    st.phase = "ANSWER";
    st.lidOpen = true;
    st.showAnswer = true;
    st.showQuestionText = true;
    st.thinking = false;
    emitState();
  });

  // 誤答：蓋は閉じたまま。次にSTARTを押したら再オープンできる状態へ
  ctx.on("JUDGE_WRONG", () => {
    // 画像は隠す（そのまま）
    st.phase = "BUZZED";      // ★「再開待ち」扱い
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  // スルー：問題終了状態へ
  ctx.on("JUDGE_SKIP", () => {
    st.phase = "ENDED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    emitState();
  });


}
