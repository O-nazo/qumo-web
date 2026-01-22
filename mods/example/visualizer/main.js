const $msg = document.getElementById("msg");
const $veil = document.getElementById("veil");
const $btn = document.getElementById("btnVeil");

let hidden = false;
function setHidden(v){
  hidden = !!v;
  $veil.classList.toggle("hidden", !hidden);
}

$btn?.addEventListener("click", () => {
  setHidden(!hidden);
  // 親に「こういう操作をしたい」と伝える（後でコマンドに進化できる）
  window.parent.postMessage({
    type: "MOD_MAIN_CMD",
    cmd: { type: "SET_VEIL", hidden }
  }, "*");
});

// 親（visualizer.js）から state が飛んでくる想定
window.addEventListener("message", (ev) => {
  const data = ev.data;
  if (!data || data.type !== "MOD_STATE") return;

  const st = data.state;
  const phase = st?.phase ?? st?.buzzer?.phase ?? "unknown";
  $msg.textContent = `phase=${phase}`;

  // 例：回答者ロック中に黒幕ON
  if (phase === "locked") setHidden(true);
  if (phase === "result") setHidden(false);
});
