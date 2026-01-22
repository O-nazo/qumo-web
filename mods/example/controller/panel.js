const btn = document.getElementById("btnSfx");

btn?.addEventListener("click", () => {
  // 親(controller)へメッセージ
  window.parent.postMessage({
    type: "MOD_PANEL_CMD",
    cmd: { type: "PLAY_SFX", key: "push" }
  }, "*");
});
