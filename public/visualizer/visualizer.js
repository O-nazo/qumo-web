import { createClient } from "/common/common.js";
import { playSfxOnce, playSfxSequence, toggleThinking, warmupSfx } from "/common/sfx.js";

// --- MOD API bridge ---
if (window.QUMO_MOD_API) {
  window.QUMO_MOD_API.dispatch = (action) => {
    // MOD → サーバーへ投げる
    client.send({
      type: "MOD_DISPATCH",
      action
    });
  };
}

const client = createClient({ screen: "visualizer" });
const joinQrOverlay = document.querySelector("#joinQrOverlay");
const joinQrImg = document.querySelector("#joinQrImg");
const joinQrText = document.querySelector("#joinQrText");
const joinQrHint = document.querySelector("#joinQrHint");

// 着差の有効桁数
const gapDigits = 4

// ここが重要：onStateの外で保持する
let lastSfxNonce = 0;

warmupSfx();

// --- MOD overlay loader (MVP) ---
// --- MOD main loader (shell mode) ---
let currentMainModId = null;
let mainFrame = null;

function loadMain(modId) {
  const id = String(modId || "").trim();
  if (!id) return;

  if (currentMainModId === id) return;
  currentMainModId = id;

  const root = document.getElementById("mod-main-root");
  if (!root) {
    console.warn("[MOD] #mod-main-root not found");
    return;
  }

  root.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.src = `/mods/${encodeURIComponent(id)}/visualizer/main.html`;
  iframe.className = "modMainFrame";
  iframe.setAttribute("title", `MOD main: ${id}`);

  // main側で操作したいので pointer events は ON
  iframe.style.pointerEvents = "auto";

  root.appendChild(iframe);
  mainFrame = iframe;
}

client.onMessage?.((msg) => {
  if (msg?.type === "RELOAD") {
    console.log("[visualizer] reload by MOD change");
    location.reload();
  }
});

const hudRoot = document.querySelector("#hud-root");

let hudMode = "full"; // "full" | "compact" | "pressedOnly"

function applyHudClasses(modActive) {
  document.body.classList.toggle("modView", !!modActive);

  if (hudRoot) {
    hudRoot.classList.toggle("compact", hudMode === "compact");
    hudRoot.classList.toggle("pressedOnly", hudMode === "pressedOnly");
  }
}

function getCurrentRespondent(st) {
  if (st.judge?.status !== "in_progress") return null;
  return st.buzzer?.buzzOrder?.[st.judge.currentIndex] ?? null;
}

