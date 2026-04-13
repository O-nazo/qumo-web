function createAttackSurvivalRuleDefinition({ clampInt }) {
  function clampAttackStartPoints(value) {
    return clampInt(value, 1, 1000000, 20);
  }

  function clampAttackDelta(value) {
    return clampInt(value, 1, 1000000, 1);
  }

  function getActivePlayers(st, { excludePlayerId = null } = {}) {
    return Object.values(st?.players || {}).filter((player) => {
      if (!player?.id) return false;
      if (excludePlayerId && player.id === excludePlayerId) return false;
      if (player.connected === false) return false;
      return String(player.status || "active") !== "disqualified";
    });
  }

  return {
    id: "attack_survival",
    label: "Attack Survival",
    defaults: {
      attackStartPoints: 20,
      attackCorrectDamage: 1,
      attackWrongDamage: 1
    },
    handlers: {
      initializePlayer(player, rules) {
        player.manualScoreAdjust = 0;
        player.score = clampAttackStartPoints(rules?.attackStartPoints);
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
        for (const p of Object.values(st.players || {})) {
          const score = Math.max(0, Number(p.score ?? 0));
          p.score = score;

          if (score <= 0) {
            if (!p.dqAt) p.dqAt = Date.now();
            p.status = "disqualified";
          } else {
            p.dqAt = null;
            p.status = "active";
          }

          p.qualifiedAt = null;
          p.passRank = null;
          p.reach = { qualify: false, dq: false };
        }
      },

      buildCorrectPendingOutcomes(st, playerId) {
        const damage = clampAttackDelta(st?.rules?.attackCorrectDamage);
        return getActivePlayers(st, { excludePlayerId: playerId }).map((player) => ({
          playerId: player.id,
          scoreDelta: -damage
        })).concat([{ playerId, correct: 1 }]);
      },

      buildWrongPendingOutcomes(st, playerId) {
        const penalty = clampAttackDelta(st?.rules?.attackWrongDamage);
        return [{
          playerId,
          wrong: 1,
          scoreDelta: -penalty
        }];
      }
    }
  };
}

module.exports = { createAttackSurvivalRuleDefinition };
