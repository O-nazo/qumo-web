const fs = require("fs");
const path = require("path");
const { createRuleRegistry } = require("./rules/registry");

const CONTROLLER_PREFS_FILE = path.resolve(process.cwd(), "server", "controller-prefs.json");
const ruleRegistry = createRuleRegistry({
  clampInt(n, min, max, fallback = 0) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(x)));
  }
});
const normalRuleDefaults = ruleRegistry.getRuleDefinition("standard").defaults;
const mergedRuleDefaults = ruleRegistry.getRuleDefinitions().reduce((acc, rule) => {
  Object.assign(acc, rule.defaults || {});
  return acc;
}, {});

function createDefaultControllerPrefs() {
  return {
    rules: {
      buzzMode: "endless",
      ruleProfile: normalRuleDefaults.ruleProfile,
      ...mergedRuleDefaults,
      displayQualifyPlayerCount: 0,
      displayDisqualifiedPlayerCount: 0,
      thinkingSeconds: 5,
      autoResetEnabled: false,
      autoResetDelayMs: 1500,
      autoNextEnabled: false,
      autoNextDelayMs: 800
    },
    ui: {
      showScore: true,
      showCorrectCount: true,
      showWrongCount: true,
      controllerSortMode: "manual",
      visualizerSortMode: "manual",
      playersViewMode: "grid",
      playerTileLayout: "grid",
      prioritizePressedPlayers: false,
      swapJudgeColors: false,
      backgroundDarkTheme: false,
      playerTileDarkTheme: false,
      showVerticalScore: true,
      showVerticalCorrectCount: true,
      showVerticalWrongCount: true,
      showVerticalRestCount: true,
      showVerticalBuzzOrder: true,
      showMarks: false,
      showMarkCorrect: true,
      showMarkWrong: true,
      joinQrVisible: false,
      lanModeEnabled: false,
      rulesOverlayVisible: false,
      boardAnswerEnabled: false,
      boardAnswerVisible: false,
      modThemePrefs: {}
    }
  };
}

function sanitizePlayerTileLayout(layout, fallback) {
  const value = String(layout || "");
  return value === "vertical" || value === "slim" ? value : fallback;
}

function sanitizePlayersViewMode(mode, fallback) {
  return String(mode || "") === "table" ? "table" : fallback;
}

