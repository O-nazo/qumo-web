let state = null;

function getVisualizerQuestionText(question) {
  const raw = String(question ?? "");
  const match = raw.match(/【([^【】]+)】/);
  if (match) return match[1].trim();
  return raw;
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    state = msg.event.state;
    render();
  }
});

function render() {
  if (!state) return;

  const windowInner = document.getElementById("window-inner");
  const img = document.getElementById("q-image");

  const q1 = document.getElementById("q-text");
  const q2 = document.getElementById("q-text2");

  const telop = document.getElementById("telop");
  const answer = document.getElementById("answer-text");

  // 蓋（開閉）
  windowInner.classList.toggle("open", !!state.lidOpen);

  // 問題文：全文を上下2枚に同じ位置で描画
  const q = state.showQuestionText
    ? getVisualizerQuestionText(state.current?.question)
    : "";
  if (q1) q1.textContent = q;
  if (q2) q2.textContent = q;

  // 問題画像
  if (state?.current?.file) {
    img.src = `../assets/q/images/${state.current.file}`;
  } else {
    img.removeAttribute("src");
  }

  // 解答テロップ（重ね表示）
  if (state.showAnswer && state.current) {
    answer.textContent = state.current.answer ?? "";
    telop.classList.remove("hidden");
  } else {
    answer.textContent = "";
    telop.classList.add("hidden");
  }
}
