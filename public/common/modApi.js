/* global window */

(function () {
  const stateHandlers = new Set();
  const eventHandlers = new Set();

  window.QUMO_MOD_API = {
    onState(fn) { stateHandlers.add(fn); return () => stateHandlers.delete(fn); },
    onEvent(fn) { eventHandlers.add(fn); return () => eventHandlers.delete(fn); },

    emitState(state) { for (const fn of stateHandlers) fn(state); },
    emitEvent(ev) { for (const fn of eventHandlers) fn(ev); },

    dispatch(action) {
      // コア側visualizer.js が差し替える
      console.warn("[MOD] dispatch not wired", action);
    },

    ready(info) {
      // 任意：ログなど
      console.log("[MOD] ready", info);
    }
  };
})();