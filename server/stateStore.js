const fs = require("fs");
const path = require("path");

const CONTROLLER_PREFS_FILE = path.resolve(process.cwd(), "server", "controller-prefs.json");

function createDefaultControllerPrefs() {
  return {
    rules: {
      buzzMode: "endless",
      restPenalty: 1,
      thinkingSeconds: 5,
      correctPoints: 1,
      wrongPoints: -1,
      qualifyEnabled: false,
      qualifyScore: 4,
      dqEnabled: false,
      dqScore: -3,
      qualifyCountEnabled: false,
      qualifyCorrectCount: 7,
      dqWrongEnabled: false,
      dqWrongCount: 3,
      qualifyReachEnabled: false,
      dqReachEnabled: false,
      autoNextEnabled: false,
      autoNextDelayMs: 800
    },
    ui: {
      showScore: true,
      showCorrectCount: true,
      showWrongCount: true,
      controllerSortMode: "manual",
      visualizerSortMode: "manual",
      playerTileLayout: "grid",
      prioritizePressedPlayers: false,
      swapJudgeColors: false,
      showVerticalScore: true,
      showVerticalCorrectCount: true,
      showVerticalWrongCount: true,
      showVerticalRestCount: true,
      showVerticalBuzzOrder: true,
      showMarks: false,
      showMarkCorrect: true,
      showMarkWrong: true,
      joinQrVisible: false
    }
  };
}

