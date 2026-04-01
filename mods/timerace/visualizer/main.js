let modState = null;
let coreState = null;

const phaseEl = document.getElementById("phase");
const timerEl = document.getElementById("timer");
const remainingEl = document.getElementById("remaining");

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

function getPhaseLabel(phase) {
  switch (phase) {
    case "countdown":
      return "COUNTDOWN";
    case "running":
      return "RUNNING";
    case "stopped":
      return "STOPPED";
    case "clear":
      return "CLEAR";
    case "timeout":
      return "TIME UP";
    default:
      return "STANDBY";
  }
}

function computeRemainingCount() {
  if (modState && Number.isFinite(Number(modState.remainingCount))) {
    return Math.max(0, Number(modState.remainingCount));
  }

  const players = Object.values(coreState?.players || {});
  return players.filter((player) => {
    if (!player?.id) return false;
    if (player.connected === false) return false;
    if (player.status === "disqualified") return false;
    return !player.modDisabled;
  }).length;
}

function render() {
  if (!modState && !coreState) return;

  const phase = modState?.phase || "idle";
  const displayMs = phase === "countdown"
    ? modState?.displayCountdownMs
    : modState?.displayMs;

  phaseEl.textContent = getPhaseLabel(phase);
  timerEl.textContent = formatClock(displayMs ?? modState?.durationMs ?? 0);
  remainingEl.textContent = String(computeRemainingCount());
}

if (window.QUMO_MOD_API) {
  window.QUMO_MOD_API.onState((state) => {
    coreState = state;
    render();
  });
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    modState = msg.event.state;
    render();
  }
});
