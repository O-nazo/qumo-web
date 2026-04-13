import {
  isThinkingPlaying,
  playSfxConcurrent,
  startThinkingLoop,
  stopThinking,
  warmupSfx
} from "/common/sfx.js";

let modState = null;
let coreState = null;
let thinkingLoopActive = false;

warmupSfx();

const phaseEl = document.getElementById("phase");
const timerEl = document.getElementById("timer");
const timerMaskEl = document.getElementById("timerMask");
const remainingEl = document.getElementById("remaining");
const remainingUnitEl = document.getElementById("remainingUnit");
const passBlockEl = document.getElementById("passBlock");
const passValueEl = document.getElementById("passValue");

function formatClock(ms, fractionDigits = 2) {
  const safe = Math.max(0, Number(ms ?? 0));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);
  const deciseconds = Math.floor((safe % 1000) / 100);
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  if (fractionDigits <= 0) return `${minuteText}:${secondText}`;
  if (fractionDigits === 1) return `${minuteText}:${secondText}:${deciseconds}`;
  return `${minuteText}:${secondText}:${String(centiseconds).padStart(2, "0")}`;
}

function formatCountdownClock(ms, fractionDigits = 2) {
  const roundedMs = Math.max(0, Math.floor(Number(ms ?? 0) / 1000)) * 1000;
  return formatClock(roundedMs, fractionDigits);
}

function buildMaskedClockHtml(ms, fractionDigits, state) {
  const safe = Math.max(0, Number(ms ?? 0));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  const fractionText = fractionDigits <= 0
    ? ""
    : fractionDigits === 1
      ? String(Math.floor((safe % 1000) / 100))
      : String(Math.floor((safe % 1000) / 10)).padStart(2, "0");

  const slots = [];
  for (const ch of minuteText) {
    slots.push({ hidden: !!state?.timeHideMinute, ch, type: "digit", section: "minute" });
  }
  slots.push({ hidden: false, ch: ":", type: "sep", section: "sep" });
  slots.push({ hidden: !!state?.timeHideSecondTens, ch: secondText[0], type: "digit", section: "second-tens" });
  slots.push({ hidden: !!state?.timeHideSecondOnes, ch: secondText[1], type: "digit", section: "second-ones" });

  if (fractionDigits > 0) {
    slots.push({ hidden: false, ch: ":", type: "sep", section: "sep" });
    for (const ch of fractionText) {
      slots.push({ hidden: !!state?.timeHideFraction, ch, type: "digit", section: "fraction" });
    }
  }

  return slots.map(({ hidden, ch, type, section }) => {
    const cls = hidden ? `maskSlot ${type} ${section} is-hidden` : `maskSlot ${type} ${section}`;
    return hidden
      ? `<span class="${cls}"><span class="maskChar">${ch}</span><span class="maskGlyph">?</span></span>`
      : `<span class="${cls}"><span class="maskChar">${ch}</span></span>`;
  }).join("");
}

function shouldShowTimeMask(state, phase, displayMs) {
  if (!state?.countUpMode) return false;
  if (!state?.timeHideEnabled) return false;
  if (state?.timeHideOpened) return false;
  if (state?.penaltyActive) return false;
  if (phase === "countdown") return false;
  return Number(displayMs ?? 0) >= Number(state?.timeHideAfterMs ?? 0);
}

function getPhaseLabel(phase) {
  if (modState?.penaltyActive) return "PENALTY";
  switch (phase) {
    case "countdown":
      return "READY";
    case "running":
      return "";
    case "stopped":
      return "PAUSE";
    case "clear":
      return "CLEAR";
    case "timeout":
      return "TIME UP";
    default:
      return "STAND-BY";
  }
}

function computeRemainingCount() {
  const players = Object.values(coreState?.players || {});
  return players.filter((player) => {
    if (!player?.id) return false;
    if (player.connected === false) return false;
    return player.status === "active";
  }).length;
}

function syncThinkingLoop() {
  const shouldPlay = modState?.phase === "running";
  if (shouldPlay) {
    if (thinkingLoopActive && isThinkingPlaying()) return;
    thinkingLoopActive = true;
    void startThinkingLoop();
    return;
  }
  thinkingLoopActive = false;
  stopThinking();
}

function render() {
  if (!modState && !coreState) return;

  document.body.classList.add("is-ready");

  const phase = modState?.phase || "idle";
  const fractionDigits = Number(modState?.displayFractionDigits ?? 2);
  const displayMs = modState?.penaltyActive
    ? modState?.penaltyRemainingMs
    : phase === "countdown"
      ? modState?.displayCountdownMs
      : modState?.displayMs;
  const phaseLabel = getPhaseLabel(phase);
  const isCountdownStartCue = phase === "countdown" && Number(displayMs ?? 0) < 1000;

  document.body.classList.toggle("is-clear", phase === "clear");
  document.body.classList.toggle("is-penalty", !!modState?.penaltyActive);
  phaseEl.textContent = phaseLabel;
  phaseEl.classList.toggle("is-hidden", phaseLabel === "");
  timerEl.classList.toggle("is-start-cue", isCountdownStartCue);
  timerEl.textContent = isCountdownStartCue
    ? "START"
    : phase === "countdown"
      ? formatCountdownClock(displayMs, fractionDigits)
      : formatClock(displayMs ?? modState?.durationMs ?? 0, fractionDigits);
  const showMask = !isCountdownStartCue && shouldShowTimeMask(modState, phase, modState?.displayMs);
  if (timerMaskEl) {
    timerMaskEl.hidden = !showMask;
    timerMaskEl.innerHTML = showMask
      ? buildMaskedClockHtml(modState?.displayMs ?? 0, fractionDigits, modState)
      : "";
  }
  const remainingValue = modState?.goalMode === "timer_only"
    ? "--"
    : String(Math.max(0, Number(modState?.remainingCount ?? computeRemainingCount()))).padStart(2, "0");
  remainingEl.textContent = remainingValue;
  if (remainingUnitEl) {
    remainingUnitEl.textContent = String(modState?.remainingUnit || "");
    remainingUnitEl.style.visibility = remainingUnitEl.textContent ? "visible" : "hidden";
  }
  if (passBlockEl) passBlockEl.hidden = !modState?.passEnabled;
  if (passValueEl) {
    passValueEl.textContent = String(Math.max(0, Number(modState?.passRemaining ?? modState?.passLimit ?? 10))).padStart(2, "0");
  }
  syncThinkingLoop();
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_STATE") {
    coreState = msg.state || null;
    render();
    return;
  }

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    modState = msg.event.state;
    render();
    return;
  }

  if (msg.type === "MOD_EVENT" && msg.event?.type === "PLAY_PASS_SFX") {
    void playSfxConcurrent("pass");
  }
});

window.addEventListener("pagehide", () => {
  thinkingLoopActive = false;
  stopThinking();
});
