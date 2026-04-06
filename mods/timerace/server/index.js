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
    durationMs: 60000,
    displayMs: 60000,
    countdownMs: 10000,
    displayCountdownMs: 10000,
    resumePhase: null,
    participantIds: [],
    startedAt: null,
    endedAt: null
  };

  function getPlayers() {
    return ctx.getState()?.players || {};
  }

  function getOrderedConnectedPlayers() {
    const root = ctx.getState() || {};
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
    root.rules.qualifyCountEnabled = true;
    root.rules.qualifyCorrectCount = 1;
    root.rules.restPenalty = 0;
    root.rules.wrongPoints = 0;
    root.rules.dqEnabled = false;
    root.rules.dqWrongEnabled = false;
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

  function getCurrentRemainingCount() {
    return getOrderedConnectedPlayers().filter((player) => player?.status === "active").length;
  }

  function getQualifiedParticipantIds() {
    const players = getPlayers();
    return state.participantIds.filter((playerId) => players[playerId]?.status === "qualified");
  }

  function serializeState() {
    const clearedIds = getQualifiedParticipantIds();
    return {
      ...state,
      participantCount: state.participantIds.length,
      clearedCount: clearedIds.length,
      remainingCount: getCurrentRemainingCount()
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

  function finishPhase(nextPhase) {
    stopTick();
    state.phase = nextPhase;
    state.resumePhase = null;
    state.endedAt = Date.now();
    emitState();
  }

  function maybeFinishClear() {
    const clearedIds = getQualifiedParticipantIds();
    if (state.participantIds.length > 0 && clearedIds.length >= state.participantIds.length) {
      finishPhase("clear");
      return true;
    }
    return false;
  }

  function tick() {
    const now = Date.now();

    if (state.phase === "countdown") {
      const remain = Math.max(0, Number(state.startedAt ?? now) - now);
      state.displayCountdownMs = remain;
      if (remain <= 0) {
        state.phase = "running";
        state.resumePhase = null;
        state.startedAt = now + state.displayMs;
        state.displayCountdownMs = 0;
      }
      emitState();
      return;
    }

    if (state.phase === "running") {
      state.displayMs = Math.max(0, Number(state.startedAt ?? now) - now);
      if (maybeFinishClear()) return;
      if (state.displayMs <= 0) {
        state.displayMs = 0;
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
    state.phase = "idle";
    state.displayMs = state.durationMs;
    state.displayCountdownMs = state.countdownMs;
    state.resumePhase = null;
    state.participantIds = [];
    state.startedAt = null;
    state.endedAt = null;
  }

  function beginFreshRound() {
    const participants = getOrderedConnectedPlayers()
      .filter((player) => player?.id)
      .filter((player) => player.connected !== false)
      .filter((player) => player.status !== "disqualified");

    state.participantIds = participants.map((player) => player.id);
    state.displayMs = state.durationMs;
    state.displayCountdownMs = state.countdownMs;
    state.endedAt = null;
  }

  function handleStart() {
    if (state.phase === "running" || state.phase === "countdown" || state.phase === "clear") return;

    if (state.phase === "stopped" && state.resumePhase === "running") {
      state.phase = "running";
      state.startedAt = Date.now() + state.displayMs;
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
      state.displayMs = Math.max(0, Number(state.startedAt ?? now) - now);
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
    const seconds = clampInt(cmd?.seconds, 5, 3599, Math.round(state.durationMs / 1000));
    state.durationMs = seconds * 1000;

    if (state.phase === "idle" || state.phase === "timeout" || state.phase === "clear") {
      state.displayMs = state.durationMs;
    }

    emitState();
  }

  ctx.on("MOD_ACTIVATED", () => {
    applyTimeraceRules();
    resetRoundState();
    emitState();
  });

  ctx.on("MOD_DEACTIVATED", () => {
    resetRoundState();
    restoreRules();
  });

  ctx.on("CLIENT_CONNECTED", emitState);

  ctx.on("JUDGE_CORRECT", () => {
    if (state.phase !== "running" && state.phase !== "countdown" && state.phase !== "stopped") return;
    setTimeout(() => {
      if (!maybeFinishClear()) emitState();
    }, 0);
  });

  ctx.on("JUDGE_WRONG", () => {
    if (state.phase !== "running" && state.phase !== "countdown" && state.phase !== "stopped") return;
    emitState();
  });

  ctx.on("AC_RESET", handleReset);

  ctx.on("TR_START", handleStart);
  ctx.on("TR_STOP", handleStop);
  ctx.on("TR_RESET", handleReset);
  ctx.on("TR_SET_DURATION", handleSetDuration);

  emitState();
}

module.exports = registerTimerace;
