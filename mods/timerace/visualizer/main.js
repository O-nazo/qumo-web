let modState = null;
let coreState = null;

const phaseEl = document.getElementById("phase");
const timerEl = document.getElementById("timer");
const remainingEl = document.getElementById("remaining");

function formatClock(ms, { fixedCentiseconds = false } = {}) {
  const safe = Math.max(0, Number(ms ?? 0));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = fixedCentiseconds ? 0 : Math.floor((safe % 1000) / 10);

  return [
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
    String(centiseconds).padStart(2, "0")
  ].join(":");
}

function getPhaseLabel(phase) {
  switch (phase) {
    case "countdown":
      return "READY";
    case "running":
      return "";
    case "stopped":
      return "STOPPED";
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

function render() {
  if (!modState && !coreState) return;

  const phase = modState?.phase || "idle";
  const displayMs = phase === "countdown"
    ? modState?.displayCountdownMs
    : modState?.displayMs;
  const phaseLabel = getPhaseLabel(phase);
  const isCountdownStartCue = phase === "countdown" && Number(displayMs ?? 0) < 1000;

  document.body.classList.toggle("is-clear", phase === "clear");
  phaseEl.textContent = phaseLabel;
  phaseEl.classList.toggle("is-hidden", phaseLabel === "");
  timerEl.classList.toggle("is-start-cue", isCountdownStartCue);
  timerEl.textContent = isCountdownStartCue
    ? "START"
    : formatClock(displayMs ?? modState?.durationMs ?? 0, {
        fixedCentiseconds: phase === "countdown"
      });
  remainingEl.textContent = String(computeRemainingCount()).padStart(2, "0");
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
  }
});