function loadPersistedPrefs() {
  try {
    const raw = fs.readFileSync(CONTROLLER_PREFS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizePersistedPrefs(raw) {
  const defaults = createDefaultControllerPrefs();
  const src = raw && typeof raw === "object" ? raw : {};
  const rules = src.rules && typeof src.rules === "object" ? src.rules : {};
  const ui = src.ui && typeof src.ui === "object" ? src.ui : {};

  return {
    rules: {
      buzzMode: typeof rules.buzzMode === "string" ? rules.buzzMode : defaults.rules.buzzMode,
      restPenalty: Number.isFinite(Number(rules.restPenalty)) ? Number(rules.restPenalty) : defaults.rules.restPenalty,
      thinkingSeconds: Number.isFinite(Number(rules.thinkingSeconds)) ? Number(rules.thinkingSeconds) : defaults.rules.thinkingSeconds,
      correctPoints: Number.isFinite(Number(rules.correctPoints)) ? Number(rules.correctPoints) : defaults.rules.correctPoints,
      wrongPoints: Number.isFinite(Number(rules.wrongPoints)) ? Number(rules.wrongPoints) : defaults.rules.wrongPoints,
      qualifyEnabled: typeof rules.qualifyEnabled === "boolean" ? rules.qualifyEnabled : defaults.rules.qualifyEnabled,
      qualifyScore: Number.isFinite(Number(rules.qualifyScore)) ? Number(rules.qualifyScore) : defaults.rules.qualifyScore,
      dqEnabled: typeof rules.dqEnabled === "boolean" ? rules.dqEnabled : defaults.rules.dqEnabled,
      dqScore: Number.isFinite(Number(rules.dqScore)) ? Number(rules.dqScore) : defaults.rules.dqScore,
      qualifyCountEnabled: typeof rules.qualifyCountEnabled === "boolean" ? rules.qualifyCountEnabled : defaults.rules.qualifyCountEnabled,
      qualifyCorrectCount: Number.isFinite(Number(rules.qualifyCorrectCount)) ? Number(rules.qualifyCorrectCount) : defaults.rules.qualifyCorrectCount,
      dqWrongEnabled: typeof rules.dqWrongEnabled === "boolean" ? rules.dqWrongEnabled : defaults.rules.dqWrongEnabled,
      dqWrongCount: Number.isFinite(Number(rules.dqWrongCount)) ? Number(rules.dqWrongCount) : defaults.rules.dqWrongCount,
      qualifyReachEnabled: typeof rules.qualifyReachEnabled === "boolean" ? rules.qualifyReachEnabled : defaults.rules.qualifyReachEnabled,
      dqReachEnabled: typeof rules.dqReachEnabled === "boolean" ? rules.dqReachEnabled : defaults.rules.dqReachEnabled,
      autoNextEnabled: typeof rules.autoNextEnabled === "boolean" ? rules.autoNextEnabled : defaults.rules.autoNextEnabled,
      autoNextDelayMs: Number.isFinite(Number(rules.autoNextDelayMs)) ? Number(rules.autoNextDelayMs) : defaults.rules.autoNextDelayMs
    },
    ui: {
      showScore: typeof ui.showScore === "boolean" ? ui.showScore : defaults.ui.showScore,
      showCorrectCount: typeof ui.showCorrectCount === "boolean" ? ui.showCorrectCount : defaults.ui.showCorrectCount,
      showWrongCount: typeof ui.showWrongCount === "boolean" ? ui.showWrongCount : defaults.ui.showWrongCount,
      controllerSortMode: ui.controllerSortMode === "rank" ? "rank" : defaults.ui.controllerSortMode,
      visualizerSortMode: ui.visualizerSortMode === "rank" ? "rank" : defaults.ui.visualizerSortMode,
      playerTileLayout: typeof ui.playerTileLayout === "string" ? ui.playerTileLayout : defaults.ui.playerTileLayout,
      prioritizePressedPlayers: typeof ui.prioritizePressedPlayers === "boolean" ? ui.prioritizePressedPlayers : defaults.ui.prioritizePressedPlayers,
      swapJudgeColors: typeof ui.swapJudgeColors === "boolean" ? ui.swapJudgeColors : defaults.ui.swapJudgeColors,
      showVerticalScore: typeof ui.showVerticalScore === "boolean" ? ui.showVerticalScore : defaults.ui.showVerticalScore,
      showVerticalCorrectCount: typeof ui.showVerticalCorrectCount === "boolean" ? ui.showVerticalCorrectCount : defaults.ui.showVerticalCorrectCount,
      showVerticalWrongCount: typeof ui.showVerticalWrongCount === "boolean" ? ui.showVerticalWrongCount : defaults.ui.showVerticalWrongCount,
      showVerticalRestCount: typeof ui.showVerticalRestCount === "boolean" ? ui.showVerticalRestCount : defaults.ui.showVerticalRestCount,
      showVerticalBuzzOrder: typeof ui.showVerticalBuzzOrder === "boolean" ? ui.showVerticalBuzzOrder : defaults.ui.showVerticalBuzzOrder,
      showMarks: typeof ui.showMarks === "boolean" ? ui.showMarks : defaults.ui.showMarks,
      showMarkCorrect: typeof ui.showMarkCorrect === "boolean" ? ui.showMarkCorrect : defaults.ui.showMarkCorrect,
      showMarkWrong: typeof ui.showMarkWrong === "boolean" ? ui.showMarkWrong : defaults.ui.showMarkWrong,
      joinQrVisible: typeof ui.joinQrVisible === "boolean" ? ui.joinQrVisible : defaults.ui.joinQrVisible
    }
  };
}

function applyControllerPrefs(state, rawPrefs) {
  const prefs = sanitizePersistedPrefs(rawPrefs);
  state.rules = state.rules || {};
  state.ui = state.ui || {};

  Object.assign(state.rules, prefs.rules);
  Object.assign(state.ui, prefs.ui);
  state.ui.joinQrTargetUrl = null;
  state.ui.joinQrDataUrl = null;

  return prefs;
}

function createInitialState() {
  const defaults = createDefaultControllerPrefs();
  const persisted = sanitizePersistedPrefs(loadPersistedPrefs());
  return {
    phase: "lobby",
    questionNo: 1,
    joinUrls: [],

    rules: {
      ...defaults.rules,
      // 得点・原点
      ...persisted.rules
    },

    buzzer: {
      isOpen: false,
      openedAt: null,
      firstBuzz: null,
      buzzOrder: []
    },

    judge: {
      status: "idle",        // "idle" | "in_progress" | "result"
      currentIndex: 0,
      wrongSet: {},          // { [playerId]: true }
      lastResult: null       // { type: "correct"|"skip"|"all_wrong", playerId? }
    },

    sfx: {
      nonce: 0,
      key: null,
      at: null
    },

    ui: {
      ...defaults.ui,
      playerOrder: [],
      joinQrTargetUrl: null,
      joinQrDataUrl: null,
      ...persisted.ui
    },

    // player: { id, name, score, correctCount, wrongCount, restCount, pendingRestAdd }
    players: {}
  };
}

function persistControllerPrefs(state) {
  const payload = {
    ...sanitizePersistedPrefs({
      rules: state.rules,
      ui: state.ui
    })
  };

  try {
    fs.writeFileSync(CONTROLLER_PREFS_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // ignore persistence failures
  }
}

const state = createInitialState();
function getState() { return state; }
function snapshot() { return JSON.parse(JSON.stringify(state)); }

module.exports = {
  getState,
  snapshot,
  persistControllerPrefs,
  createDefaultControllerPrefs,
  sanitizePersistedPrefs,
  applyControllerPrefs
};
