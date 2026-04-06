let last = null;
let isSeeking = false;
let lastSetOptionsKey = "";
let lastQuestionListKey = "";

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function qs(id) { return document.getElementById(id); }
function formatMediaTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function render() {
  if (!last) return;

  const cur = last.current || null;
  const selected =
    typeof last.selectedQIndex === "number"
      ? (Array.isArray(last.questions) ? last.questions[last.selectedQIndex] ?? null : null)
      : null;

  // preview
  qs("previewQ").textContent = selected?.question ?? "(no selection)";
  qs("previewA").textContent = selected?.answer ?? "(no answer)";
  renderSetOptions();

  const img = qs("previewImg");
  const video = qs("previewVideo");
  const selectedMedia = selected?.promptMedia || (selected?.file ? { file: selected.file, kind: selected.mediaKind || "image" } : null);
  const hasAnyVideoMedia = selectedMedia?.kind === "video" || selected?.answerMedia?.kind === "video";
  const mediaPlayback = last.mediaPlayback || {};
  if (selectedMedia?.file && selectedMedia.kind === "video") {
    const nextSrc = getMediaUrl(selectedMedia, selected?.setId || last.setId);
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    if (video.getAttribute("src") !== nextSrc) {
      video.src = nextSrc;
    }
  } else if (selectedMedia?.file) {
    video.hidden = true;
    video.pause();
    video.removeAttribute("src");
    img.hidden = false;
    img.src = getMediaUrl(selectedMedia, selected?.setId || last.setId);
  } else {
    video.hidden = true;
    video.pause();
    video.removeAttribute("src");
    img.hidden = false;
    img.removeAttribute("src");
  }

  // list
  const arr = Array.isArray(last.questions) ? last.questions : [];
  renderQuestionList(arr);

  const phase = last.phase;
  const hasSelectedQuestion = typeof last.qIndex === "number";
  const seekBar = qs("seekBar");
  const toggleButton = qs("btnMediaToggle");
  const playbackDuration = Math.max(0, Number(mediaPlayback.duration) || 0);
  const playbackCurrentTime = Math.max(0, Number(mediaPlayback.currentTime) || 0);
  const isPlaybackPaused = mediaPlayback.paused !== false;
  const canControlVideo = !!hasAnyVideoMedia;

  qs("btnStart").disabled  = !hasSelectedQuestion || !(phase === "LOADED" || phase === "BUZZED");
  qs("btnOpen").disabled   = !(phase === "BUZZED" || phase === "ENDED");
  qs("btnClose").disabled  = (phase === "LOADED"); // 好みで
  toggleButton.disabled    = !canControlVideo;
  toggleButton.textContent = isPlaybackPaused ? "▶️" : "⏸️";
  seekBar.disabled = !canControlVideo || playbackDuration <= 0;
  seekBar.max = String(Math.max(1, Math.round(playbackDuration * 10)));
  if (!isSeeking) {
    seekBar.value = String(Math.max(0, Math.min(Math.round(playbackCurrentTime * 10), Number(seekBar.max))));
  }
  qs("seekTime").textContent = `${formatMediaTime(playbackCurrentTime)} / ${formatMediaTime(playbackDuration)}`;

}

function renderSetOptions() {
  const select = qs("setSelect");
  if (!select || !last) return;
  const sets = Array.isArray(last.sets) ? last.sets : [];
  const currentValue = String(last.setId ?? "");
  const optionsKey = `${currentValue}|${sets.map((set) => `${set.id}:${set.label}`).join(",")}`;

  if (!sets.length) {
    if (lastSetOptionsKey !== "__empty__") {
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(問題セットなし)";
      select.appendChild(opt);
      lastSetOptionsKey = "__empty__";
    }
    select.disabled = true;
    return;
  }

  if (lastSetOptionsKey !== optionsKey) {
    const previousValue = String(select.value || "");
    select.innerHTML = "";
    sets.forEach((set) => {
      const opt = document.createElement("option");
      opt.value = String(set.id ?? "");
      opt.textContent = String(set.label ?? set.id ?? "");
      select.appendChild(opt);
    });
    select.value = sets.some((set) => String(set.id) === currentValue)
      ? currentValue
      : previousValue;
    if (!select.value && sets.length) {
      select.value = String(sets[0].id);
    }
    lastSetOptionsKey = optionsKey;
  } else if (select.value !== currentValue && sets.some((set) => String(set.id) === currentValue)) {
    select.value = currentValue;
  }
  select.disabled = false;
}

