// server/modRuntimeHub.js
let runtime = null;
let coreApi = null;

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

function setCoreApi(api) {
  coreApi = api;
}

function getCoreApi() {
  return coreApi;
}

module.exports = {
  setModRuntime,
  getModRuntime,
  setCoreApi,
  getCoreApi,
};