let lastState = null;
let lastRenderedCueQuestionId = "";

function qs(id) {
  return document.getElementById(id);
}

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function sendControllerShortcut(shortcut) {
  sendCmd({ type: "CONTROLLER_SHORTCUT", shortcut });
}

function resetProblemState() {
  sendCmd({ type: "BUZZER_RESET" });
  sendCmd({ type: "IQ_RESET" });
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatCueInputValue(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function commitCueInput(kind) {
  const current = lastState?.current || null;
  if (!current) return;
  const input = kind === "chorus" ? qs("chorusCueInput") : qs("introCueInput");
  if (!input) return;

  const rawValue = Number(input.value);
  const nextValue = Math.max(0, Number.isFinite(rawValue) ? rawValue : 0);
  const command =
    kind === "chorus"
      ? { type: "IQ_SET_CUES", qIndex: Number(lastState?.selectedQIndex), chorusAtSec: nextValue }
      : { type: "IQ_SET_CUES", qIndex: Number(lastState?.selectedQIndex), startAtSec: nextValue };

  sendCmd(command);
}

function commitYoutubeVolume() {
  const current = lastState?.current || null;
  if (!current || current?.source?.type !== "youtube") return;
  const rawValue = Number(qs("youtubeVolumeInput").value);
  const nextValue = Math.max(0, Math.min(100, Number.isFinite(rawValue) ? rawValue : 100));
  sendCmd({ type: "IQ_SET_VOLUME", volume: nextValue });
}

function renderList() {
  const list = qs("list");
  if (!list || !lastState) return;
  const currentIndex = Number(lastState.selectedQIndex);
  const items = Array.isArray(lastState.questions) ? lastState.questions : [];
  list.innerHTML = "";

  items.forEach((question, index) => {
    const item = document.createElement("div");
    item.className = `item${index === currentIndex ? " active" : ""}`;
    item.innerHTML = `
      <div class="meta">
        <span>#${question.no}</span>
        <span>${escapeHtml(question.source?.providerLabel || "-")}</span>
        <span>${escapeHtml(question.playlistName || "-")}</span>
      </div>
      <div class="itemTitle">${escapeHtml(question.title || "(untitled)")}</div>
      <div class="itemAnswer">${escapeHtml(question.answer || "")}</div>
    `;
    item.addEventListener("click", () => {
      resetProblemState();
      sendCmd({ type: "IQ_SELECT_Q", qIndex: index });
    });
    list.appendChild(item);
  });
}

function renderSetOptions() {
  const select = qs("setSelect");
  if (!select || !lastState) return;
  const sets = Array.isArray(lastState.sets) ? lastState.sets : [];
  const current = String(lastState.setId || "");
  select.innerHTML = "";

  if (!sets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "(問題セットなし)";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  sets.forEach((set) => {
    const option = document.createElement("option");
    option.value = String(set.id);
    option.textContent = String(set.label || set.id);
    select.appendChild(option);
  });
  select.value = current;
  select.disabled = false;
}

function render() {
  if (!lastState) return;
  const current = lastState.current || null;
  const playback = lastState.playbackStatus || {};
  const source = current?.source || {};
  const isPlaying = playback.paused === false;

  qs("phaseBadge").textContent = lastState.phase || "IDLE";
  qs("providerBadge").textContent = source.providerLabel || "-";
  qs("playlistBadge").textContent = current?.playlistName || current?.playlist?.name || "-";
  qs("title").textContent = current?.title || "(no title)";
  qs("artist").textContent = current?.artist || "";
  qs("year").textContent = current?.year ? `${current.year}年` : "";
  qs("answerText").textContent = lastState.showAnswer ? (current?.answer || "") : "";
  qs("notes").textContent = current?.notes || "";
  const cueQuestionId = String(current?.id || "");
  if (cueQuestionId !== lastRenderedCueQuestionId) {
    qs("introCueInput").value = formatCueInputValue(source.startAtSec || 0);
    qs("chorusCueInput").value = formatCueInputValue(source.chorusAtSec || 0);
    lastRenderedCueQuestionId = cueQuestionId;
  } else {
    if (document.activeElement !== qs("introCueInput")) {
    qs("introCueInput").value = formatCueInputValue(source.startAtSec || 0);
    }
    if (document.activeElement !== qs("chorusCueInput")) {
      qs("chorusCueInput").value = formatCueInputValue(source.chorusAtSec || 0);
    }
  }

  const seekBar = qs("seekBar");
  const duration = Math.max(0, Number(playback.duration) || 0);
  const currentTime = Math.max(0, Number(playback.currentTime) || 0);
  const youtubeVolume = Math.max(0, Math.min(100, Number(playback.volume) || 100));
  seekBar.max = String(Math.max(1, Math.round(duration * 10)));
  seekBar.value = String(Math.max(0, Math.min(Math.round(currentTime * 10), Number(seekBar.max))));
  seekBar.disabled = true;
  qs("timeLabel").textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  qs("btnTransportPlay").textContent = isPlaying ? "⏸" : "▶";

  const hasQuestion = !!current;
  qs("btnPlay").textContent = isPlaying ? "停止" : "再生";
  qs("btnPlay").disabled = !hasQuestion;
  qs("btnChorus").disabled = !hasQuestion;
  qs("btnRewind").disabled = !hasQuestion;
  qs("btnAnswer").disabled = !hasQuestion;
  qs("btnReset").disabled = !hasQuestion;
  qs("btnPrev").disabled = !hasQuestion;
  qs("btnNext").disabled = !hasQuestion;
  qs("btnTransportPlay").disabled = !hasQuestion;
  qs("btnTransportStop").disabled = !hasQuestion;
  qs("btnTransportRewind").disabled = !hasQuestion;
  qs("btnTransportForward").disabled = !hasQuestion;
  qs("introCueInput").disabled = !hasQuestion;
  qs("chorusCueInput").disabled = !hasQuestion;
  qs("youtubeVolumeInput").disabled = source.type !== "youtube";
  if (document.activeElement !== qs("youtubeVolumeInput")) {
    qs("youtubeVolumeInput").value = String(youtubeVolume);
  }
  qs("youtubeVolumeValue").textContent = `${youtubeVolume}%`;

  renderSetOptions();
  renderList();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

qs("btnPlay").addEventListener("click", () => {
  if (lastState?.playbackStatus?.paused === false) {
    sendCmd({ type: "IQ_HARD_STOP" });
    return;
  }
  sendCmd({ type: "IQ_PLAY" });
});
qs("btnChorus").addEventListener("click", () => sendCmd({ type: "IQ_PLAY_CHORUS" }));
qs("btnRewind").addEventListener("click", () => sendCmd({ type: "IQ_REWIND" }));
qs("btnAnswer").addEventListener("click", () => sendCmd({ type: "IQ_TOGGLE_ANSWER" }));
qs("btnReset").addEventListener("click", resetProblemState);
qs("btnPrev").addEventListener("click", () => sendCmd({ type: "IQ_PREV" }));
qs("btnNext").addEventListener("click", () => sendCmd({ type: "IQ_NEXT" }));
qs("btnTransportPlay").addEventListener("click", () => qs("btnPlay").click());
qs("btnTransportStop").addEventListener("click", () => sendCmd({ type: "IQ_STOP" }));
qs("btnTransportRewind").addEventListener("click", () => sendCmd({ type: "IQ_REWIND" }));
qs("btnTransportForward").addEventListener("click", () => sendCmd({ type: "IQ_PLAY_CHORUS" }));
qs("setSelect").addEventListener("change", (event) => sendCmd({ type: "IQ_SELECT_SET", setId: event.target.value }));
qs("introCueInput").addEventListener("change", () => commitCueInput("intro"));
qs("chorusCueInput").addEventListener("change", () => commitCueInput("chorus"));
qs("introCueInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") commitCueInput("intro");
});
qs("chorusCueInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") commitCueInput("chorus");
});
qs("youtubeVolumeInput").addEventListener("input", () => {
  const value = Math.max(0, Math.min(100, Number(qs("youtubeVolumeInput").value) || 100));
  qs("youtubeVolumeValue").textContent = `${value}%`;
});
qs("youtubeVolumeInput").addEventListener("change", commitYoutubeVolume);

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!target.closest?.('[contenteditable="true"]');
}

