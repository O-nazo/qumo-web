module.exports = function registerExampleMod(ctx) {
  // ctx はコアが渡す想定
  // ctx.on(eventType, handler)
  // ctx.broadcast(msg)
  // ctx.dispatch(action)
  // ctx.getState()

  ctx.on("BUZZ", (ev) => {
    // 例：1位の押下で全画面に通知
    if (ev.rank === 1) {
      ctx.broadcast({ type: "MOD_EVENT", modId: "example", event: { type: "FIRST_BUZZ" } });
    }
  });

  ctx.on("RESET", () => {
    ctx.broadcast({ type: "MOD_EVENT", modId: "example", event: { type: "RESET" } });
  });
};
