// public/common/sfx.js
// wav/mp3 を <audio> で再生。thinkingはループ＆停止制御。
// 追加: SFX_FILES は string でも string[] でもOK（wav/mp3フォールバック）

const SFX_FILES = {
  // 先に.wav を試して、なければ .mp3
  correct: ["/assets/sfx/correct.wav", "/assets/sfx/correct.mp3"],
  wrong:   ["/assets/sfx/wrong.wav",   "/assets/sfx/wrong.mp3"],
  skip:    ["/assets/sfx/skip.wav",    "/assets/sfx/skip.mp3"],
  buzzer:  ["/assets/sfx/buzzer.wav",  "/assets/sfx/buzzer.mp3"],
  attack:  ["/assets/sfx/attack.wav",  "/assets/sfx/attack.mp3"],
  push:  ["/assets/sfx/push.wav",  "/assets/sfx/push.mp3"],
  pass:  ["/mods/timerace/assets/pass.mp3"],

  // thinking はループ隙間を減らすため wav 優先
  thinking: ["/assets/sfx/thinking.wav", "/assets/sfx/thinking.mp3"],
};

const POOL_SIZE = 4;
const pools = new Map(); // key -> { audios: Audio[], idx: number }

let volume = 1.0;

// thinking専用
let thinkingCtx = null;
let thinkingGain = null;
let thinkingBuffer = null;
let thinkingSource = null;
let thinkingTimer = null;
let thinkingPlaying = false;
let thinkingToken = 0;

let seqToken = 0;
let seqAudio = null;

// key -> resolved src (string or null)
const resolvedSrc = new Map();

export async function warmupSfx() {
  for (const key of Object.keys(SFX_FILES)) {
    try {
      if (key === "thinking") {
        await ensureThinkingBuffer();
      } else {
        await getPool(key);
      }
    } catch {}
  }
}

function stopOneShotSequence() {
  seqToken++;
  if (seqAudio) {
    try {
      seqAudio.pause();
      seqAudio.currentTime = 0;
    } catch {}
    seqAudio = null;
  }
}

function getCandidates(key) {
  const v = SFX_FILES[key];
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v]; // string を許容
}

// <audio> のロードイベントで「そのURLが読めるか」を判定
function probeAudio(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "auto";

    let settled = false;
    const cleanup = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      try {
        a.removeEventListener("loadeddata", onOk);
        a.removeEventListener("canplaythrough", onOk);
        a.removeEventListener("error", onNg);
      } catch {}
      resolve(ok);
    };

    const onOk = () => cleanup(true);
    const onNg = () => cleanup(false);

    a.addEventListener("loadeddata", onOk, { once: true });
    a.addEventListener("canplaythrough", onOk, { once: true });
    a.addEventListener("error", onNg, { once: true });

    const t = setTimeout(() => cleanup(false), timeoutMs);

    try {
      a.src = url;
      a.load();
    } catch {
      cleanup(false);
    }
  });
}

async function resolveSrc(key) {
  if (resolvedSrc.has(key)) return resolvedSrc.get(key);

  const candidates = getCandidates(key);
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await probeAudio(url);
    if (ok) {
      resolvedSrc.set(key, url);
      return url;
    }
  }

  console.warn("[SFX] not found:", key, candidates);
  resolvedSrc.set(key, null);
  return null;
}

async function getPool(key) {
  if (pools.has(key)) return pools.get(key);

  const src = await resolveSrc(key);
  if (!src) return null;

  const audios = Array.from({ length: POOL_SIZE }, () => {
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = volume;
    return a;
  });

  const pool = { audios, idx: 0 };
  pools.set(key, pool);
  return pool;
}

async function ensureThinkingAudio() {
  if (thinkingCtx) return thinkingCtx;

  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;

  thinkingCtx = new Ctor();
  thinkingGain = thinkingCtx.createGain();
  thinkingGain.gain.value = volume;
  thinkingGain.connect(thinkingCtx.destination);
  return thinkingCtx;
}

