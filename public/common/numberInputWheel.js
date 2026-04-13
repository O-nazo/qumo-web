/* global window, document, Event */

(function () {
  function parseStep(input) {
    const raw = String(input?.step ?? "").trim().toLowerCase();
    if (!raw || raw === "any") return 1;
    const step = Number(raw);
    return Number.isFinite(step) && step > 0 ? step : 1;
  }

  function parseBound(input, key) {
    const raw = String(input?.getAttribute?.(key) ?? "").trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function precisionFromStep(step) {
    const text = String(step);
    if (!text.includes(".")) return 0;
    return text.length - text.indexOf(".") - 1;
  }

  function clamp(value, min, max) {
    let next = value;
    if (min !== null) next = Math.max(min, next);
    if (max !== null) next = Math.min(max, next);
    return next;
  }

  function emitValueChanged(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function handleWheel(event) {
    const input = event.target instanceof Element
      ? event.target.closest('input[type="number"]:not([data-no-wheel-spinner])')
      : null;
    if (!input) return;
    if (input.disabled || input.readOnly) return;

    event.preventDefault();

    if (document.activeElement !== input) {
      input.focus({ preventScroll: true });
    }

    const step = parseStep(input);
    const min = parseBound(input, "min");
    const max = parseBound(input, "max");
    const current = Number(input.value || 0);
    const base = Number.isFinite(current) ? current : (min ?? 0);
    const direction = event.deltaY < 0 ? 1 : -1;
    const precision = precisionFromStep(step);

    const rawNext = clamp(base + step * direction, min, max);
    const next = precision > 0 ? Number(rawNext.toFixed(precision)) : Math.round(rawNext);

    if (String(next) === String(input.value)) return;
    input.value = String(next);
    emitValueChanged(input);
  }

  function installNumberInputWheel(root = document) {
    if (!root || root.__qumoNumberWheelInstalled) return;
    root.__qumoNumberWheelInstalled = true;
    root.addEventListener("wheel", handleWheel, { passive: false, capture: true });
  }

  window.QUMO_NUMBER_INPUT_WHEEL = {
    install: installNumberInputWheel
  };

  if (document?.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => installNumberInputWheel(document), { once: true });
  } else {
    installNumberInputWheel(document);
  }
})();