function buildBuzzInfo(st) {
  const orderMap = new Map(); // playerId -> { order, at }
  (st.buzzer?.buzzOrder || []).forEach((b, idx) => {
    orderMap.set(b.playerId, { order: idx + 1, at: b.at });
  });
  const firstAt = st.buzzer?.firstBuzz?.at ?? null;
  return { orderMap, firstAt };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderJoinQr(st) {
  const on = !!st.ui?.joinQrVisible;

  if (!on) {
    joinQrOverlay.hidden = true;
    return;
  }

  joinQrOverlay.hidden = false;

  const url =
    st.ui?.joinQrTargetUrl ||
    (st.publicBaseUrl ? `${st.publicBaseUrl}/player/player.html` : "");

  joinQrText.textContent = url || "";
  const dataUrl = st.ui?.joinQrDataUrl;

  if (!url) {
    joinQrHint.textContent = "トンネルURL取得中…";
    joinQrImg.removeAttribute("src");
    return;
  }

  if (!dataUrl) {
    joinQrHint.textContent = "QRコード生成中…";
    joinQrImg.removeAttribute("src");
    return;
  }

  joinQrHint.textContent = "";
  joinQrImg.src = dataUrl;
}

function renderPlayers(st, mode = "full") {
  const grid = document.querySelector("#playersGrid");
  grid.innerHTML = "";

  const players = Object.values(st.players || {});
  const { orderMap, firstAt } = buildBuzzInfo(st);

  // 並び：押した人（押下順）→ まだ押してない人（名前順）
  const pressed = players
    .filter(p => orderMap.has(p.id))
    .sort((a, b) => orderMap.get(a.id).order - orderMap.get(b.id).order);

  const notPressed = players
    .filter(p => !orderMap.has(p.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));

  const sorted = [...pressed, ...notPressed];

  const cur = getCurrentRespondent(st);
  const currentPlayerId = cur?.playerId ?? null;
  const wrongSet = st.judge?.wrongSet || {};

  const ui = st.ui || {};
  const showScore = ui.showScore !== false;
  const showWrongCount = ui.showWrongCount !== false;
  const showMarks = !!ui.showMarks;
  const showMarkCorrect = ui.showMarkCorrect !== false;
  const showMarkWrong = ui.showMarkWrong !== false;
  
  function repeatSafe(ch, n, max = 30) {
    const k = Math.max(0, Math.min(Number(n ?? 0) | 0, max));
    return k > 0 ? ch.repeat(k) : "";
  }

  for (const p of sorted) {
    const info = orderMap.get(p.id) || null;
    const order = info ? info.order : null;

    let gapText = "-";
    if (info && firstAt != null && order >= 2) gapText = `+${(info.at - firstAt).toFixed(gapDigits)}ms`;

    const isCurrent = currentPlayerId === p.id;
    const isWronged = !!wrongSet[p.id];
    const isCorrect =
      st.judge?.lastResult?.type === "correct" &&
      st.judge.lastResult.playerId === p.id;

    const restCount = Number(p.restCount ?? 0);
    const isResting = restCount > 0;

    const status = p.status || "active";
    const isQualified = status === "qualified";
    const isDq = status === "disqualified";

    const correctCount = Number(p.correctCount ?? 0);
    const wrongCount = Number(p.wrongCount ?? 0);

    const marks = showMarks
      ? `${showMarkCorrect ? repeatSafe("○", correctCount) : ""}${showMarkWrong ? repeatSafe("×", wrongCount) : ""}`.trim()
      : "";

    const reachWin = !!p.reach?.qualify;
    const reachLose = !!p.reach?.dq;
    const reachHtml =
      (reachWin ? `<span class="reachTag reach-win">REACH</span>` : "") +
      (reachLose ? `<span class="reachTag reach-lose">REACH</span>` : "");

    const tile = document.createElement("div");
    tile.className =
      "tile" +
      (isQualified ? " qualified" : "") +
      (isDq ? " disqualified" : "") +
      (info ? " pressed" : "") +
      (order === 1 ? " first" : "") +
      (isCurrent ? " current" : "") +
      (isWronged ? " wrong" : "") +
      (isCorrect ? " correct" : "") +
      (isResting ? " resting" : "");

    if (mode === "compact") {
      // “名前・得点・押した順”だけ
      tile.innerHTML = `
        <div class="nameRow">
          <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          ${showScore ? `<div class="score">${Number(p.score ?? 0)}</div>` : ``}
        </div>
        <div class="meta">
          <div class="kv">
            <div class="k">押</div>
            <div class="v">${order ? `${order}位` : "-"}</div>
          </div>
          <div class="kv">
            <div class="k">差</div>
            <div class="v">${gapText}</div>
          </div>
        </div>
      `;
    } else {
      // 従来（full）
      tile.innerHTML = `
        <div class="nameRow">
          <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          ${reachHtml}
          ${showScore ? `<div class="score">${Number(p.score ?? 0)}</div>` : ``}
        </div>

        ${(showWrongCount || showMarks) ? `
        <div class="meta">
          ${showWrongCount ? `
          <div class="kv">
            <div class="k">誤答</div>
            <div class="v">${wrongCount}</div>
          </div>
          ` : ``}

          ${showMarks ? `
          <div class="kv">
            <div class="k">○×</div>
            <div class="v">${escapeHtml(marks || "-")}</div>
          </div>
          ` : ``}
        </div>
        ` : ``}

        <div class="meta">
          <div class="kv">
            <div class="k">押した順</div>
            <div class="v">${order ? `${order}位` : "-"}</div>
          </div>
          <div class="kv">
            <div class="k">先着差</div>
            <div class="v">${gapText}</div>
          </div>
          <div class="kv">
            <div class="k">休み</div>
            <div class="v">${restCount}</div>
          </div>
        </div>
      `;
    }

    grid.appendChild(tile);
  }
}


client.onState((st) => {
  // 先にUIを更新（音で描画が遅れないようにする）
  if(st.buzzer.firstBuzz != null){
    const first = st.buzzer.firstBuzz;
    const firstName = first ? (st.players[first.playerId]?.name ?? first.playerId) : "-";
    const firstEl = document.querySelector("#first");
    if (firstEl) firstEl.textContent = firstName;
  }

  renderJoinQr(st);

  function computeHudMode(st, modActive) {
    // MOD VIEW時は最初から full は使わない（要求どおり）
    const base = modActive ? "compact" : "full";

    // 人数が多ければ先に落とす（目安）
    const n = Object.keys(st.players || {}).length;
    let mode = base;
    if (modActive && n >= 9) mode = "pressedOnly"; // 目安：増えたら一気に押した人だけ

    return mode;
  }

  function isHudOverflowing() {
    if (!hudRoot) return false;
    return hudRoot.scrollHeight > hudRoot.clientHeight + 2;
  }

  // ここから音（描画の後・awaitしない）
  const s = st.sfx;
  const nonce = Number(s?.nonce ?? 0);

  if (nonce !== 0 && nonce !== lastSfxNonce) {
    lastSfxNonce = nonce;

    const key = String(s.key || "");
    const chainKey = String(s.chainKey || "");

    // Promiseは待たずに投げる（UIを止めない）
    try {
      if (key === "thinking") {
        const sec = Number(s.durationSec ?? st.rules?.thinkingSeconds ?? 5);
        void toggleThinking(sec);
      } else if (chainKey) {
        void playSfxSequence([key, chainKey]);
      } else {
        void playSfxOnce(key);
      }
    } catch (e) {
      // 例外で描画が止まらないように握る（必要なら console に出してOK）
      // console.error(e);
    }
  }

    // MODへ state 通知（既に入れてる想定）
  if (window.QUMO_MOD_API) {
    window.QUMO_MOD_API.emitState(st);
  }

  // ★ main をロード
  const modId = st?.mods?.active || null;
  const modActive = !!modId;

  if (modId) {
    loadMain(modId);
    if (mainFrame && mainFrame.contentWindow) {
      mainFrame.contentWindow.postMessage({ type: "MOD_STATE", state: st }, "*");
    }
  } else {
    // MODなし：iframeを消して、HUDを通常表示に戻す
    currentMainModId = null;
    mainFrame = null;
    const root = document.getElementById("mod-main-root");
    if (root) root.innerHTML = "";
  }

  
  // 1) ベースモードを決める
  let nextHudMode = computeHudMode(st, modActive);
  hudMode = nextHudMode;
  applyHudClasses(modActive);

  // 2) まず描画
  renderPlayers(st, hudMode);

  // 3) 入りきらなければ段階的に落として再描画
  if (modActive && isHudOverflowing() && hudMode === "full") {
    hudMode = "compact";
    applyHudClasses(modActive);
    renderPlayers(st, hudMode);
  }

  if (modActive && isHudOverflowing() && hudMode !== "pressedOnly") {
    hudMode = "pressedOnly";
    applyHudClasses(modActive);
    renderPlayers(st, "compact"); // 見た目はcompactのまま、CSSでpressed以外を消す
  }

  if (!modActive) {
    hudMode = "full";
    document.body.classList.remove("modView");
    hudRoot?.classList.remove("compact", "pressedOnly");
  }


});

