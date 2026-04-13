function createNormalRuleDefinition({ clampInt }) {
  return {
    id: "standard",
    label: "Normal(m◯n✕/+m-n)",
    defaults: {
      ruleProfile: "standard",
      correctPoints: 1,
      wrongPoints: -1,
      restPenalty: 1,
      qualifyEnabled: false,
      qualifyScore: 4,
      dqEnabled: false,
      dqScore: -3,
      qualifyCountEnabled: false,
      qualifyCorrectCount: 7,
      dqWrongEnabled: false,
      dqWrongCount: 3,
      qualifyReachEnabled: false,
      dqReachEnabled: false
    },
    handlers: {
      initializePlayer(player) {
        player.manualScoreAdjust = 0;
        player.score = 0;
      },

      recomputeScores(st) {
        const cp = clampInt(st.rules?.correctPoints, -1000, 1000000, 1);
        const wp = clampInt(st.rules?.wrongPoints, -1000, 1000000, -1);

        for (const p of Object.values(st.players || {})) {
          const c = clampInt(p.correctCount, 0, 1000000, 0);
          const w = clampInt(p.wrongCount, 0, 1000000, 0);
          const manualAdjust = clampInt(p.manualScoreAdjust, -1000000, 1000000, 0);
          p.correctCount = c;
          p.wrongCount = w;
          p.manualScoreAdjust = manualAdjust;
          p.score = c * cp + w * wp + manualAdjust;
        }
      },

      recomputePlayerStatuses(st) {
        const rules = st.rules || {};

        const qualifyEnabled = !!rules.qualifyEnabled;
        const dqEnabled = !!rules.dqEnabled;
        const qualifyScore = clampInt(rules.qualifyScore, -1000, 1000000, 4);
        const dqScore = clampInt(rules.dqScore, -1000, 1000000, -3);

        const qualifyCountEnabled = !!rules.qualifyCountEnabled;
        const qualifyCorrectCount = clampInt(rules.qualifyCorrectCount, 0, 1000000, 4);

        const dqWrongEnabled = !!rules.dqWrongEnabled;
        const dqWrongCount = clampInt(rules.dqWrongCount, 0, 1000000, 3);

        const cp = clampInt(rules.correctPoints, -1000, 1000000, 1);
        const wp = clampInt(rules.wrongPoints, -1000, 1000000, -1);

        for (const p of Object.values(st.players || {})) {
          const score = Number(p.score ?? 0);
          const correctCount = Number(p.correctCount ?? 0);
          const wrongCount = Number(p.wrongCount ?? 0);

          const isQualify =
            (qualifyEnabled && score >= qualifyScore) ||
            (qualifyCountEnabled && correctCount >= qualifyCorrectCount);

          const isDq =
            (dqEnabled && score <= dqScore) ||
            (dqWrongEnabled && wrongCount >= dqWrongCount);

          if (isDq) {
            if (!p.dqAt) p.dqAt = Date.now();
            p.qualifiedAt = null;
          } else {
            p.dqAt = null;
            if (isQualify) {
              if (!p.qualifiedAt) p.qualifiedAt = Date.now();
            } else {
              p.qualifiedAt = null;
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

        const qualifyReachEnabled = !!rules.qualifyReachEnabled;
        const dqReachEnabled = !!rules.dqReachEnabled;

        for (const p of Object.values(st.players || {})) {
          const score = Number(p.score ?? 0);
          const correctCount = Number(p.correctCount ?? 0);
          const wrongCount = Number(p.wrongCount ?? 0);

          const isQualified = !!p.qualifiedAt;
          const isDisqualified = !!p.dqAt;

          if (isDisqualified) p.status = "disqualified";
          else if (isQualified) p.status = "qualified";
          else p.status = "active";

          p.reach = { qualify: false, dq: false };

          if (p.status === "active") {
            if (qualifyEnabled && qualifyReachEnabled && score + cp >= qualifyScore) {
              p.reach.qualify = true;
            }
            if (qualifyCountEnabled && qualifyReachEnabled && correctCount + 1 >= qualifyCorrectCount) {
              p.reach.qualify = true;
            }
            if (dqEnabled && dqReachEnabled && score + wp <= dqScore) {
              p.reach.dq = true;
            }
            if (dqWrongEnabled && dqReachEnabled && wrongCount + 1 >= dqWrongCount) {
              p.reach.dq = true;
            }
          }
        }
      },

      buildCorrectPendingOutcomes(_st, playerId) {
        return [{ playerId, correct: 1 }];
      },

      buildWrongPendingOutcomes(st, playerId) {
        const penalty = clampInt(st?.rules?.restPenalty, 0, 20, 0);
        return [{
          playerId,
          wrong: 1,
          rest: penalty > 0 ? penalty : 0
        }];
      },

      applyManualScoreEdit(player, rules, desiredScore) {
        const cp = clampInt(rules?.correctPoints, -1000, 1000000, 1);
        const wp = clampInt(rules?.wrongPoints, -1000, 1000000, -1);
        const correctCount = clampInt(player?.correctCount, 0, 1000000, 0);
        const wrongCount = clampInt(player?.wrongCount, 0, 1000000, 0);
        player.manualScoreAdjust = Number(desiredScore) - (correctCount * cp + wrongCount * wp);
      }
    }
  };
}

module.exports = { createNormalRuleDefinition };
