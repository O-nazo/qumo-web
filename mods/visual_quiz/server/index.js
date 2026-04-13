import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const modId = "visual_quiz";
const VISUAL_QUIZ_THINKING_LOOP_SECONDS = 60 * 60 * 24;
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);

// __dirname 相当（ESMでは自前で作る）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveAssetsDir() {
  const portableBase = process.env.PORTABLE_EXECUTABLE_DIR;
  const portableAssetsDir = portableBase
    ? path.join(portableBase, "mods", modId, "assets")
    : null;
  const localAssetsDir = path.join(__dirname, "../assets");

  if (portableAssetsDir && fs.existsSync(portableAssetsDir)) {
    return portableAssetsDir;
  }
  return localAssetsDir;
}

export default function registerVisualQuiz(ctx) {
  /** --------------------
   * static assets
   * ------------------- */
  const assetsDir = resolveAssetsDir();
  const base = `/mods/${modId}/assets`;

  ctx.app.use(base, ctx.express.static(assetsDir));
  console.log("[visual_quiz] static mounted:", base);

  /** --------------------
   * state
   * ------------------- */
  const st = {
    sets: [],
    setId: null,
    questions: [],
    qIndex: 0,
    selectedQIndex: 0,

    phase: "LOADED", // LOADED | REVEALED | BUZZED | ANSWER | ENDED
    lidOpen: false,
    showAnswer: false,
    showQuestionText: true,
    thinking: false,        // ★追加：シンキングBGMのON/OFF
    rewindNonce: 0,
    mediaControlNonce: 0,
    mediaControlAction: null,
    mediaSeekTimeSec: 0,
    mediaPlayback: {
      isVideo: false,
      paused: true,
      currentTime: 0,
      duration: 0,
      mediaKey: ""
    },
    instantCloseNonce: 0,

    lastBuzzPlayerId: null
  };
  const qRootDir = path.join(assetsDir, "q");
  let reloadTimer = null;
  let rootWatcher = null;
  let activeSetDirWatcher = null;
  let activeImagesDirWatcher = null;

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

  function normalizeSetId(value) {
    const raw = String(value ?? "").trim();
    return /^\d+$/.test(raw) ? String(Number.parseInt(raw, 10)) : null;
  }

  function getMediaKindByExt(ext) {
    return VIDEO_EXTENSIONS.has(String(ext || "").toLowerCase()) ? "video" : "image";
  }

  function parseMediaKey(name) {
    const match = String(name || "").trim().match(/^(\d+)(A)?$/i);
    if (!match) return null;
    return {
      no: String(Number.parseInt(match[1], 10)),
      isAnswer: !!match[2]
    };
  }

  function getSetMediaUrl(setId, fileName) {
    return `${base}/q/${encodeURIComponent(String(setId))}/images/${encodeURIComponent(String(fileName))}`;
  }

  function listQuestionSets() {
    if (!fs.existsSync(qRootDir)) return [];
    const entries = fs.readdirSync(qRootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const setId = normalizeSetId(entry.name);
        if (!setId) return null;
        const setDir = path.join(qRootDir, entry.name);
        const csvPath = path.join(setDir, "questions.csv");
        if (!fs.existsSync(csvPath)) return null;
        return {
          id: setId,
          label: setId,
          dir: setDir
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  function loadQuestionMediaMaps(setId) {
    const imagesDir = path.join(qRootDir, String(setId), "images");
    const promptMediaMap = new Map();
    const answerMediaMap = new Map();
    if (!fs.existsSync(imagesDir)) {
      return { promptMediaMap, answerMediaMap };
    }
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const parsed = path.parse(entry.name);
      const mediaKey = parseMediaKey(parsed.name);
      if (!mediaKey) continue;

      const media = {
        file: entry.name,
        kind: getMediaKindByExt(parsed.ext),
        url: getSetMediaUrl(setId, entry.name)
      };

      if (mediaKey.isAnswer) {
        if (!answerMediaMap.has(mediaKey.no)) {
          answerMediaMap.set(mediaKey.no, media);
        }
      } else if (!promptMediaMap.has(mediaKey.no)) {
        promptMediaMap.set(mediaKey.no, media);
      }
    }

    return { promptMediaMap, answerMediaMap };
  }

  function loadQuestionsForSet(setId) {
    try {
      if (!setId) {
        st.questions = [];
        st.qIndex = null;
        st.selectedQIndex = null;
        return;
      }
      const p = path.join(qRootDir, String(setId), "questions.csv");
      const csvText = fs.readFileSync(p, "utf-8");
      const rows = parseCsv(csvText);
      const [header = [], ...dataRows] = rows;
      const columns = header.map((col) => String(col || "").trim());
      const { promptMediaMap, answerMediaMap } = loadQuestionMediaMaps(setId);

      st.questions = dataRows
        .filter((cols) => cols.some((value) => String(value || "").trim() !== ""))
        .map((cols) => {
          const raw = Object.fromEntries(
            columns.map((key, idx) => [key, String(cols[idx] ?? "").trim()])
          );
          const normalizedNo = normalizeNo(raw.no);
          const promptMedia = normalizedNo == null ? null : (promptMediaMap.get(normalizedNo) || null);
          const answerMedia = normalizedNo == null ? null : (answerMediaMap.get(normalizedNo) || null);

          return {
            no: Number(raw.no || 0),
            question: raw.question || "",
            answer: raw.answer || "",
            file: promptMedia?.file || "",
            mediaKind: promptMedia?.kind || "image",
            promptMedia,
            answerMedia,
            setId: String(setId)
          };
        });
      st.qIndex = st.questions.length > 0 ? 0 : null;
      st.selectedQIndex = st.questions.length > 0 ? 0 : null;
      console.log("[visual_quiz] questions loaded:", setId, st.questions.length);
    } catch (e) {
      console.error("[visual_quiz] failed to load questions", setId, e);
      st.questions = [];
      st.qIndex = null;
      st.selectedQIndex = null;
    }
  }

  function refreshQuestionSets({ preserveSelection = true } = {}) {
    const previousSetId = preserveSelection ? st.setId : null;
    const sets = listQuestionSets();
    st.sets = sets.map(({ id, label }) => ({ id, label }));
    const nextSetId = sets.some((set) => set.id === previousSetId)
      ? previousSetId
      : (sets[0]?.id ?? null);

    if (nextSetId !== st.setId) {
      st.setId = nextSetId;
      loadQuestionsForSet(nextSetId);
      resetForPresent();
    } else if (nextSetId) {
      const previousQuestionNo =
        typeof st.selectedQIndex === "number" ? st.questions[st.selectedQIndex]?.no : null;
      loadQuestionsForSet(nextSetId);
      if (previousQuestionNo != null) {
        const nextIndex = st.questions.findIndex((q) => Number(q.no) === Number(previousQuestionNo));
        if (nextIndex >= 0) {
          st.qIndex = nextIndex;
          st.selectedQIndex = nextIndex;
        }
      }
    } else {
      st.questions = [];
      st.qIndex = null;
      st.selectedQIndex = null;
    }
  }

  function closeWatcher(watcher) {
    if (!watcher) return null;
    try {
      watcher.close();
    } catch {}
    return null;
  }

  function scheduleRefreshAndEmit() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      refreshQuestionSets({ preserveSelection: true });
      emitState();
      watchActiveSet();
    }, 120);
  }

  function watchDir(dirPath, onChange) {
    if (!dirPath || !fs.existsSync(dirPath)) return null;
    try {
      return fs.watch(dirPath, { persistent: false }, onChange);
    } catch (e) {
      console.warn("[visual_quiz] watch failed:", dirPath, e);
      return null;
    }
  }

  function watchActiveSet() {
    activeSetDirWatcher = closeWatcher(activeSetDirWatcher);
    activeImagesDirWatcher = closeWatcher(activeImagesDirWatcher);
    if (!st.setId) return;

    const setDir = path.join(qRootDir, String(st.setId));
    const imagesDir = path.join(setDir, "images");
    activeSetDirWatcher = watchDir(setDir, scheduleRefreshAndEmit);
    activeImagesDirWatcher = watchDir(imagesDir, scheduleRefreshAndEmit);
  }

  /** --------------------
   * init
   * ------------------- */
  refreshQuestionSets({ preserveSelection: false });
  rootWatcher = watchDir(qRootDir, scheduleRefreshAndEmit);
  watchActiveSet();
  emitState();

  ctx.on("CLIENT_CONNECTED", emitState);
  ctx.on("MOD_ACTIVATED", emitState);
  ctx.on("VQ_SYNC_STATE", emitState);

  function resetForPresent() {
    const keepSelectedQIndex =
      typeof st.qIndex === "number" ? st.qIndex : st.selectedQIndex;
    st.qIndex = typeof keepSelectedQIndex === "number" ? keepSelectedQIndex : null;
    st.phase = "LOADED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.rewindNonce = 0;
    st.lastBuzzPlayerId = null;
    st.selectedQIndex = typeof keepSelectedQIndex === "number" ? keepSelectedQIndex : null;
  }

  /** --------------------
   * MOD commands
   * ------------------- */
  ctx.on("VQ_PRESENT", () => {
    resetForPresent();
    emitState();
  });

  ctx.on("VQ_SELECT_SET", (cmd) => {
    const nextSetId = normalizeSetId(cmd?.setId);
    if (!nextSetId) return;
    if (!st.sets.some((set) => set.id === nextSetId)) return;
    if (nextSetId === st.setId) return;
    st.setId = nextSetId;
    loadQuestionsForSet(nextSetId);
    resetForPresent();
    watchActiveSet();
    emitState();
  });

  ctx.on("VQ_START", () => {
    // 初回 or 誤答後にもう一度見せたい時を許可
    if (st.phase !== "LOADED" && st.phase !== "BUZZED") return;
    if (typeof st.qIndex !== "number" || !st.questions[st.qIndex]) return;

    if (st.questions[st.qIndex]?.promptMedia?.kind !== "video") {
      ctx.coreSfx("thinking", {
        durationSec: VISUAL_QUIZ_THINKING_LOOP_SECONDS
      });
    }
    st.phase = "REVEALED";
    st.lidOpen = true;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = st.questions[st.qIndex]?.promptMedia?.kind !== "video";
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

  ctx.on("VQ_REWIND", () => {
    st.rewindNonce = Number(st.rewindNonce ?? 0) + 1;
    emitState();
  });

  ctx.on("VQ_MEDIA_PLAY", () => {
    st.mediaControlNonce = Number(st.mediaControlNonce ?? 0) + 1;
    st.mediaControlAction = "play";
    emitState();
  });

  ctx.on("VQ_MEDIA_PAUSE", () => {
    st.mediaControlNonce = Number(st.mediaControlNonce ?? 0) + 1;
    st.mediaControlAction = "pause";
    emitState();
  });

  ctx.on("VQ_MEDIA_TOGGLE", () => {
    st.mediaControlNonce = Number(st.mediaControlNonce ?? 0) + 1;
    st.mediaControlAction = "toggle";
    emitState();
  });

  ctx.on("VQ_MEDIA_SEEK", (cmd) => {
    const timeSec = Number(cmd?.timeSec);
    if (!Number.isFinite(timeSec)) return;
    st.mediaControlNonce = Number(st.mediaControlNonce ?? 0) + 1;
    st.mediaControlAction = "seek";
    st.mediaSeekTimeSec = Math.max(0, timeSec);
    emitState();
  });

  ctx.on("VQ_TOGGLE_ANSWER", () => {
    st.showAnswer = !st.showAnswer;
    if (st.showAnswer) {
      st.lidOpen = true;
    }
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
    st.instantCloseNonce = Number(st.instantCloseNonce ?? 0) + 1;
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
    st.phase = "BUZZED";
    st.lidOpen = false;
    st.showAnswer = false;
    st.showQuestionText = true;
    st.thinking = false;
    st.lastBuzzPlayerId = null;
    emitState();
  });

  ctx.on("DISPATCH", (action) => {
    if (!action || typeof action.type !== "string") return;

    if (action.type === "VQ_MEDIA_STATUS") {
      const currentTime = Math.max(0, Number(action.currentTime) || 0);
      const duration = Math.max(0, Number(action.duration) || 0);
      const paused = action.paused !== false;
      const isVideo = action.isVideo === true;
      const mediaKey = String(action.mediaKey || "");
      const prev = st.mediaPlayback || {};
      const timeChanged = Math.abs((Number(prev.currentTime) || 0) - currentTime) >= 0.2;
      const durationChanged = Math.abs((Number(prev.duration) || 0) - duration) >= 0.2;
      if (
        prev.paused !== paused ||
        prev.isVideo !== isVideo ||
        prev.mediaKey !== mediaKey ||
        timeChanged ||
        durationChanged
      ) {
        st.mediaPlayback = {
          isVideo,
          paused,
          currentTime,
          duration,
          mediaKey
        };
        emitState();
      }
      return;
    }

    if (action.type === "VQ_MEDIA_ENDED") {
      if (st.phase !== "REVEALED" || st.showAnswer) return;
      ctx.dispatch?.({
        type: "CORE_COMMAND",
        command: "JUDGE_SKIP"
      });
    }
  });


}
