let state = null;

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  // controller/visualizer 親から来る
  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    state = msg.event.state;
    console.log("[main] got MOD_EVENT", msg.event?.type);
    render();
  }

  // 任意：MOD_INIT が来たらデバッグに出す
  if (msg.type === "MOD_INIT") {
    const dbg = document.getElementById("debug");
    if (dbg) dbg.textContent = `MOD_INIT: ${msg.modId}\n` + (dbg.textContent || "");
  }
});

function render() {
  const img = document.getElementById("q-image");
  const answer = document.getElementById("answer-text");
  const qtext = document.getElementById("q-text");
  const imageArea = document.getElementById("image-area");
  const dbg = document.getElementById("debug");

  if (!state) return;

  // デバッグ表示（まずここが出れば“状態が届いてる”）
  if (dbg) {
    dbg.textContent =
      `phase: ${state.phase}\n` +
      `qIndex: ${state.qIndex}\n` +
      `lidOpen: ${state.lidOpen}\n` +
      `showAnswer: ${state.showAnswer}\n` +
      `file: ${state.current?.file ?? "-"}`;
  }

  // 蓋
  imageArea.classList.toggle("open", !!state.lidOpen);

  // 問題文＆画像
  if (qtext) qtext.textContent = state.current?.question ?? "";
  if (state?.current?.file) {
    img.src = `../assets/q/images/${state.current.file}`;
  } else {
    img.removeAttribute("src");
  }

  // 答え
  if (state.showAnswer && state.current) {
    answer.textContent = state.current.answer ?? "";
  } else {
    answer.textContent = "";
  }
}
