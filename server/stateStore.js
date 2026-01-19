function createInitialState() {
  return {
    phase: "lobby",
    questionNo: 1,
    joinUrls: [],

    rules: {
      restPenalty: 1, // 誤答罰（次問から休みをn付与）。0なら罰なし
      thinkingSeconds: 5,
      // 得点・原点
      correctPoints: 1,
      wrongPoints: -1,

      // 勝ち抜け/失格
      qualifyEnabled: false,
      qualifyScore: 4,

      dqEnabled: false,
      dqScore: -3,

      // 勝ち抜け/失格（回数条件）
      qualifyCountEnabled: false,
      qualifyCorrectCount: 7,

      dqWrongEnabled: false,
      dqWrongCount: 3,

      // リーチ演出ON/OFF
      qualifyReachEnabled: false,
      dqReachEnabled: false
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
      // 表示のON/OFF
      showScore: true,
      showWrongCount: true,

      // Visualizerの○×表示
      showMarks: false,
      showMarkCorrect: true,
      showMarkWrong: true,

      // 既存の参加QR
      joinQrVisible: false,
      joinQrTargetUrl: null,
      joinQrDataUrl: null
    },

    // player: { id, name, score, correctCount, wrongCount, restCount, pendingRestAdd }
    players: {}
  };
}

const state = createInitialState();
function getState() { return state; }
function snapshot() { return JSON.parse(JSON.stringify(state)); }

module.exports = { getState, snapshot };
