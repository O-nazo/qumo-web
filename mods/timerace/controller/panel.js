const phaseText = document.getElementById("phaseText");
const clock = document.getElementById("clock");
const summary = document.getElementById("summary");
const durationMin = document.getElementById("durationMin");
const durationSec = document.getElementById("durationSec");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnReset = document.getElementById("btnReset");

let lastState = null;

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function formatClock(ms) {
  const safe = Math.max(0, Number(ms ?? 0));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);

  return [
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
    String(centiseconds).padStart(2, "0")
  ].join(":");
}

function getPhaseLabel(state) {
  switch (state?.phase) {
    case "countdown":
      return "カウントダウン";
    case "running":
      return "計測中";
    case "stopped":
      return "停止中";
    case "clear":
      return "クリア";
    case "timeout":
      return "タイムアップ";
    default:
      return "待機中";
  }
}

function render() {
  const state = lastState;
  if (!state) return;

  phaseText.textContent = getPhaseLabel(state);
  const ms = state.phase === "countdown" ? state.displayCountdownMs : state.displayMs;
  clock.textContent = formatClock(ms);
  summary.textContent = `残り ${state.remainingCount} / ${state.participantCount}`;

  if (document.activeElement !== durationMin && document.activeElement !== durationSec) {
    const totalSec = Math.max(0, Math.round(Number(state.durationMs ?? 0) / 1000));
    if (durationMin) durationMin.value = String(Math.floor(totalSec / 60));
    if (durationSec) durationSec.value = String(totalSec % 60);
  }

  btnStart.disabled = state.phase === "running" || state.phase === "countdown" || state.phase === "clear";
  btnStop.disabled = !(state.phase === "running" || state.phase === "countdown");
}

btnStart?.addEventListener("click", () => sendCmd({ type: "TR_START" }));
btnStop?.addEventListener("click", () => sendCmd({ type: "TR_STOP" }));
btnReset?.addEventListener("click", () => sendCmd({ type: "TR_RESET" }));

function submitDuration() {
  const minutes = Math.max(0, Math.trunc(Number(durationMin?.value ?? 0) || 0));
  const seconds = Math.max(0, Math.trunc(Number(durationSec?.value ?? 0) || 0));
  const total = Math.max(5, Math.min(3599, minutes * 60 + seconds));

  if (durationMin) durationMin.value = String(Math.floor(total / 60));
  if (durationSec) durationSec.value = String(total % 60);

  sendCmd({ type: "TR_SET_DURATION", seconds: total });
}

durationMin?.addEventListener("change", submitDuration);
durationSec?.addEventListener("change", submitDuration);

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
