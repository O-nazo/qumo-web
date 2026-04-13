function createUpDownRuleDefinition({ clampInt }) {
  function clampGain(value) {
    return clampInt(value, 1, 1000000, 1);
  }

  function clampGoal(value) {
    return clampInt(value, 1, 1000000, 7);
  }

  function clampWrongLimit(value) {
    return clampInt(value, 1, 1000000, 2);
  }

  return {
    id: "up_down",
    label: "Up Down",
    defaults: {
      upDownCorrectGain: 1,
      upDownQualifyScore: 7,
      upDownDqWrongCount: 2
    },
    handlers: {
      initializePlayer(player) {
        player.manualScoreAdjust = 0;
        player.forceDisqualify = false;
        player.score = 0;
      },

      recomputeScores(st) {
        for (const p of Object.values(st.players || {})) {
          p.correctCount = clampInt(p.correctCount, 0, 1000000, 0);
          p.wrongCount = clampInt(p.wrongCount, 0, 1000000, 0);
          p.manualScoreAdjust = 0;
          p.score = Math.max(0, clampInt(p.score, 0, 1000000, 0));
        }
      },

      recomputePlayerStatuses(st) {
        const qualifyScore = clampGoal(st?.rules?.upDownQualifyScore);
        const dqWrongCount = clampWrongLimit(st?.rules?.upDownDqWrongCount);
        const gain = clampGain(st?.rules?.upDownCorrectGain);
        const qualifyReachEnabled = !!st?.rules?.qualifyReachEnabled;
        const dqReachEnabled = !!st?.rules?.dqReachEnabled;

        for (const p of Object.values(st.players || {})) {
          const score = Math.max(0, Number(p.score ?? 0));
          const wrongCount = Math.max(0, Number(p.wrongCount ?? 0));
          const isQualified = score >= qualifyScore;
          const isDisqualified = !!p.forceDisqualify || wrongCount >= dqWrongCount;

          p.score = score;
          if (isDisqualified) {
            if (!p.dqAt) p.dqAt = Date.now();
            p.qualifiedAt = null;
            p.passRank = null;
            p.status = "disqualified";
          } else if (isQualified) {
            p.dqAt = null;
            if (!p.qualifiedAt) p.qualifiedAt = Date.now();
            p.status = "qualified";
          } else {
            p.dqAt = null;
            p.qualifiedAt = null;
            p.passRank = null;
            p.status = "active";
          }

          p.reach = { qualify: false, dq: false };
          if (p.status === "active") {
            if (qualifyReachEnabled && score + gain >= qualifyScore) {
              p.reach.qualify = true;
            }
            if (dqReachEnabled && (wrongCount + 1 >= dqWrongCount || score <= 0)) {
              p.reach.dq = true;
            }
          }
        }

        const qualified = Object.values(st.players || {})
          .filter((p) => p.qualifiedAt)
          .sort((a, b) => a.qualifiedAt - b.qualifiedAt);

        qualified.forEach((p, idx) => { p.passRank = idx + 1; });
        for (const p of Object.values(st.players || {})) {
          if (!p.qualifiedAt) p.passRank = null;
        }
      },

      buildCorrectPendingOutcomes(st, playerId) {
        const gain = clampGain(st?.rules?.upDownCorrectGain);
        return [{
          playerId,
          correct: 1,
          scoreDelta: gain
        }];
      },

      buildWrongPendingOutcomes(st, playerId) {
        const currentScore = Math.max(0, Number(st?.players?.[playerId]?.score ?? 0));
        return [{
          playerId,
          wrong: 1,
          scoreSet: 0,
          forceDisqualify: currentScore <= 0
        }];
      }
    }
  };
}

module.exports = { createUpDownRuleDefinition };
