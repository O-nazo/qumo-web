const BUZZ_MODE_LABELS = {
  endless: "エンドレスチャンス",
  single: "シングルチャンス",
  cultq: "連打エンドレスチャンス",
  early_endless: "早抜けエンドレス",
  early_single: "早抜けシングル"
};

const BUZZ_MODE_DESCRIPTIONS = {
  endless: "回答者が誤答した場合、ボタンを押した順に回答権が繰り下がります。",
  single: "ボタンを押した1人にだけ回答権があり、誤答すると問題が終了します。",
  cultq: "回答者が誤答した場合、着順をリセットし再度早押しを判定します。",
  early_endless: "全員が正解するか制限時間まで問題が続きます。",
  early_single: "誰かが正解しても問題が続きますが、誤答すると回答権を失います。"
};

function getBuzzModeKey(st) {
  const raw = String(st?.rules?.buzzMode ?? "endless").toLowerCase();
  if (raw === "cultq" || raw === "cult" || raw === "cartq") return "cultq";
  if (raw === "early_endless" || raw === "survival_endless" || raw === "hayanuke_endless") return "early_endless";
  if (raw === "early_single" || raw === "survival_single" || raw === "hayanuke_single") return "early_single";
  if (raw === "single") return "single";
  return "endless";
}

function formatSignedPoints(points) {
  const value = Number(points ?? 0);
  if (!Number.isFinite(value)) return "0";
  return value >= 0 ? `+${value}` : `${value}`;
}

function buildNormalRuleOverlayLines(st) {
  const rules = st?.rules || {};
  const buzzMode = getBuzzModeKey(st);
  const correctPoints = Number(rules.correctPoints ?? 0);
  const wrongPoints = Number(rules.wrongPoints ?? 0);
  const restPenalty = Number(rules.restPenalty ?? 0);
  const lines = [{
    kind: "bullet",
    text: BUZZ_MODE_LABELS[buzzMode] || BUZZ_MODE_LABELS.endless,
    paragraphStart: true
  }, {
    kind: "note",
    text: BUZZ_MODE_DESCRIPTIONS[buzzMode] || BUZZ_MODE_DESCRIPTIONS.endless
  }];

  const showCorrectLine = correctPoints !== 0;
  const showWrongLine = wrongPoints !== 0 || restPenalty >= 1;
  if (showCorrectLine || showWrongLine) {
    lines.push({
      kind: "scoreRule",
      correctPoints,
      wrongPoints,
      restPenalty,
      showCorrectLine,
      showWrongLine,
      paragraphStart: true
    });
  }

  const countTargets = [];
  if (rules.qualifyCountEnabled) {
    countTargets.push(`${Number(rules.qualifyCorrectCount ?? 0)}○`);
  }
  if (rules.dqWrongEnabled) {
    countTargets.push(`${Number(rules.dqWrongCount ?? 0)}✕`);
  }

  if (rules.qualifyEnabled || rules.dqEnabled) {
    lines.push({
      kind: "targets",
      qualifyEnabled: !!rules.qualifyEnabled,
      qualifyScore: Number(rules.qualifyScore ?? 0),
      dqEnabled: !!rules.dqEnabled,
      dqScore: Number(rules.dqScore ?? 0),
      paragraphStart: true
    });
  }

  if (countTargets.length) {
    lines.push({
      kind: "countTargets",
      items: countTargets,
      paragraphStart: true
    });
  }

  return lines;
}

function buildAttackSurvivalOverlayLines(st) {
  const rules = st?.rules || {};
  const buzzMode = getBuzzModeKey(st);

  return [{
    kind: "bullet",
    text: BUZZ_MODE_LABELS[buzzMode] || BUZZ_MODE_LABELS.endless,
    paragraphStart: true
  }, {
    kind: "note",
    text: BUZZ_MODE_DESCRIPTIONS[buzzMode] || BUZZ_MODE_DESCRIPTIONS.endless
  }, {
    kind: "bullet",
    text: `各自 ${Number(rules.attackStartPoints ?? 20)}P を持って開始`,
    paragraphStart: true
  }, {
    kind: "bullet",
    text: `正解すると自分以外全員 -${Number(rules.attackCorrectDamage ?? 1)}P`
  }, {
    kind: "bullet",
    text: `誤答すると自分 -${Number(rules.attackWrongDamage ?? 1)}P`
  }, {
    kind: "bullet",
    text: "0Pで失格"
  }];
}

