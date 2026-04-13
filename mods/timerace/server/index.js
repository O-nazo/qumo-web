const modId = "timerace";

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function registerTimerace(ctx) {
  let tickTimer = null;
  let previousRules = null;

  const state = {
    phase: "idle",
    goalMode: "survivor",
    survivorGoalCount: 0,
    correctGoalCount: 10,
    wrongPenaltyEnabled: false,
    wrongPenaltySec: 10,
    passEnabled: false,
    passLimit: 10,
    passRemaining: 10,
    buzzerBeatActive: false,
    buzzerBeatPlayerId: null,
    penaltyActive: false,
    penaltyEndsAt: null,
    countdownSec: 10,
    countdownMillis: 0,
    durationMs: 60000,
    displayMs: 60000,
    countdownMs: 10999,
    displayCountdownMs: 10999,
    displayFractionDigits: 2,
    timeHideAfterMs: 30000,
    timeHideMinute: false,
    timeHideSecondTens: false,
    timeHideSecondOnes: false,
    timeHideFraction: false,
    timeHideOpened: false,
    resumePhase: null,
    participantIds: [],
    roundCorrectCount: 0,
    baseAutoResetDelayMs: 1500,
    startedAt: null,
    endedAt: null
  };

  function getPlayers() {
    return ctx.getState()?.players || {};
  }

  function getRootState() {
    return ctx.getState() || {};
  }

  function getOrderedConnectedPlayers() {
    const root = getRootState();
    const playersById = root.players || {};
    const order = Array.isArray(root.ui?.playerOrder) ? root.ui.playerOrder : [];
    const connectedIds = Object.keys(playersById).filter((id) => playersById[id]?.connected !== false);
    const connectedSet = new Set(connectedIds);
    const seen = new Set();
    const result = [];

    for (const id of order) {
      const key = String(id || "");
      if (!connectedSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(playersById[key]);
    }

    for (const id of connectedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(playersById[id]);
    }

    return result;
  }

  function stopTick() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function isCountUpMode() {
    return Number(state.durationMs ?? 0) <= 0;
  }

  function getConfiguredCountdownMs() {
    return clampInt(state.countdownSec, 0, 999, 10) * 1000
      + clampInt(state.countdownMillis, 0, 999, 0)
      + 999;
  }

  function getDisplayFractionDigits() {
    return clampInt(state.displayFractionDigits, 0, 2, 2);
  }

  function getEffectiveTimeHideAfterMs() {
    return clampInt(state.timeHideAfterMs, 0, 3599999, 30000);
  }

  function hasAnyTimeHideMask() {
    return !!(
      state.timeHideMinute ||
      state.timeHideSecondTens ||
      state.timeHideSecondOnes ||
      state.timeHideFraction
    );
  }

  function applyTimeraceRules() {
    const root = ctx.getState();
    if (!root) return;

    if (!previousRules) {
      previousRules = {
        qualifyEnabled: root.rules?.qualifyEnabled,
        qualifyScore: root.rules?.qualifyScore,
        qualifyCountEnabled: root.rules?.qualifyCountEnabled,
        qualifyCorrectCount: root.rules?.qualifyCorrectCount,
        restPenalty: root.rules?.restPenalty,
        wrongPoints: root.rules?.wrongPoints,
        dqEnabled: root.rules?.dqEnabled,
        dqWrongEnabled: root.rules?.dqWrongEnabled
      };
    }

    root.rules.qualifyEnabled = false;
    root.rules.qualifyCountEnabled = state.goalMode === "survivor";
    root.rules.qualifyCorrectCount = 1;
    root.rules.restPenalty = 0;
    root.rules.wrongPoints = 0;
    root.rules.dqEnabled = false;
    root.rules.dqWrongEnabled = false;
  }

  function syncBaseAutoResetDelay() {
    const root = ctx.getState();
    if (!root) return;
    state.baseAutoResetDelayMs = clampInt(root.rules?.autoResetDelayMs, 0, 10000, state.baseAutoResetDelayMs);
  }

  function restoreAutoResetDelay() {
    const root = ctx.getState();
    if (!root) return;
    root.rules.autoResetDelayMs = clampInt(state.baseAutoResetDelayMs, 0, 10000, 1500);
  }

  function beginPenalty() {
    const root = ctx.getState();
    if (!root) return;
    syncBaseAutoResetDelay();
    root.rules.autoResetDelayMs = clampInt(state.wrongPenaltySec, 1, 999, 10) * 1000;
    state.penaltyActive = true;
    state.penaltyEndsAt = Date.now() + (clampInt(state.wrongPenaltySec, 1, 999, 10) * 1000);
    ensureTick();
  }

  function clearPenalty() {
    if (!state.penaltyActive) return;
    state.penaltyActive = false;
    state.penaltyEndsAt = null;
    restoreAutoResetDelay();
  }

  function restoreRules() {
    const root = ctx.getState();
    if (!root || !previousRules) return;

    root.rules.qualifyEnabled = previousRules.qualifyEnabled;
    root.rules.qualifyScore = previousRules.qualifyScore;
    root.rules.qualifyCountEnabled = previousRules.qualifyCountEnabled;
    root.rules.qualifyCorrectCount = previousRules.qualifyCorrectCount;
    root.rules.restPenalty = previousRules.restPenalty;
    root.rules.wrongPoints = previousRules.wrongPoints;
    root.rules.dqEnabled = previousRules.dqEnabled;
    root.rules.dqWrongEnabled = previousRules.dqWrongEnabled;
    previousRules = null;
  }

  function getCurrentActiveCount() {
    return getOrderedConnectedPlayers().filter((player) => player?.status === "active").length;
  }

  function getCurrentRespondent() {
    const root = getRootState();
    if (root.judge?.status !== "in_progress") return null;
    return root.buzzer?.buzzOrder?.[root.judge.currentIndex] ?? null;
  }

  function hasBuzzerBeatRespondent() {
    return !!getCurrentRespondent()?.playerId;
  }

  function isJudgePhaseActive() {
    return state.phase === "running" || state.phase === "countdown" || state.phase === "stopped";
  }

  function getQualifiedParticipantIds() {
    const players = getPlayers();
    return state.participantIds.filter((playerId) => players[playerId]?.status === "qualified");
  }

  function getPendingParticipantIds() {
    return getOrderedConnectedPlayers()
      .filter((player) => player?.id)
      .filter((player) => player.connected !== false)
      .filter((player) => player.status !== "disqualified")
      .map((player) => player.id);
  }

  function getEffectiveParticipantIds() {
    return state.participantIds.length > 0 ? state.participantIds : getPendingParticipantIds();
  }

  function getEffectiveSurvivorGoalCount() {
    const configured = clampInt(state.survivorGoalCount, 0, 999, 0);
    const participantCount = getEffectiveParticipantIds().length;
    if (participantCount <= 0) return 0;
    if (configured <= 0) return participantCount;
    return Math.min(configured, participantCount);
  }

  function getEffectiveCorrectGoalCount() {
    return clampInt(state.correctGoalCount, 1, 9999, 10);
  }

  function getGoalSnapshot() {
    if (state.goalMode === "survivor") {
      const targetCount = getEffectiveSurvivorGoalCount();
      const progressCount = getQualifiedParticipantIds().length;
      return {
        targetCount,
        progressCount,
        remainingCount: Math.max(0, targetCount - progressCount),
        remainingUnit: "人"
      };
    }

    if (state.goalMode === "correct_count") {
      const targetCount = getEffectiveCorrectGoalCount();
      const progressCount = state.roundCorrectCount;
      return {
        targetCount,
        progressCount,
        remainingCount: Math.max(0, targetCount - progressCount),
        remainingUnit: "問"
      };
    }

    return {
      targetCount: 0,
      progressCount: 0,
      remainingCount: null,
      remainingUnit: ""
    };
  }

  function getEffectivePassLimit() {
    return clampInt(state.passLimit, 0, 999, 10);
  }

  function serializeState() {
    const clearedIds = getQualifiedParticipantIds();
    const goal = getGoalSnapshot();
    return {
      ...state,
      countUpMode: isCountUpMode(),
      penaltyRemainingMs: state.penaltyActive
        ? Math.max(0, Number(state.penaltyEndsAt ?? Date.now()) - Date.now())
        : 0,
      participantCount: getEffectiveParticipantIds().length,
      clearedCount: clearedIds.length,
      currentActiveCount: getCurrentActiveCount(),
      totalCorrectCount: state.roundCorrectCount,
      targetCount: goal.targetCount,
      progressCount: goal.progressCount,
      remainingCount: goal.remainingCount,
      remainingUnit: goal.remainingUnit,
      passRemaining: Math.max(0, getEffectivePassLimit() > 0 ? clampInt(state.passRemaining, 0, 999, getEffectivePassLimit()) : 0),
      displayFractionDigits: getDisplayFractionDigits(),
      timeHideAfterMs: getEffectiveTimeHideAfterMs(),
      timeHideEnabled: hasAnyTimeHideMask()
    };
  }

  function emitState() {
    ctx.broadcast({
      type: "MOD_EVENT",
      modId,
      event: {
        type: "STATE",
        state: serializeState()
      }
    });
  }

  function emitPassSfx() {
    ctx.broadcast({
      type: "MOD_EVENT",
      modId,
      event: {
        type: "PLAY_PASS_SFX"
      }
    });
  }

  function clearBuzzerBeat() {
    state.buzzerBeatActive = false;
    state.buzzerBeatPlayerId = null;
  }

  function enterBuzzerBeat() {
    stopTick();
    clearPenalty();
    state.displayMs = 0;
    state.phase = "timeout";
    state.resumePhase = null;
    state.endedAt = Date.now();
    state.buzzerBeatActive = true;
    state.buzzerBeatPlayerId = getCurrentRespondent()?.playerId ?? null;
    emitState();
  }

  function finishPhase(nextPhase) {
    stopTick();
    clearBuzzerBeat();
    state.phase = nextPhase;
    state.resumePhase = null;
    state.endedAt = Date.now();
    emitState();
  }

  function maybeFinishClear() {
    if (state.goalMode === "survivor") {
      const targetCount = getEffectiveSurvivorGoalCount();
      if (targetCount > 0 && getQualifiedParticipantIds().length >= targetCount) {
        finishPhase("clear");
        return true;
      }
      return false;
    }

    if (state.goalMode === "correct_count") {
      if (state.roundCorrectCount >= getEffectiveCorrectGoalCount()) {
        finishPhase("clear");
        return true;
      }
    }

    return false;
  }

  function tick() {
    const now = Date.now();

    if (state.penaltyActive) {
      if (now >= Number(state.penaltyEndsAt ?? 0)) {
        state.penaltyEndsAt = now;
      }
      emitState();
      return;
    }

    if (state.phase === "countdown") {
      const remain = Math.max(0, Number(state.startedAt ?? now) - now);
      state.displayCountdownMs = remain;
      if (remain <= 0) {
        state.phase = "running";
        state.resumePhase = null;
        state.startedAt = isCountUpMode()
          ? now
          : now + Math.max(0, state.displayMs - 10);
        state.displayCountdownMs = 0;
      }
      emitState();
      return;
    }

    if (state.phase === "running") {
      state.displayMs = isCountUpMode()
        ? Math.max(0, now - Number(state.startedAt ?? now))
        : Math.max(0, Number(state.startedAt ?? now) - now);
      if (maybeFinishClear()) return;
      if (!isCountUpMode() && state.displayMs <= 0) {
        state.displayMs = 0;
        if (hasBuzzerBeatRespondent()) {
          enterBuzzerBeat();
          return;
        }
        finishPhase("timeout");
        return;
      }
      emitState();
    }
  }

  function ensureTick() {
    stopTick();
    tickTimer = setInterval(tick, 33);
  }

  function resetRoundState() {
    stopTick();
    clearPenalty();
    state.phase = "idle";
    state.displayMs = state.durationMs;
    state.countdownMs = getConfiguredCountdownMs();
    state.displayCountdownMs = state.countdownMs;
    state.timeHideOpened = false;
    state.resumePhase = null;
    state.participantIds = [];
    state.roundCorrectCount = 0;
    state.passRemaining = getEffectivePassLimit();
    clearBuzzerBeat();
    state.startedAt = null;
    state.endedAt = null;
    state.penaltyEndsAt = null;
  }

  function beginFreshRound() {
    const participants = getOrderedConnectedPlayers()
      .filter((player) => player?.id)
      .filter((player) => player.connected !== false)
      .filter((player) => player.status !== "disqualified");

    state.participantIds = participants.map((player) => player.id);
    state.roundCorrectCount = 0;
    state.passRemaining = getEffectivePassLimit();
    state.displayMs = state.durationMs;
    state.countdownMs = getConfiguredCountdownMs();
    state.displayCountdownMs = state.countdownMs;
    state.endedAt = null;
    state.timeHideOpened = false;
  }

  function handleStart() {
    if (state.phase === "running" || state.phase === "countdown" || state.phase === "clear") return;

    if (state.phase === "stopped" && state.resumePhase === "running") {
      state.phase = "running";
      state.startedAt = isCountUpMode()
        ? Date.now() - state.displayMs
        : Date.now() + state.displayMs;
      ensureTick();
      emitState();
      return;
    }

    if (state.phase === "stopped" && state.resumePhase === "countdown") {
      state.phase = "countdown";
      state.startedAt = Date.now() + state.displayCountdownMs;
      ensureTick();
      emitState();
      return;
    }

    beginFreshRound();
    state.phase = "countdown";
    state.resumePhase = null;
    state.startedAt = Date.now() + state.countdownMs;
    ensureTick();
    emitState();
  }

  function handleStop() {
    if (state.phase !== "countdown" && state.phase !== "running") return;

    const now = Date.now();
    if (state.phase === "countdown") {
      state.displayCountdownMs = Math.max(0, Number(state.startedAt ?? now) - now);
      state.resumePhase = "countdown";
    } else {
      state.displayMs = isCountUpMode()
        ? Math.max(0, now - Number(state.startedAt ?? now))
        : Math.max(0, Number(state.startedAt ?? now) - now);
      state.resumePhase = "running";
    }

    stopTick();
    state.phase = "stopped";
    emitState();
  }

  function handleReset() {
    resetRoundState();
    emitState();
  }

  function handleSetDuration(cmd) {
    const seconds = clampInt(cmd?.seconds, 0, 3599, Math.round(state.durationMs / 1000));
    state.durationMs = seconds * 1000;

    if (state.phase === "idle" || state.phase === "timeout" || state.phase === "clear") {
      state.displayMs = state.durationMs;
    }

    emitState();
  }

  function handleSetGoalMode(cmd) {
    const nextMode = String(cmd?.mode || "");
    if (nextMode !== "survivor" && nextMode !== "correct_count" && nextMode !== "timer_only") return;
    state.goalMode = nextMode;
    applyTimeraceRules();
    if (!maybeFinishClear()) emitState();
  }

  function handleSetSurvivorGoal(cmd) {
    state.survivorGoalCount = clampInt(cmd?.count, 0, 999, state.survivorGoalCount);
    if (!maybeFinishClear()) emitState();
  }

  function handleSetCorrectGoal(cmd) {
    state.correctGoalCount = clampInt(cmd?.count, 1, 9999, state.correctGoalCount);
    if (!maybeFinishClear()) emitState();
  }

  function handleSetWrongPenalty(cmd) {
    state.wrongPenaltyEnabled = !!cmd?.enabled;
    state.wrongPenaltySec = clampInt(cmd?.seconds, 1, 999, state.wrongPenaltySec);
    if (!state.penaltyActive) {
      syncBaseAutoResetDelay();
      restoreAutoResetDelay();
    }
    emitState();
  }

  function handleSetPass(cmd) {
    state.passEnabled = !!cmd?.enabled;
    state.passLimit = clampInt(cmd?.count, 0, 999, state.passLimit);
    if (state.phase === "idle" || state.phase === "timeout" || state.phase === "clear") {
      state.passRemaining = getEffectivePassLimit();
    } else {
      state.passRemaining = Math.min(clampInt(state.passRemaining, 0, 999, getEffectivePassLimit()), getEffectivePassLimit());
    }
    emitState();
  }

  function handlePass() {
    if (!state.passEnabled) return;
    if (state.phase !== "running" && state.phase !== "countdown" && state.phase !== "stopped") return;
    if (clampInt(state.passRemaining, 0, 999, 0) <= 0) return;
    state.passRemaining -= 1;
    emitState();
    emitPassSfx();
  }

  function handleSetCountdown(cmd) {
    state.countdownSec = clampInt(cmd?.seconds, 0, 999, state.countdownSec);
    state.countdownMillis = clampInt(cmd?.milliseconds, 0, 999, state.countdownMillis);
    state.countdownMs = getConfiguredCountdownMs();
    if (state.phase === "idle" || state.phase === "timeout" || state.phase === "clear") {
      state.displayCountdownMs = state.countdownMs;
    }
    emitState();
  }

  function handleSetDisplayFraction(cmd) {
    state.displayFractionDigits = clampInt(cmd?.digits, 0, 2, state.displayFractionDigits);
    emitState();
  }

  function handleSetTimeHide(cmd) {
    state.timeHideAfterMs = clampInt(cmd?.afterMs, 0, 3599999, state.timeHideAfterMs);
    state.timeHideMinute = !!cmd?.hideMinute;
    state.timeHideSecondTens = !!cmd?.hideSecondTens;
    state.timeHideSecondOnes = !!cmd?.hideSecondOnes;
    state.timeHideFraction = !!cmd?.hideFraction;
    emitState();
  }

  function handleOpenHiddenTime() {
    state.timeHideOpened = true;
    emitState();
  }

  ctx.on("MOD_ACTIVATED", () => {
    syncBaseAutoResetDelay();
    applyTimeraceRules();
    resetRoundState();
    emitState();
  });

  ctx.on("MOD_DEACTIVATED", () => {
    resetRoundState();
    restoreRules();
    restoreAutoResetDelay();
  });

  ctx.on("CLIENT_CONNECTED", emitState);

  ctx.on("JUDGE_CORRECT", () => {
    if (!isJudgePhaseActive() && !state.buzzerBeatActive) return;
    state.roundCorrectCount += 1;
    setTimeout(() => {
      if (maybeFinishClear()) return;
      if (state.buzzerBeatActive) {
        finishPhase("timeout");
        return;
      }
      emitState();
    }, 0);
  });

  ctx.on("JUDGE_WRONG", () => {
    if (!isJudgePhaseActive() && !state.buzzerBeatActive) return;
    if (state.buzzerBeatActive) {
      finishPhase("timeout");
      return;
    }
    if (state.wrongPenaltyEnabled) beginPenalty();
    emitState();
  });

  ctx.on("JUDGE_SKIP", () => {
    if (!state.buzzerBeatActive) return;
    finishPhase("timeout");
  });

  ctx.on("STATE_UPDATED", () => {
    if (!state.penaltyActive) return;
    clearPenalty();
    emitState();
  });

  ctx.on("AC_RESET", handleReset);

  ctx.on("TR_START", handleStart);
  ctx.on("TR_STOP", handleStop);
  ctx.on("TR_RESET", handleReset);
  ctx.on("TR_SET_DURATION", handleSetDuration);
  ctx.on("TR_SET_GOAL_MODE", handleSetGoalMode);
  ctx.on("TR_SET_SURVIVOR_GOAL", handleSetSurvivorGoal);
  ctx.on("TR_SET_CORRECT_GOAL", handleSetCorrectGoal);
  ctx.on("TR_SET_WRONG_PENALTY", handleSetWrongPenalty);
  ctx.on("TR_SET_PASS", handleSetPass);
  ctx.on("TR_SET_COUNTDOWN", handleSetCountdown);
  ctx.on("TR_SET_DISPLAY_FRACTION", handleSetDisplayFraction);
  ctx.on("TR_SET_TIME_HIDE", handleSetTimeHide);
  ctx.on("TR_OPEN_HIDDEN_TIME", handleOpenHiddenTime);
  ctx.on("TR_PASS", handlePass);

  emitState();
}

module.exports = registerTimerace;
