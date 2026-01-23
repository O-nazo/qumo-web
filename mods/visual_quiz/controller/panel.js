let last = null;

function sendCmd(cmd) {
  window.parent.postMessage({ type: "MOD_PANEL_CMD", cmd }, "*");
}

function qs(id) { return document.getElementById(id); }

function render() {
  if (!last) return;

  const cur = last.current || null;

  // preview
  qs("previewQ").textContent = cur?.question ?? "(no question)";
  qs("previewA").textContent = cur?.answer ?? "(no answer)";
  qs("previewInfo").textContent =
    `phase: ${last.phase}\n` +
    `qIndex: ${last.qIndex}\n` +
    `lidOpen: ${last.lidOpen}\n` +
    `showAnswer: ${last.showAnswer}\n` +
    `file: ${cur?.file ?? "-"}`;

  const img = qs("previewImg");
  if (cur?.file) {
    // panel は /mods/visual_quiz/controller/ 配下なので ../assets でOK
    img.src = `../assets/q/images/${cur.file}`;
  } else {
    img.removeAttribute("src");
  }

  // list
  const list = qs("list");
  list.innerHTML = "";
  const arr = Array.isArray(last.questions) ? last.questions : [];

  arr.forEach((q, idx) => {
    const div = document.createElement("div");
    div.className = "item" + (idx === last.qIndex ? " active" : "");
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

  qs("btnStart").disabled  = !(phase === "LOADED" || phase === "BUZZED");
  qs("btnNext").disabled   = !(phase === "ENDED"  || phase === "ANSWER");
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
qs("btnStart").addEventListener("click", () => sendCmd({ type: "VQ_START" }));
qs("btnNext").addEventListener("click", () => sendCmd({ type: "VQ_NEXT" }));
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
