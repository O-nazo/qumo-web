let last = null;

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function qs(id) { return document.getElementById(id); }

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

  const img = qs("previewImg");
  if (selected?.file) {
    // panel は /mods/visual_quiz/controller/ 配下なので ../assets でOK
    img.src = `../assets/q/images/${selected.file}`;
  } else {
    img.removeAttribute("src");
  }

  // list
  const list = qs("list");
  list.innerHTML = "";
  const arr = Array.isArray(last.questions) ? last.questions : [];

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

  const phase = last.phase;
  const hasSelectedQuestion = typeof last.qIndex === "number";

  qs("btnStart").disabled  = !hasSelectedQuestion || !(phase === "LOADED" || phase === "BUZZED");
  qs("btnOpen").disabled   = !(phase === "ENDED"); // 仕様通り「終了状態で答え表示付き」
  qs("btnClose").disabled  = (phase === "LOADED"); // 好みで

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
qs("btnPresentCore").addEventListener("click", () => sendCmd({ type: "PRESENT" }));
qs("btnCorrectCore").addEventListener("click", () => sendCmd({ type: "JUDGE_CORRECT" }));
qs("btnWrongCore").addEventListener("click", () => sendCmd({ type: "JUDGE_WRONG" }));
qs("btnStart").addEventListener("click", () => sendCmd({ type: "VQ_START" }));
qs("btnOpen").addEventListener("click", () => sendCmd({ type: "VQ_OPEN" }));
qs("btnClose").addEventListener("click", () => sendCmd({ type: "VQ_CLOSE" }));
qs("btnAnswer").addEventListener("click", () => sendCmd({ type: "VQ_TOGGLE_ANSWER" }));
qs("btnSkip").addEventListener("click", () => sendCmd({ type: "VQ_SKIP" }));

// --- receive MOD_EVENT ---
window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    last = msg.event.state;
    render();
  }

  if (msg.type === "MOD_INIT") {
    // 最初は state が来るまで空なので、念のため描画
    render();
  }
});
