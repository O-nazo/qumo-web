const { createNormalRuleDefinition } = require("./catalog/normal");
const { createAttackSurvivalRuleDefinition } = require("./catalog/attackSurvival");
const { createUpDownRuleDefinition } = require("./catalog/upDown");
const { createTenByTenRuleDefinition } = require("./catalog/tenByTen");

function createRuleRegistry(deps) {
  const normalRule = createNormalRuleDefinition(deps);
  const attackSurvivalRule = createAttackSurvivalRuleDefinition(deps);
  const upDownRule = createUpDownRuleDefinition(deps);
  const tenByTenRule = createTenByTenRuleDefinition(deps);
  const rules = new Map([
    [normalRule.id, normalRule],
    [attackSurvivalRule.id, attackSurvivalRule],
    [upDownRule.id, upDownRule],
    [tenByTenRule.id, tenByTenRule]
  ]);

  function getRuleDefinition(ruleId) {
    return rules.get(String(ruleId || "").trim()) || normalRule;
  }

  function getRuleDefinitions() {
    return Array.from(rules.values());
  }

  function getActiveRuleDefinition(st) {
    return getRuleDefinition(st?.rules?.ruleProfile || normalRule.id);
  }

  function sanitizeRuleProfile(ruleId) {
    return getRuleDefinition(ruleId).id;
  }

  return {
    getActiveRuleDefinition,
    getRuleDefinition,
    getRuleDefinitions,
    sanitizeRuleProfile
  };
}

module.exports = { createRuleRegistry };