function sanitizeModThemePrefs(rawPrefs) {
  const src = rawPrefs && typeof rawPrefs === "object" ? rawPrefs : {};
  const out = {};
  for (const [modId, prefs] of Object.entries(src)) {
    if (!prefs || typeof prefs !== "object") continue;
    const id = String(modId || "").trim();
    if (!id) continue;
    out[id] = {
      backgroundDarkTheme: !!prefs.backgroundDarkTheme,
      playerTileDarkTheme: !!prefs.playerTileDarkTheme
    };
  }
  return out;
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
      ruleProfile: ruleRegistry.sanitizeRuleProfile(
        typeof rules.ruleProfile === "string" ? rules.ruleProfile : defaults.rules.ruleProfile
      ),
      displayQualifyPlayerCount: Number.isFinite(Number(rules.displayQualifyPlayerCount)) ? Number(rules.displayQualifyPlayerCount) : defaults.rules.displayQualifyPlayerCount,
      displayDisqualifiedPlayerCount: Number.isFinite(Number(rules.displayDisqualifiedPlayerCount)) ? Number(rules.displayDisqualifiedPlayerCount) : defaults.rules.displayDisqualifiedPlayerCount,
      restPenalty: Number.isFinite(Number(rules.restPenalty)) ? Number(rules.restPenalty) : defaults.rules.restPenalty,
      thinkingSeconds: Number.isFinite(Number(rules.thinkingSeconds)) ? Number(rules.thinkingSeconds) : defaults.rules.thinkingSeconds,
      correctPoints: Number.isFinite(Number(rules.correctPoints)) ? Number(rules.correctPoints) : defaults.rules.correctPoints,
      wrongPoints: Number.isFinite(Number(rules.wrongPoints)) ? Number(rules.wrongPoints) : defaults.rules.wrongPoints,
      attackStartPoints: Number.isFinite(Number(rules.attackStartPoints)) ? Number(rules.attackStartPoints) : defaults.rules.attackStartPoints,
      attackCorrectDamage: Number.isFinite(Number(rules.attackCorrectDamage)) ? Number(rules.attackCorrectDamage) : defaults.rules.attackCorrectDamage,
      attackWrongDamage: Number.isFinite(Number(rules.attackWrongDamage)) ? Number(rules.attackWrongDamage) : defaults.rules.attackWrongDamage,
      upDownCorrectGain: Number.isFinite(Number(rules.upDownCorrectGain)) ? Number(rules.upDownCorrectGain) : defaults.rules.upDownCorrectGain,
      upDownQualifyScore: Number.isFinite(Number(rules.upDownQualifyScore)) ? Number(rules.upDownQualifyScore) : defaults.rules.upDownQualifyScore,
      upDownDqWrongCount: Number.isFinite(Number(rules.upDownDqWrongCount)) ? Number(rules.upDownDqWrongCount) : defaults.rules.upDownDqWrongCount,
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
      autoResetEnabled: typeof rules.autoResetEnabled === "boolean" ? rules.autoResetEnabled : defaults.rules.autoResetEnabled,
      autoResetDelayMs: Number.isFinite(Number(rules.autoResetDelayMs)) ? Number(rules.autoResetDelayMs) : defaults.rules.autoResetDelayMs,
      autoNextEnabled: typeof rules.autoNextEnabled === "boolean" ? rules.autoNextEnabled : defaults.rules.autoNextEnabled,
      autoNextDelayMs: Number.isFinite(Number(rules.autoNextDelayMs)) ? Number(rules.autoNextDelayMs) : defaults.rules.autoNextDelayMs
    },
    ui: {
      showScore: typeof ui.showScore === "boolean" ? ui.showScore : defaults.ui.showScore,
      showCorrectCount: typeof ui.showCorrectCount === "boolean" ? ui.showCorrectCount : defaults.ui.showCorrectCount,
      showWrongCount: typeof ui.showWrongCount === "boolean" ? ui.showWrongCount : defaults.ui.showWrongCount,
      controllerSortMode: ui.controllerSortMode === "rank" ? "rank" : defaults.ui.controllerSortMode,
      visualizerSortMode: ui.visualizerSortMode === "rank" ? "rank" : defaults.ui.visualizerSortMode,
      playersViewMode: sanitizePlayersViewMode(ui.playersViewMode, defaults.ui.playersViewMode),
      playerTileLayout: sanitizePlayerTileLayout(ui.playerTileLayout, defaults.ui.playerTileLayout),
      prioritizePressedPlayers: typeof ui.prioritizePressedPlayers === "boolean" ? ui.prioritizePressedPlayers : defaults.ui.prioritizePressedPlayers,
      swapJudgeColors: typeof ui.swapJudgeColors === "boolean" ? ui.swapJudgeColors : defaults.ui.swapJudgeColors,
      backgroundDarkTheme: typeof ui.backgroundDarkTheme === "boolean" ? ui.backgroundDarkTheme : defaults.ui.backgroundDarkTheme,
      playerTileDarkTheme: typeof ui.playerTileDarkTheme === "boolean" ? ui.playerTileDarkTheme : defaults.ui.playerTileDarkTheme,
      showVerticalScore: typeof ui.showVerticalScore === "boolean" ? ui.showVerticalScore : defaults.ui.showVerticalScore,
      showVerticalCorrectCount: typeof ui.showVerticalCorrectCount === "boolean" ? ui.showVerticalCorrectCount : defaults.ui.showVerticalCorrectCount,
      showVerticalWrongCount: typeof ui.showVerticalWrongCount === "boolean" ? ui.showVerticalWrongCount : defaults.ui.showVerticalWrongCount,
      showVerticalRestCount: typeof ui.showVerticalRestCount === "boolean" ? ui.showVerticalRestCount : defaults.ui.showVerticalRestCount,
      showVerticalBuzzOrder: typeof ui.showVerticalBuzzOrder === "boolean" ? ui.showVerticalBuzzOrder : defaults.ui.showVerticalBuzzOrder,
      showMarks: typeof ui.showMarks === "boolean" ? ui.showMarks : defaults.ui.showMarks,
      showMarkCorrect: typeof ui.showMarkCorrect === "boolean" ? ui.showMarkCorrect : defaults.ui.showMarkCorrect,
      showMarkWrong: typeof ui.showMarkWrong === "boolean" ? ui.showMarkWrong : defaults.ui.showMarkWrong,
      joinQrVisible: typeof ui.joinQrVisible === "boolean" ? ui.joinQrVisible : defaults.ui.joinQrVisible,
      lanModeEnabled: typeof ui.lanModeEnabled === "boolean" ? ui.lanModeEnabled : defaults.ui.lanModeEnabled,
      rulesOverlayVisible: typeof ui.rulesOverlayVisible === "boolean" ? ui.rulesOverlayVisible : defaults.ui.rulesOverlayVisible,
      boardAnswerEnabled: typeof ui.boardAnswerEnabled === "boolean" ? ui.boardAnswerEnabled : defaults.ui.boardAnswerEnabled,
      boardAnswerVisible: typeof ui.boardAnswerVisible === "boolean" ? ui.boardAnswerVisible : defaults.ui.boardAnswerVisible,
      modThemePrefs: sanitizeModThemePrefs(ui.modThemePrefs)
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
  state.boardAnswer = state.boardAnswer || { enabled: false, visibleOnVisualizer: false, responses: {} };
  state.boardAnswer.enabled = !!prefs.ui.boardAnswerEnabled;
  state.boardAnswer.visibleOnVisualizer = !!prefs.ui.boardAnswerVisible;
  if (!state.boardAnswer.responses || typeof state.boardAnswer.responses !== "object") {
    state.boardAnswer.responses = {};
  }

  return prefs;
}

function createInitialState() {
  const defaults = createDefaultControllerPrefs();
  const persisted = sanitizePersistedPrefs(loadPersistedPrefs());
  return {
    phase: "lobby",
    questionNo: 0,
    titleScreenVisible: false,
    titleScreenAutoShown: false,
    modScoreboardVisible: false,
    scoreHiddenVisible: false,
    preModUiTheme: null,
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
      lastResult: null,      // { type: "correct"|"skip"|"all_wrong", playerId? }
      pendingOutcome: {}     // { [playerId]: { correctCount, wrongCount, pendingRestAdd } }
    },

    sfx: {
      nonce: 0,
      key: null,
      at: null
    },

    ui: {
      ...defaults.ui,
      playerOrder: [],
      rankSortOrder: [],
      hiddenScoreRankSortOrder: [],
      joinQrTargetUrl: null,
      joinQrDataUrl: null,
      ...persisted.ui
    },

    boardAnswer: {
      enabled: !!persisted.ui.boardAnswerEnabled,
      visibleOnVisualizer: !!persisted.ui.boardAnswerVisible,
      responses: {},
      lastJudged: null
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
