export function createClient({ screen, name, autoJoin = true }) {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const ws = new WebSocket(wsUrl);

  let state = null;
  const stateListeners = new Set();

  let self = { playerId: null };
  const selfListeners = new Set();

  const msgListeners = new Set();
  function onMessage(fn) {
    msgListeners.add(fn);
    return () => msgListeners.delete(fn);
  }


  // --- 追加：OPEN前送信キュー ---
  const sendQueue = [];
  function sendOrQueue(obj) {
    const str = JSON.stringify(obj);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(str);
      return;
    }
    // CONNECTING(0) の間は貯める（スマホ対策）
    if (ws.readyState === WebSocket.CONNECTING) {
      sendQueue.push(str);
      return;
    }
    // CLOSING/CLOSED は捨てる（必要なら再接続設計）
  }

  function send(obj) {
    sendOrQueue(obj);
  }

  function flushQueue() {
    while (ws.readyState === WebSocket.OPEN && sendQueue.length) {
      ws.send(sendQueue.shift());
    }
  }

  // --- 追加：時刻同期（任意。後でサーバ側と合わせる用）---
  let clockOffsetMs = 0;
  let bestRtt = Infinity;

  function nowEpochMs() {
    return performance.timeOrigin + performance.now();
  }
  function nowServerMs() {
    return nowEpochMs() + clockOffsetMs;
  }

  function sendPing() {
    const t0 = nowEpochMs();
    sendOrQueue({ type: "PING", t0 });
  }

  function onState(fn) {
    stateListeners.add(fn);
    if (state) fn(state);
    return () => stateListeners.delete(fn);
  }

  function onSelf(fn) {
    selfListeners.add(fn);
    if (self.playerId) fn(self);
    return () => selfListeners.delete(fn);
  }

  function emit(type, payload = {}) {
    sendOrQueue({ type, ...payload });
  }

  function join(joinPayload = {}) {
    emit("JOIN", { screen, ...joinPayload });
  }

  ws.addEventListener("open", () => {
    flushQueue();

    // ついでに軽く時刻同期（3回だけ）
    sendPing();
    setTimeout(sendPing, 80);
    setTimeout(sendPing, 160);

    if (autoJoin) join({ name });
  });

  // 追加：WebSocketの受信データを「必ず文字列」にする
  function wsDataToText(data) {
    if (typeof data === "string") return Promise.resolve(data);
    if (data instanceof Blob) return data.text();
    if (data instanceof ArrayBuffer) {
      return Promise.resolve(new TextDecoder("utf-8").decode(data));
    }
    // 念のため（TypedArray等）
    if (ArrayBuffer.isView?.(data)) {
      return Promise.resolve(new TextDecoder("utf-8").decode(data.buffer));
    }
    return Promise.resolve("");
  }

  ws.addEventListener("message", (ev) => {
    wsDataToText(ev.data).then((text) => {
      if (!text) return;

      let msg;
      try { msg = JSON.parse(text); } catch { return; }

      // PONG（時刻同期）
      if (msg.type === "PONG" && Number.isFinite(msg.t0) && Number.isFinite(msg.t1)) {
        const t2 = nowEpochMs();
        const rtt = t2 - msg.t0;
        const offset = msg.t1 - (msg.t0 + t2) / 2;
        if (rtt < bestRtt) {
          bestRtt = rtt;
          clockOffsetMs = offset;
        }
        return;
      }

      if (msg.type === "SELF") {
        self = { playerId: msg.playerId || null };
        for (const fn of selfListeners) fn(self);
        return;
      }

      if (msg.type === "STATE") {
        state = msg.state;
        for (const fn of stateListeners) fn(state);
        // return しない（下の汎用通知に流す）
      }

      // ★追加：全メッセージを onMessage に流す（未知typeも拾う）
      for (const fn of msgListeners) fn(msg);

    });
  });


  
ws.addEventListener("open", () => console.log("[WS] open"));
ws.addEventListener("close", (e) => console.log("[WS] close", e.code, e.reason));
ws.addEventListener("error", (e) => console.log("[WS] error", e));


  return { ws, onState, onSelf, onMessage, send, emit, join, nowServerMs };
}
