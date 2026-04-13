const phaseText = document.getElementById("phaseText");
const clock = document.getElementById("clock");
const remainingValue = document.getElementById("remainingValue");
const remainingUnit = document.getElementById("remainingUnit");
const passBlock = document.getElementById("passBlock");
const passValue = document.getElementById("passValue");
const goalHint = document.getElementById("goalHint");
const goalMode = document.getElementById("goalMode");
const goalCountField = document.getElementById("goalCountField");
const goalCount = document.getElementById("goalCount");
const wrongPenaltyEnabled = document.getElementById("wrongPenaltyEnabled");
const wrongPenaltySec = document.getElementById("wrongPenaltySec");
const passEnabled = document.getElementById("passEnabled");
const passCount = document.getElementById("passCount");
const countdownSec = document.getElementById("countdownSec");
const countdownMillis = document.getElementById("countdownMillis");
const durationMin = document.getElementById("durationMin");
const durationSec = document.getElementById("durationSec");
const displayFractionDigits = document.getElementById("displayFractionDigits");
const timeHideMin = document.getElementById("timeHideMin");
const timeHideSec = document.getElementById("timeHideSec");
const timeHideMillis = document.getElementById("timeHideMillis");
const timeHideMinute = document.getElementById("timeHideMinute");
const timeHideSecondTens = document.getElementById("timeHideSecondTens");
const timeHideSecondOnes = document.getElementById("timeHideSecondOnes");
const timeHideFraction = document.getElementById("timeHideFraction");
const btnApplyDuration = document.getElementById("btnApplyDuration");
const btnOpenHiddenTime = document.getElementById("btnOpenHiddenTime");
const btnPass = document.getElementById("btnPass");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnReset = document.getElementById("btnReset");

let lastState = null;
let detachParentSpaceBinding = null;
let detachLocalSpaceBinding = null;

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function sendControllerShortcut(shortcut) {
  sendCmd({ type: "CONTROLLER_SHORTCUT", shortcut });
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = String(target.type || "").toLowerCase();
    return type === "text" || type === "search" || type === "email" || type === "url" || type === "password";
  }
  return !!target.closest?.('[contenteditable="true"]');
}

function handlePassAction() {
  const state = lastState;
  const canPass = !!state?.passEnabled
    && Number(state.passRemaining ?? 0) > 0
    && (state.phase === "running" || state.phase === "countdown" || state.phase === "stopped");
  if (!canPass) return;

  sendCmd({ type: "TR_PASS" });
  sendCmd({ type: "BUZZER_RESET" });
}

function splitMs(totalMs) {
  const safe = Math.max(0, Math.trunc(Number(totalMs ?? 0) || 0));
  const totalSeconds = Math.floor(safe / 1000);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    milliseconds: safe % 1000
  };
}

function handleParentSpaceKeydown(ev) {
  if (ev.defaultPrevented || ev.repeat) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.code !== "Space" && String(ev.key || "") !== " ") return;
  if (isTypingTarget(ev.target)) return;
  ev.preventDefault();
  handlePassAction();
}

function handleLocalShortcutKeydown(ev) {
  if (ev.defaultPrevented || ev.repeat) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (isTypingTarget(ev.target)) return;

  const key = String(ev.key || "").toLowerCase();
  if (ev.code === "Space" || key === " ") {
    ev.preventDefault();
    handlePassAction();
    return;
  }
  if (ev.code === "Numpad2") {
    ev.preventDefault();
    sendControllerShortcut("PRESENT");
    return;
  }
  if (ev.code === "Numpad1") {
    ev.preventDefault();
    sendControllerShortcut("RESET");
    return;
  }
  if (ev.code === "Numpad3") {
    ev.preventDefault();
    sendControllerShortcut("THINKING");
    return;
  }
  if (ev.code === "Numpad0") {
    ev.preventDefault();
    sendControllerShortcut("CORRECT");
    return;
  }
  if (ev.code === "NumpadDecimal") {
    ev.preventDefault();
    sendControllerShortcut("SKIP_OR_WRONG");
    return;
  }
  if (key === "backspace") {
    ev.preventDefault();
    sendControllerShortcut("SKIP");
    return;
  }
  if (ev.code === "NumpadEnter") {
    ev.preventDefault();
    sendControllerShortcut("MOD_PRIMARY");
    return;
  }
  if (key === "q") {
    ev.preventDefault();
    sendCmd({ type: "PRESENT" });
    return;
  }
  if (key === "r") {
    ev.preventDefault();
    sendCmd({ type: "BUZZER_RESET" });
    return;
  }
  if (key === "t") {
    ev.preventDefault();
    sendCmd({ type: "PLAY_SFX", key: "thinking" });
    return;
  }
  if (key === "o") {
    ev.preventDefault();
    sendCmd({ type: "JUDGE_CORRECT" });
    return;
  }
  if (key === "x") {
    ev.preventDefault();
    sendCmd({ type: "SKIP_OR_WRONG" });
  }
}

