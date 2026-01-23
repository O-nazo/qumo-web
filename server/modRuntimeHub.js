// server/modRuntimeHub.js
let runtime = null;

/**
 * runtime は以下を実装したものを想定:
 * - emit(modId, type, payload)
 */
function setModRuntime(r) {
  runtime = r;
}

function getModRuntime() {
  return runtime;
}

module.exports = { setModRuntime, getModRuntime };