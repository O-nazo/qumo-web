function createTenByTenRuleDefinition({ clampInt }) {
  function clampCorrectPoints(value) {
    return clampInt(value, 0, 1000000, 0);
  }

  function clampWrongPoints(value) {
    return clampInt(value, 0, 10, 10);
  }

  function computeBaseScore(player) {
    const correctPoints = clampCorrectPoints(player?.correctCount);
    const wrongPoints = clampWrongPoints(player?.wrongCount);
    return correctPoints * wrongPoints;
  }

  return {
    id: "ten_by_ten",
    label: "10by10",
    defaults: {},
    handlers: {
      initializePlayer(player) {
        player.correctCount = 0;
        player.wrongCount = 10;
        player.scoreBonus = 0;
        player.manualScoreAdjust = 0;
        player.forceDisqualify = false;
        player.score = 0;
      },

      recomputeScores(st) {
        for (const p of Object.values(st.players || {})) {
          p.correctCount = clampCorrectPoints(p.correctCount);
          p.wrongCount = clampWrongPoints(p.wrongCount);
          p.scoreBonus = clampInt(p.scoreBonus, -1000000, 1000000, 0);
          p.manualScoreAdjust = clampInt(p.manualScoreAdjust, -1000000, 1000000, 0);
          p.score = computeBaseScore(p) + p.manualScoreAdjust + p.scoreBonus;
        }
      },

      recomputePlayerStatuses(st) {
        const qualifyReachEnabled = !!st?.rules?.qualifyReachEnabled;
        const dqReachEnabled = !!st?.rules?.dqReachEnabled;

        for (const p of Object.values(st.players || {})) {
          const totalScore = Number(p.score ?? 0);
          const wrongPoints = clampWrongPoints(p.wrongCount);

          if (wrongPoints <= 0) {
            if (!p.dqAt) p.dqAt = Date.now();
            p.qualifiedAt = null;
            p.passRank = null;
            p.status = "disqualified";
          } else if (totalScore >= 100) {
            p.dqAt = null;
            if (!p.qualifiedAt) p.qualifiedAt = Date.now();
            p.status = "qualified";
          } else {
            p.dqAt = null;
            p.qualifiedAt = null;
            p.passRank = null;
            p.status = "active";
          }

          p.reach = {
            qualify: qualifyReachEnabled && p.status === "active" && ((Number(p.correctCount ?? 0) + 1) * wrongPoints >= 100),
            dq: dqReachEnabled && p.status === "active" && wrongPoints <= 1
          };
        }

        const qualified = Object.values(st.players || {})
          .filter((p) => p.qualifiedAt)
          .sort((a, b) => a.qualifiedAt - b.qualifiedAt);

        qualified.forEach((p, idx) => { p.passRank = idx + 1; });
        for (const p of Object.values(st.players || {})) {
          if (!p.qualifiedAt) p.passRank = null;
        }
      },

      buildCorrectPendingOutcomes(_st, playerId) {
        return [{ playerId, correct: 1 }];
      },

      buildWrongPendingOutcomes(st, playerId) {
        const currentWrongPoints = clampWrongPoints(st?.players?.[playerId]?.wrongCount);
        return [{
          playerId,
          wrong: -1,
          scoreSet: null,
          forceDisqualify: currentWrongPoints <= 1
        }];
      },

      applyManualScoreEdit(player, _rules, desiredScore) {
        player.manualScoreAdjust = Number(desiredScore) - computeBaseScore(player) - Number(player?.scoreBonus ?? 0);
      }
    }
  };
}

module.exports = { createTenByTenRuleDefinition };
