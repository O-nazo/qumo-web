function createBuzzLogic({ recomputeScores, recomputePlayerStatuses }) {
  function resetBuzzer(st) {
    st.buzzer.isOpen = true;
    st.buzzer.openedAt = Date.now();
    st.buzzer.firstBuzz = null;
    st.buzzer.buzzOrder = [];
    st.buzzer.collectSeq = 0;
    st.buzzer.collectUntil = null;
  }

  function resetJudge(st) {
    st.judge.status = "idle";
    st.judge.currentIndex = 0;
    st.judge.wrongSet = {};
    st.judge.clearedOrder = [];
    st.judge.lastResult = null;
    st.judge.pendingOutcome = {};
  }

  function ensureJudgePendingOutcome(st) {
    st.judge = st.judge || {};
    st.judge.pendingOutcome =
      st.judge.pendingOutcome && typeof st.judge.pendingOutcome === "object"
        ? st.judge.pendingOutcome
        : {};
    return st.judge.pendingOutcome;
  }

  function addPendingJudgeOutcome(st, playerId, {
    correct = 0,
    wrong = 0,
    rest = 0,
    bonusDelta = 0,
    scoreDelta = 0,
    scoreSet = null,
    forceDisqualify = false
  } = {}) {
    const player = st.players?.[playerId];
    if (!player) return;

    const pending = ensureJudgePendingOutcome(st);
    const current = pending[playerId] && typeof pending[playerId] === "object"
      ? pending[playerId]
      : {
          correctCount: 0,
          wrongCount: 0,
          pendingRestAdd: 0,
          bonusDelta: 0,
          scoreDelta: 0,
          scoreSet: null,
          forceDisqualify: false
        };

    current.correctCount = Number(current.correctCount ?? 0) + (Number(correct) || 0);
    current.wrongCount = Number(current.wrongCount ?? 0) + (Number(wrong) || 0);
    current.pendingRestAdd = Number(current.pendingRestAdd ?? 0) + Math.max(0, Number(rest) || 0);
    current.bonusDelta = Number(current.bonusDelta ?? 0) + (Number(bonusDelta) || 0);
    current.scoreDelta = Number(current.scoreDelta ?? 0) + (Number(scoreDelta) || 0);
    if (scoreSet != null && Number.isFinite(Number(scoreSet))) {
      current.scoreSet = Number(scoreSet);
    }
    if (forceDisqualify) {
      current.forceDisqualify = true;
    }
    pending[playerId] = current;
  }

  function applyPendingJudgeOutcome(st) {
    const pending = ensureJudgePendingOutcome(st);
    let changed = false;

    for (const [playerId, outcome] of Object.entries(pending)) {
      const player = st.players?.[playerId];
      if (!player || !outcome || typeof outcome !== "object") continue;

      const correct = Number(outcome.correctCount ?? 0) || 0;
      const wrong = Number(outcome.wrongCount ?? 0) || 0;
      const rest = Math.max(0, Number(outcome.pendingRestAdd ?? 0) || 0);
      const bonusDelta = Number(outcome.bonusDelta ?? 0) || 0;
      const scoreDelta = Number(outcome.scoreDelta ?? 0) || 0;
      const hasScoreSet = outcome.scoreSet != null && Number.isFinite(Number(outcome.scoreSet));
      const scoreSet = hasScoreSet ? Number(outcome.scoreSet) : null;
      const forceDisqualify = outcome.forceDisqualify === true;

      if (correct !== 0) {
        player.correctCount = Number(player.correctCount ?? 0) + correct;
        changed = true;
      }
      if (wrong !== 0) {
        player.wrongCount = Number(player.wrongCount ?? 0) + wrong;
        changed = true;
      }
      if (rest > 0) {
        player.pendingRestAdd = Number(player.pendingRestAdd ?? 0) + rest;
        changed = true;
      }
      if (bonusDelta !== 0) {
        player.scoreBonus = Number(player.scoreBonus ?? 0) + bonusDelta;
        changed = true;
      }
      if (scoreDelta !== 0) {
        player.score = Number(player.score ?? 0) + scoreDelta;
        changed = true;
      }
      if (hasScoreSet) {
        player.score = scoreSet;
        changed = true;
      }
      if (forceDisqualify) {
        player.forceDisqualify = true;
        changed = true;
      }
    }

    st.judge.pendingOutcome = {};

    if (changed) {
      recomputeScores(st);
      recomputePlayerStatuses(st);
    }
  }

  function clearPendingJudgeOutcome(st) {
    ensureJudgePendingOutcome(st);
    st.judge.pendingOutcome = {};
  }

  function getBuzzMode(st) {
    const m = String(st.rules?.buzzMode ?? "").toLowerCase();
    if (m === "cultq" || m === "cult" || m === "cartq") return "cultq";
    if (m === "single") return "single";
    if (m === "early_endless" || m === "survival_endless" || m === "hayanuke_endless") return "early_endless";
    if (m === "early_single" || m === "survival_single" || m === "hayanuke_single") return "early_single";
    if (m === "endless" || m === "all") return "endless";
    return "endless";
  }

  function getClearedSet(st) {
    return new Set(Array.isArray(st?.judge?.clearedOrder) ? st.judge.clearedOrder.map((id) => String(id || "")) : []);
  }

  function shouldApplyPendingOutcomeOnReset(st) {
    const mode = getBuzzMode(st);
    const resultType = String(st.judge?.lastResult?.type || "");

    if (mode === "single") {
      return resultType === "correct" || resultType === "skip" || resultType === "single_wrong";
    }

    return resultType === "correct" || resultType === "skip";
  }

  function shouldAdvanceQuestionOnReset(st) {
    const resultType = String(st.judge?.lastResult?.type || "");
    return resultType === "correct" || resultType === "skip";
  }

  function resetForOpenQuestion(st, { preserveWrongState = false } = {}) {
    resetBuzzer(st);
    st.judge.status = "idle";
    st.judge.currentIndex = 0;
    st.judge.lastResult = null;
    if (!preserveWrongState) {
      st.judge.wrongSet = {};
      clearPendingJudgeOutcome(st);
    } else {
      ensureJudgePendingOutcome(st);
    }
    st.phase = "open";
    st.buzzer.isOpen = true;
  }

  function settleResetState(st) {
    const mode = getBuzzMode(st);

    if (shouldApplyPendingOutcomeOnReset(st)) {
      applyPendingJudgeOutcome(st);
      if (shouldAdvanceQuestionOnReset(st)) {
        startQuestion(st, { increment: true });
      } else {
        resetBuzzer(st);
        resetJudge(st);
        st.phase = "open";
        st.buzzer.isOpen = true;
      }
      return;
    }

    if (mode === "cultq") {
      resetForOpenQuestion(st, { preserveWrongState: true });
      return;
    }

    resetForOpenQuestion(st, { preserveWrongState: false });
  }

  function canBuzzNow(st, playerId) {
    const p = st.players?.[playerId];
    if (!p) return false;
    if (getClearedSet(st).has(String(playerId || ""))) return false;
    if (Number(p.restCount ?? 0) > 0) return false;
    if (p.modDisabled) return false;
    if (st.judge?.wrongSet?.[playerId]) return false;
    if (p.status === "qualified" || p.status === "disqualified") return false;
    return true;
  }

  function pickNextRespondentIndex(st) {
    const wrongSet = st.judge?.wrongSet || {};
    const clearedSet = getClearedSet(st);
    const order = st.buzzer?.buzzOrder || [];
    for (let i = 0; i < order.length; i++) {
      const id = order[i]?.playerId;
      if (!id) continue;
      if (clearedSet.has(String(id))) continue;
      if (wrongSet[id]) continue;
      if (!canBuzzNow(st, id)) continue;
      return i;
    }
    return -1;
  }

  function recomputeFirstBuzz(st) {
    const first = st.buzzer.buzzOrder[0] ?? null;
    st.buzzer.firstBuzz = first ? { playerId: first.playerId, at: first.at } : null;
  }

  function consumeRestForThisQuestion(st) {
    for (const p of Object.values(st.players || {})) {
      if (Number(p.restCount ?? 0) > 0) {
        p.restCount = Math.max(0, Number(p.restCount) - 1);
      }
    }
  }

  function applyPendingRestForNextQuestion(st) {
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
    st.buzzer.isOpen = false;
    consumeRestForThisQuestion(st);
  }

  function startQuestion(st, { increment = false } = {}) {
    if (increment) st.questionNo = Number(st.questionNo ?? 1) + 1;
    applyPendingRestForNextQuestion(st);
    resetBuzzer(st);
    resetJudge(st);
    st.phase = "open";
    st.buzzer.isOpen = true;
    st.buzzer.openedAt = Date.now();
  }

  function hasAnyEligiblePlayer(st) {
    const wrongSet = st.judge?.wrongSet || {};
    const clearedSet = getClearedSet(st);
    return Object.values(st.players || {}).some((p) => {
      const id = p.id;
      if (!id) return false;
      if (clearedSet.has(String(id))) return false;
      if (Number(p.restCount ?? 0) > 0) return false;
      if (p.modDisabled) return false;
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

  return {
    addPendingJudgeOutcome,
    applyPendingJudgeOutcome,
    canBuzzNow,
    clearPendingJudgeOutcome,
    ensureJudgePendingOutcome,
    getBuzzMode,
    getCurrentRespondent,
    hasAnyEligiblePlayer,
    pickNextRespondentIndex,
    recomputeFirstBuzz,
    resetBuzzer,
    resetJudge,
    setResult,
    settleResetState,
    shouldApplyPendingOutcomeOnReset,
    startQuestion
  };
}

module.exports = { createBuzzLogic };