function renderQuestionList(arr) {
  const list = qs("list");
  if (!list) return;
  const selectedQIndex = Number(last?.selectedQIndex);
  const listKey = `${selectedQIndex}|${arr.map((q, idx) => `${idx}:${q.no}:${q.question}:${q.answer}`).join("||")}`;

  if (lastQuestionListKey !== listKey) {
    list.innerHTML = "";
    arr.forEach((q, idx) => {
      const div = document.createElement("div");
      div.className = "item" + (idx === last.selectedQIndex ? " active" : "");
      div.innerHTML = `
        <div><span class="no">#${q.no ?? (idx+1)}</span><span class="q">${escapeHtml(q.question ?? "")}</span></div>
        <div class="a">${escapeHtml(q.answer ?? "")}</div>
      `;
      div.addEventListener("click", () => {
        sendCmd({ type: "VQ_SELECT_Q", qIndex: idx });
      });
      list.appendChild(div);
    });
    lastQuestionListKey = listKey;
    return;
  }

  for (const [idx, item] of Array.from(list.children).entries()) {
    item.classList.toggle("active", idx === last.selectedQIndex);
  }
}

function getMediaUrl(media, setId) {
  if (!media?.file) return "";
  if (media.url) return media.url;
  const normalizedSetId = String(setId ?? "");
  if (!normalizedSetId) return "";
  return `../assets/q/${encodeURIComponent(normalizedSetId)}/images/${encodeURIComponent(media.file)}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- buttons ---
qs("btnStart").addEventListener("click", () => sendCmd({ type: "VQ_START" }));
qs("btnMediaToggle").addEventListener("click", () => sendCmd({ type: "VQ_MEDIA_TOGGLE" }));
qs("btnOpen").addEventListener("click", () => sendCmd({ type: "VQ_OPEN" }));
qs("btnClose").addEventListener("click", () => sendCmd({ type: "VQ_CLOSE" }));
qs("btnAnswer").addEventListener("click", () => sendCmd({ type: "VQ_TOGGLE_ANSWER" }));
qs("setSelect").addEventListener("change", (e) => {
  sendCmd({ type: "VQ_SELECT_SET", setId: e.target.value });
});
qs("seekBar").addEventListener("pointerdown", () => {
  isSeeking = true;
});
qs("seekBar").addEventListener("pointerup", (e) => {
  isSeeking = false;
});
qs("seekBar").addEventListener("change", (e) => {
  isSeeking = false;
});
qs("seekBar").addEventListener("input", (e) => {
  if (!last) return;
  const mediaPlayback = last.mediaPlayback || {};
  const seconds = (Number(e.target.value) || 0) / 10;
  qs("seekTime").textContent = `${formatMediaTime(seconds)} / ${formatMediaTime(mediaPlayback.duration)}`;
  sendCmd({ type: "VQ_MEDIA_SEEK", timeSec: seconds });
});

// --- receive MOD_EVENT ---
window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    last = msg.event.state;
    render();
  }

  if (msg.type === "MOD_INIT") {
    sendCmd({ type: "VQ_SYNC_STATE" });
    // 最初は state が来るまで空なので、念のため描画
    render();
  }
});

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!target.closest?.('[contenteditable="true"]');
}

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat) return;
  if (isTypingTarget(e.target)) return;

  const key = String(e.key || "").toLowerCase();
  if (key === " " || key === "spacebar") {
    e.preventDefault();
    sendCmd({ type: "VQ_START" });
  } else if (key === "q") {
    e.preventDefault();
    sendCmd({ type: "PRESENT" });
  } else if (key === "r") {
    e.preventDefault();
    sendCmd({ type: "BUZZER_RESET" });
  } else if (key === "t") {
    e.preventDefault();
    sendCmd({ type: "PLAY_SFX", key: "thinking" });
  } else if (key === "o") {
    e.preventDefault();
    sendCmd({ type: "JUDGE_CORRECT" });
  } else if (key === "x") {
    e.preventDefault();
    sendCmd({ type: "SKIP_OR_WRONG" });
  }
});