async function ensureThinkingBuffer() {
  if (thinkingBuffer) return thinkingBuffer;

  const src = await resolveSrc("thinking");
  if (!src) return null;

  const ctx = await ensureThinkingAudio();
  if (!ctx) return null;

  try {
    const res = await fetch(src, { cache: "force-cache" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    thinkingBuffer = await ctx.decodeAudioData(buf.slice(0));
    return thinkingBuffer;
  } catch {
    return null;
  }
}

export function setSfxVolume(v) {
  const nv = Math.max(0, Math.min(1, Number(v)));
  volume = Number.isFinite(nv) ? nv : 1.0;

  for (const pool of pools.values()) {
    for (const a of pool.audios) a.volume = volume;
  }
  if (thinkingGain) thinkingGain.gain.value = volume;
}

export function isThinkingPlaying() {
  return thinkingPlaying;
}

function stopThinkingInternal() {
  thinkingPlaying = false;
  if (thinkingTimer) {
    clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
  try {
    thinkingSource?.stop();
  } catch { /* noop */ }
  try {
    thinkingSource?.disconnect();
  } catch { /* noop */ }
  thinkingSource = null;
}

export function stopThinking() {
  thinkingToken++;
  stopThinkingInternal();
}

export function stopAllSfx() {
  stopThinking();
  stopOneShotSequence();
  for (const pool of pools.values()) {
    for (const audio of pool.audios) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    }
  }
}

export async function startThinking(durationSec) {
  // durationSec <= 0 は「開始せず即停止」扱い
  const sec = Math.max(0, Number(durationSec ?? 0));
  if (sec <= 0) {
    stopThinking();
    return;
  }

  const token = ++thinkingToken;
  stopThinkingInternal();

  const ctx = await ensureThinkingAudio();
  const buffer = await ensureThinkingBuffer();
  if (!ctx || !buffer || !thinkingGain) return;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (token !== thinkingToken) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(thinkingGain);
    source.start(0);

    if (token !== thinkingToken) {
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
      return;
    }

    thinkingSource = source;
    thinkingPlaying = true;

    thinkingTimer = setTimeout(() => {
      if (token !== thinkingToken) return;
      stopThinking();
    }, Math.floor(sec * 1000));
  } catch {
    // autoplay制限など（Visualizerを一度クリックすると通りやすい）
    if (token === thinkingToken) thinkingPlaying = false;
  }
}

export async function startThinkingLoop() {
  const token = ++thinkingToken;
  stopThinkingInternal();

  const ctx = await ensureThinkingAudio();
  const buffer = await ensureThinkingBuffer();
  if (!ctx || !buffer || !thinkingGain) return;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (token !== thinkingToken) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(thinkingGain);
    source.start(0);

    if (token !== thinkingToken) {
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
      return;
    }

    thinkingSource = source;
    thinkingPlaying = true;
  } catch {
    if (token === thinkingToken) thinkingPlaying = false;
  }
}

export async function toggleThinking(durationSec) {
  if (thinkingPlaying) {
    stopThinking();
  } else {
    await startThinking(durationSec);
  }
}

export async function playSfxOnce(key) {
  stopOneShotSequence(); // 既存のone-shot連続再生があれば止める
  stopThinking();        // 仕様：他SEが鳴ったらthinking停止

  const pool = await getPool(key);
  if (!pool) return;

  const a = pool.audios[pool.idx];
  pool.idx = (pool.idx + 1) % pool.audios.length;

  const ended = new Promise((resolve) => {
    a.addEventListener("ended", resolve, { once: true });
    a.addEventListener("error", resolve, { once: true });
  });

  try {
    a.pause();
    a.currentTime = 0;
    a.volume = volume;
    await a.play();
    await ended;
  } catch {
    // autoplay制限など
  }
}

export async function playSfxConcurrent(key) {
  stopOneShotSequence();

  const pool = await getPool(key);
  if (!pool) return;

  const a = pool.audios[pool.idx];
  pool.idx = (pool.idx + 1) % pool.audios.length;

  try {
    a.pause();
    a.currentTime = 0;
    a.volume = volume;
    await a.play();
  } catch {
    // autoplay制限など
  }
}

export async function playSfxSequence(keys) {
  // keys: ["wrong", "buzzer"] みたいな配列
  stopOneShotSequence();
  stopThinking();

  const token = ++seqToken;

  for (const key of keys) {
    if (token !== seqToken) return; // 他のSEで中断された

    // eslint-disable-next-line no-await-in-loop
    const src = await resolveSrc(key);
    if (!src) continue;

    const a = new Audio(src);
    seqAudio = a;
    a.preload = "auto";
    a.volume = volume;

    const ended = new Promise((resolve) => {
      a.addEventListener("ended", resolve, { once: true });
      a.addEventListener("error", resolve, { once: true });
    });

    try {
      a.currentTime = 0;
      await a.play();
    } catch {
      // autoplay制限など
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await ended;
  }

  // 終了
  if (token === seqToken) seqAudio = null;
}