function attachParentSpaceBinding() {
  try {
    const parentWindow = window.parent;
    detachLocalSpaceBinding?.();
    window.addEventListener("keydown", handleLocalShortcutKeydown, true);
    detachLocalSpaceBinding = () => window.removeEventListener("keydown", handleLocalShortcutKeydown, true);

    if (!parentWindow || parentWindow === window) return;

    detachParentSpaceBinding?.();

    const listener = (ev) => handleParentSpaceKeydown(ev);
    parentWindow.addEventListener("keydown", listener, true);
    detachParentSpaceBinding = () => {
      parentWindow.removeEventListener("keydown", listener, true);
      if (parentWindow.__timeracePassSpaceCleanup === detachParentSpaceBinding) {
        delete parentWindow.__timeracePassSpaceCleanup;
      }
    };

    if (typeof parentWindow.__timeracePassSpaceCleanup === "function") {
      parentWindow.__timeracePassSpaceCleanup();
    }
    parentWindow.__timeracePassSpaceCleanup = detachParentSpaceBinding;
    window.addEventListener("beforeunload", () => {
      detachLocalSpaceBinding?.();
      detachParentSpaceBinding?.();
    }, { once: true });
  } catch {}
}

function formatClock(ms, fractionDigits = 2) {
  const safe = Math.max(0, Number(ms ?? 0));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);
  const deciseconds = Math.floor((safe % 1000) / 100);

  const parts = [
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
    String(centiseconds).padStart(2, "0")
  ];
  if (fractionDigits === 1) {
    parts[2] = String(deciseconds);
  } else if (fractionDigits <= 0) {
    return `${parts[0]}:${parts[1]}`;
  }
  return parts.join(":");
}

function formatCountdownClock(ms, fractionDigits = 2) {
  const roundedMs = Math.max(0, Math.floor(Number(ms ?? 0) / 1000)) * 1000;
  return formatClock(roundedMs, fractionDigits);
}