function buildUpDownOverlayLines(st) {
  const rules = st?.rules || {};
  const buzzMode = getBuzzModeKey(st);

  return [{
    kind: "bullet",
    text: BUZZ_MODE_LABELS[buzzMode] || BUZZ_MODE_LABELS.endless,
    paragraphStart: true
  }, {
    kind: "note",
    text: BUZZ_MODE_DESCRIPTIONS[buzzMode] || BUZZ_MODE_DESCRIPTIONS.endless
  }, {
    kind: "bullet",
    text: `正解 +${Number(rules.upDownCorrectGain ?? 1)}P`,
    paragraphStart: true
  }, {
    kind: "bullet",
    text: `${Number(rules.upDownQualifyScore ?? 7)}Pで勝ち抜け`
  }, {
    kind: "bullet",
    text: "誤答で0Pに戻る",
    paragraphStart: true
  }, {
    kind: "bullet",
    text: `${Number(rules.upDownDqWrongCount ?? 2)}回誤答、または0P時の誤答で失格`
  }];
}

function buildTenByTenOverlayLines(st) {
  const buzzMode = getBuzzModeKey(st);

  return [{
    kind: "bullet",
    text: BUZZ_MODE_LABELS[buzzMode] || BUZZ_MODE_LABELS.endless,
    paragraphStart: true
  }, {
    kind: "note",
    text: BUZZ_MODE_DESCRIPTIONS[buzzMode] || BUZZ_MODE_DESCRIPTIONS.endless
  }, {
    kind: "bullet",
    text: "各自 ○0 / ✕10 で開始",
    paragraphStart: true
  }, {
    kind: "bullet",
    text: "正解で ○ +1"
  }, {
    kind: "bullet",
    text: "誤答で ✕ -1"
  }, {
    kind: "bullet",
    text: "○ × ✕ が100で勝ち抜け",
    paragraphStart: true
  }, {
    kind: "bullet",
    text: "✕ が0で失格"
  }];
}

function buildCommonDisplayRuleLines(st) {
  const rules = st?.rules || {};
  const qualifyPlayerCount = Number(rules.displayQualifyPlayerCount ?? 0);
  const disqualifiedPlayerCount = Number(rules.displayDisqualifiedPlayerCount ?? 0);
  const lines = [];

  if (qualifyPlayerCount > 0) {
    lines.push({
      kind: "bullet",
      text: `${qualifyPlayerCount}人 勝ち抜けで終了`,
      paragraphStart: true
    });
  }
  if (disqualifiedPlayerCount > 0) {
    lines.push({
      kind: "bullet",
      text: `${disqualifiedPlayerCount}人 失格まで続行`
    });
  }

  return lines;
}

export const RULE_PROFILE_DEFINITIONS = [
  {
    id: "standard",
    label: "Normal(m◯n✕/+m-n)",
    presenter: {
      buildOverlayLines: buildNormalRuleOverlayLines
    }
  },
  {
    id: "attack_survival",
    label: "Attack Survival",
    presenter: {
      buildOverlayLines: buildAttackSurvivalOverlayLines
    }
  },
  {
    id: "up_down",
    label: "Up Down",
    presenter: {
      buildOverlayLines: buildUpDownOverlayLines
    }
  },
  {
    id: "ten_by_ten",
    label: "10by10",
    presenter: {
      buildOverlayLines: buildTenByTenOverlayLines
    }
  }
];

export function getRuleProfileDefinition(ruleId) {
  return RULE_PROFILE_DEFINITIONS.find((rule) => rule.id === String(ruleId || "").trim())
    || RULE_PROFILE_DEFINITIONS[0];
}

export function buildRuleOverlayLines(st) {
  const profileLines = getRuleProfileDefinition(st?.rules?.ruleProfile).presenter.buildOverlayLines(st);
  return [...profileLines, ...buildCommonDisplayRuleLines(st)];
}

export { formatSignedPoints };