function isKeyboardShortcut(event, { code, key }) {
  const eventCode = String(event?.code || "");
  const eventKey = String(event?.key || "").toLowerCase();
  if (code && eventCode === code) return true;
  if (key && eventKey === String(key).toLowerCase()) return true;
  return false;
}

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.repeat) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  const key = String(event.key || "").toLowerCase();
  if (key === " " || key === "spacebar") {
    event.preventDefault();
    qs("btnPlay").click();
  } else if (isKeyboardShortcut(event, { code: "Numpad2" })) {
    event.preventDefault();
    sendControllerShortcut("PRESENT");
  } else if (isKeyboardShortcut(event, { code: "Numpad1" })) {
    event.preventDefault();
    sendControllerShortcut("RESET");
  } else if (isKeyboardShortcut(event, { code: "Numpad3" })) {
    event.preventDefault();
    sendControllerShortcut("THINKING");
  } else if (isKeyboardShortcut(event, { code: "Numpad0" })) {
    event.preventDefault();
    sendControllerShortcut("CORRECT");
  } else if (isKeyboardShortcut(event, { code: "NumpadDecimal" })) {
    event.preventDefault();
    sendControllerShortcut("SKIP_OR_WRONG");
  } else if (isKeyboardShortcut(event, { key: "backspace" })) {
    event.preventDefault();
    sendControllerShortcut("SKIP");
  } else if (isKeyboardShortcut(event, { code: "NumpadEnter" })) {
    event.preventDefault();
    sendControllerShortcut("MOD_PRIMARY");
  }
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    lastState = msg.event.state;
    render();
    return;
  }

  if (msg.type === "MOD_INIT") {
    sendCmd({ type: "IQ_SYNC_STATE" });
    return;
  }

  if (msg.type === "CONTROLLER_SHORTCUT_TRIGGERED") {
    if (msg.shortcut === "RESET") {
      resetProblemState();
    }
  }
});