function getPhaseLabel(state) {
  if (state?.penaltyActive) return "PENALTY";
  switch (state?.phase) {
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

function getModeLabel(mode) {
  switch (mode) {
    case "correct_count":
      return "正解数ノルマ";
    case "timer_only":
      return "ノルマなし";
    default:
      return "勝ち抜けノルマ";
  }
}

function updateGoalFields(state) {
  const mode = state?.goalMode || "survivor";
  if (goalMode) goalMode.value = mode;
  if (goalCountField) goalCountField.hidden = mode === "timer_only";

  if (goalHint) {
    goalHint.hidden = mode === "timer_only";
    goalHint.textContent = mode === "correct_count"
      ? "全員合計の正解数"
      : "0で参加者全員";
  }

  if (goalCount) {
    if (mode === "correct_count") {
      goalCount.min = "1";
      goalCount.max = "9999";
    } else {
      goalCount.min = "0";
      goalCount.max = "999";
    }
  }

  if (document.activeElement !== goalCount && goalCount) {
    goalCount.value = mode === "correct_count"
      ? String(Number(state?.correctGoalCount ?? 10))
      : String(Number(state?.survivorGoalCount ?? 0));
  }

  if (wrongPenaltyEnabled) wrongPenaltyEnabled.checked = !!state?.wrongPenaltyEnabled;
  if (document.activeElement !== wrongPenaltySec && wrongPenaltySec) {
    wrongPenaltySec.value = String(Number(state?.wrongPenaltySec ?? 10));
  }
  if (passEnabled) passEnabled.checked = !!state?.passEnabled;
  if (document.activeElement !== passCount && passCount) {
    passCount.value = String(Number(state?.passLimit ?? 10));
  }
  if (document.activeElement !== countdownSec && countdownSec) {
    countdownSec.value = String(Number(state?.countdownSec ?? 10));
  }
  if (document.activeElement !== countdownMillis && countdownMillis) {
    countdownMillis.value = String(Number(state?.countdownMillis ?? 0));
  }
  if (displayFractionDigits) {
    displayFractionDigits.value = String(Number(state?.displayFractionDigits ?? 2));
  }
  const hideStart = splitMs(Number(state?.timeHideAfterMs ?? 30000));
  if (document.activeElement !== timeHideMin && timeHideMin) {
    timeHideMin.value = String(hideStart.minutes);
  }
  if (document.activeElement !== timeHideSec && timeHideSec) {
    timeHideSec.value = String(hideStart.seconds);
  }
  if (document.activeElement !== timeHideMillis && timeHideMillis) {
    timeHideMillis.value = String(hideStart.milliseconds);
  }
  if (timeHideMinute) timeHideMinute.checked = !!state?.timeHideMinute;
  if (timeHideSecondTens) timeHideSecondTens.checked = !!state?.timeHideSecondTens;
  if (timeHideSecondOnes) timeHideSecondOnes.checked = !!state?.timeHideSecondOnes;
  if (timeHideFraction) timeHideFraction.checked = !!state?.timeHideFraction;
}

function render() {
  const state = lastState;
  if (!state) return;
  document.body.classList.toggle("is-clear", state.phase === "clear");
  document.body.classList.toggle("is-penalty", !!state.penaltyActive);
  phaseText.textContent = getPhaseLabel(state);
  phaseText.classList.toggle("is-hidden", phaseText.textContent === "");
  const ms = state.penaltyActive
    ? state.penaltyRemainingMs
    : state.phase === "countdown"
      ? state.displayCountdownMs
      : state.displayMs;
  clock.textContent = state.phase === "countdown"
    ? formatCountdownClock(ms, Number(state.displayFractionDigits ?? 2))
    : formatClock(ms, Number(state.displayFractionDigits ?? 2));
  if (state.goalMode === "survivor") {
    const unit = state.remainingUnit || "人";
    if (remainingValue) remainingValue.textContent = String(Math.max(0, Number(state.remainingCount ?? 0))).padStart(2, "0");
    if (remainingUnit) remainingUnit.textContent = unit;
  } else if (state.goalMode === "correct_count") {
    const unit = state.remainingUnit || "問";
    if (remainingValue) remainingValue.textContent = String(Math.max(0, Number(state.remainingCount ?? 0))).padStart(2, "0");
    if (remainingUnit) remainingUnit.textContent = unit;
  } else {
    if (remainingValue) remainingValue.textContent = "--";
    if (remainingUnit) remainingUnit.textContent = "";
  }
  if (passBlock) passBlock.hidden = !state.passEnabled;
  if (passValue) {
    passValue.textContent = String(Math.max(0, Number(state.passRemaining ?? state.passLimit ?? 10))).padStart(2, "0");
  }
  updateGoalFields(state);

  if (document.activeElement !== durationMin && document.activeElement !== durationSec) {
    const totalSec = Math.max(0, Math.round(Number(state.durationMs ?? 0) / 1000));
    if (durationMin) durationMin.value = String(Math.floor(totalSec / 60));
    if (durationSec) durationSec.value = String(totalSec % 60);
  }

  const canPass = !!state.passEnabled
    && Number(state.passRemaining ?? 0) > 0
    && (state.phase === "running" || state.phase === "countdown" || state.phase === "stopped");
  if (btnPass) btnPass.disabled = !canPass;
  const canOpenHiddenTime = !!state.countUpMode
    && !!state.timeHideEnabled
    && !state.timeHideOpened
    && (state.phase === "stopped" || state.phase === "timeout" || state.phase === "clear");
  if (btnOpenHiddenTime) btnOpenHiddenTime.disabled = !canOpenHiddenTime;
  btnStart.disabled = state.phase === "running" || state.phase === "countdown" || state.phase === "clear";
  btnStop.disabled = !(state.phase === "running" || state.phase === "countdown");
}

btnPass?.addEventListener("click", handlePassAction);
btnStart?.addEventListener("click", () => sendCmd({ type: "TR_START" }));
btnStop?.addEventListener("click", () => sendCmd({ type: "TR_STOP" }));
btnReset?.addEventListener("click", () => sendCmd({ type: "TR_RESET" }));
btnOpenHiddenTime?.addEventListener("click", () => sendCmd({ type: "TR_OPEN_HIDDEN_TIME" }));

function submitDuration() {
  const minutes = Math.max(0, Math.trunc(Number(durationMin?.value ?? 0) || 0));
  const seconds = Math.max(0, Math.trunc(Number(durationSec?.value ?? 0) || 0));
  const total = Math.max(0, Math.min(3599, minutes * 60 + seconds));

  if (durationMin) durationMin.value = String(Math.floor(total / 60));
  if (durationSec) durationSec.value = String(total % 60);

  sendCmd({ type: "TR_SET_DURATION", seconds: total });
}

function normalizeDurationInputs() {
  const minutes = Math.max(0, Math.trunc(Number(durationMin?.value ?? 0) || 0));
  const seconds = Math.max(0, Math.trunc(Number(durationSec?.value ?? 0) || 0));
  const total = Math.max(0, Math.min(3599, minutes * 60 + seconds));

  if (durationMin) durationMin.value = String(Math.floor(total / 60));
  if (durationSec) durationSec.value = String(total % 60);
}

function submitGoalMode() {
  sendCmd({ type: "TR_SET_GOAL_MODE", mode: String(goalMode?.value || "survivor") });
}

function submitGoalCount() {
  const mode = String(goalMode?.value || "survivor");
  if (mode === "timer_only") return;

  if (mode === "correct_count") {
    const count = Math.max(1, Math.min(9999, Math.trunc(Number(goalCount?.value ?? 1) || 1)));
    if (goalCount) goalCount.value = String(count);
    sendCmd({ type: "TR_SET_CORRECT_GOAL", count });
    return;
  }

  const count = Math.max(0, Math.min(999, Math.trunc(Number(goalCount?.value ?? 0) || 0)));
  if (goalCount) goalCount.value = String(count);
  sendCmd({ type: "TR_SET_SURVIVOR_GOAL", count });
}

function submitWrongPenalty() {
  const seconds = Math.max(1, Math.min(999, Math.trunc(Number(wrongPenaltySec?.value ?? 10) || 10)));
  if (wrongPenaltySec) wrongPenaltySec.value = String(seconds);
  sendCmd({
    type: "TR_SET_WRONG_PENALTY",
    enabled: !!wrongPenaltyEnabled?.checked,
    seconds
  });
}

function submitCountdown() {
  const seconds = Math.max(0, Math.min(999, Math.trunc(Number(countdownSec?.value ?? 10) || 0)));
  const milliseconds = Math.max(0, Math.min(999, Math.trunc(Number(countdownMillis?.value ?? 0) || 0)));
  if (countdownSec) countdownSec.value = String(seconds);
  if (countdownMillis) countdownMillis.value = String(milliseconds);
  sendCmd({
    type: "TR_SET_COUNTDOWN",
    seconds,
    milliseconds
  });
}

function submitPass() {
  const count = Math.max(0, Math.min(999, Math.trunc(Number(passCount?.value ?? 10) || 0)));
  if (passCount) passCount.value = String(count);
  sendCmd({
    type: "TR_SET_PASS",
    enabled: !!passEnabled?.checked,
    count
  });
}

function submitDisplayFractionDigits() {
  const digits = Math.max(0, Math.min(2, Math.trunc(Number(displayFractionDigits?.value ?? 2) || 0)));
  if (displayFractionDigits) displayFractionDigits.value = String(digits);
  sendCmd({
    type: "TR_SET_DISPLAY_FRACTION",
    digits
  });
}

function submitTimeHide() {
  const minutes = Math.max(0, Math.min(999, Math.trunc(Number(timeHideMin?.value ?? 0) || 0)));
  const seconds = Math.max(0, Math.min(59, Math.trunc(Number(timeHideSec?.value ?? 0) || 0)));
  const milliseconds = Math.max(0, Math.min(999, Math.trunc(Number(timeHideMillis?.value ?? 0) || 0)));
  const afterMs = (minutes * 60000) + (seconds * 1000) + milliseconds;

  if (timeHideMin) timeHideMin.value = String(minutes);
  if (timeHideSec) timeHideSec.value = String(seconds);
  if (timeHideMillis) timeHideMillis.value = String(milliseconds);

  sendCmd({
    type: "TR_SET_TIME_HIDE",
    afterMs,
    hideMinute: !!timeHideMinute?.checked,
    hideSecondTens: !!timeHideSecondTens?.checked,
    hideSecondOnes: !!timeHideSecondOnes?.checked,
    hideFraction: !!timeHideFraction?.checked
  });
}

durationMin?.addEventListener("change", normalizeDurationInputs);
durationSec?.addEventListener("change", normalizeDurationInputs);
durationMin?.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  submitDuration();
});
durationSec?.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  submitDuration();
});
btnApplyDuration?.addEventListener("click", submitDuration);
goalMode?.addEventListener("change", submitGoalMode);
goalCount?.addEventListener("change", submitGoalCount);
wrongPenaltyEnabled?.addEventListener("change", submitWrongPenalty);
wrongPenaltySec?.addEventListener("change", submitWrongPenalty);
passEnabled?.addEventListener("change", submitPass);
passCount?.addEventListener("change", submitPass);
countdownSec?.addEventListener("change", submitCountdown);
countdownMillis?.addEventListener("change", submitCountdown);
displayFractionDigits?.addEventListener("change", submitDisplayFractionDigits);
timeHideMin?.addEventListener("change", submitTimeHide);
timeHideSec?.addEventListener("change", submitTimeHide);
timeHideMillis?.addEventListener("change", submitTimeHide);
timeHideMinute?.addEventListener("change", submitTimeHide);
timeHideSecondTens?.addEventListener("change", submitTimeHide);
timeHideSecondOnes?.addEventListener("change", submitTimeHide);
timeHideFraction?.addEventListener("change", submitTimeHide);
attachParentSpaceBinding();

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    lastState = msg.event.state;
    render();
  }

  if (msg.type === "MOD_INIT") {
    render();
  }
});
