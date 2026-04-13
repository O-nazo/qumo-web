export function createClient({ screen, name, autoJoin = true }) {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const ws = new WebSocket(wsUrl);
  const CLOCK_SYNC_BURST_DELAYS_MS = [0, 80, 160];
  const CLOCK_SYNC_INTERVAL_MS = 5000;

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
  let pingIntervalId = null;
  let pingTimeoutIds = [];

  function nowEpochMs() {
    return performance.timeOrigin + performance.now();
  }
  function nowServerMs() {
    return nowEpochMs() + clockOffsetMs;
  }

  function getClockSyncStats() {
    return {
      clockOffsetMs,
      bestRtt: Number.isFinite(bestRtt) ? bestRtt : null
    };
  }

  function sendPing() {
    const t0 = nowEpochMs();
    sendOrQueue({ type: "PING", t0 });
  }

  function clearClockSyncTimers() {
    if (pingIntervalId != null) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }
    for (const timeoutId of pingTimeoutIds) {
      clearTimeout(timeoutId);
    }
    pingTimeoutIds = [];
  }

  function scheduleClockSyncBurst() {
    for (const delayMs of CLOCK_SYNC_BURST_DELAYS_MS) {
      if (delayMs === 0) {
        sendPing();
        continue;
      }
      const timeoutId = setTimeout(() => {
        pingTimeoutIds = pingTimeoutIds.filter((id) => id !== timeoutId);
        sendPing();
      }, delayMs);
      pingTimeoutIds.push(timeoutId);
    }
  }

  function startClockSync() {
    clearClockSyncTimers();
    scheduleClockSyncBurst();
    pingIntervalId = setInterval(() => {
      scheduleClockSyncBurst();
    }, CLOCK_SYNC_INTERVAL_MS);
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
    startClockSync();

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

ws.addEventListener("close", () => {
  clearClockSyncTimers();
});


  return { ws, onState, onSelf, onMessage, send, emit, join, nowServerMs, getClockSyncStats };
}
