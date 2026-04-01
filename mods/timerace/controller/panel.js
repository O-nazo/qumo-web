const phaseText = document.getElementById("phaseText");
const clock = document.getElementById("clock");
const summary = document.getElementById("summary");
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

  if (document.activeElement !== durationSec) {
    durationSec.value = String(Math.max(1, Math.round(Number(state.durationMs ?? 0) / 1000)));
  }

  btnStart.disabled = state.phase === "running" || state.phase === "countdown" || state.phase === "clear";
  btnStop.disabled = !(state.phase === "running" || state.phase === "countdown");
}

btnStart?.addEventListener("click", () => sendCmd({ type: "TR_START" }));
btnStop?.addEventListener("click", () => sendCmd({ type: "TR_STOP" }));
btnReset?.addEventListener("click", () => sendCmd({ type: "TR_RESET" }));

durationSec?.addEventListener("change", () => {
  const seconds = Number(durationSec.value);
  sendCmd({ type: "TR_SET_DURATION", seconds });
});

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
