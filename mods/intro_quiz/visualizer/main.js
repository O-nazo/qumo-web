let state = null;
let currentCommandNonce = -1;
let currentSourceKey = "";
let youtubeReadyPromise = null;
let youtubePlayer = null;
let youtubeStatusTimer = null;
let autoStopTimer = null;
let staticFrameHandle = 0;
let staticLastTickAt = 0;
let overlayTimer = 0;
let overlayTimerEndsAt = 0;
let mediaFadeToken = 0;
let currentVolumeCommandNonce = -1;

const MEDIA_FADE_OUT_MS = 400;

const audioPlayer = document.getElementById("audioPlayer");
const videoPlayer = document.getElementById("videoPlayer");
const youtubeWrap = document.getElementById("youtubeWrap");
const mediaPlaceholder = document.getElementById("mediaPlaceholder");
const questionMark = document.getElementById("questionMark");
const staticCanvas = document.getElementById("staticCanvas");
const staticCtx = staticCanvas?.getContext?.("2d", { alpha: false });
const mediaOverlay = document.getElementById("mediaOverlay");
const overlayJudge = document.getElementById("overlayJudge");
const overlayJudgeMark = document.getElementById("overlayJudgeMark");
const overlayThinking = document.getElementById("overlayThinking");
const overlayThinkingCountdown = document.getElementById("overlayThinkingCountdown");
const answerMeta = document.getElementById("answerMeta");
const answerMetaName = document.getElementById("answerMetaName");
const playerStatusIcon = document.getElementById("playerStatusIcon");
const playerStatusText = document.getElementById("playerStatusText");

function resizeStaticCanvas() {
  if (!staticCanvas) return;
  const rect = staticCanvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (staticCanvas.width === width && staticCanvas.height === height) return;
  staticCanvas.width = width;
  staticCanvas.height = height;
}

function renderStaticFrame() {
  if (!staticCtx || !staticCanvas) return;
  resizeStaticCanvas();
  const width = staticCanvas.width;
  const height = staticCanvas.height;
  const imageData = staticCtx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    const rowBias = ((Math.random() - 0.5) * 36) + ((y % 5 === 0) ? 18 : 0);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const grain = Math.random() * 255;
      const streak = (Math.random() > 0.992 ? 90 : 0);
      const value = Math.max(0, Math.min(255, grain + rowBias + streak));
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  staticCtx.putImageData(imageData, 0, 0);
}

function tickStatic(now) {
  if (!mediaPlaceholder || mediaPlaceholder.hidden) {
    staticFrameHandle = 0;
    return;
  }
  if (!staticLastTickAt || now - staticLastTickAt >= 33) {
    staticLastTickAt = now;
    renderStaticFrame();
  }
  staticFrameHandle = requestAnimationFrame(tickStatic);
}

function ensureStaticAnimation() {
  if (!mediaPlaceholder || mediaPlaceholder.hidden) {
    if (staticFrameHandle) {
      cancelAnimationFrame(staticFrameHandle);
      staticFrameHandle = 0;
    }
    return;
  }
  if (staticFrameHandle) return;
  staticLastTickAt = 0;
  staticFrameHandle = requestAnimationFrame(tickStatic);
}

function updateMediaVisibility() {
  const source = getCurrentSource();
  const showAnswerMedia = !!state?.showAnswer;
  const overlayMode = String(state?.overlay?.mode || "idle");
  const showQuestionMark = state?.phase === "PLAYING" && !showAnswerMedia;
  const showAnswerLetter = !showAnswerMedia && state?.phase === "BUZZED" && overlayMode !== "thinking";
  const showOverlay = overlayMode === "wrong" || overlayMode === "thinking";
  const isVideoSource = source?.type === "video_url";
  const isYoutubeSource = source?.type === "youtube";

  mediaPlaceholder.hidden = showQuestionMark || showAnswerLetter || showOverlay || (showAnswerMedia && (isVideoSource || isYoutubeSource));
  videoPlayer.hidden = !showAnswerMedia || !isVideoSource;
  youtubeWrap.hidden = !showAnswerMedia || !isYoutubeSource;
  ensureStaticAnimation();
}

function stopOverlayTimer() {
  if (!overlayTimer) return;
  clearInterval(overlayTimer);
  overlayTimer = 0;
  overlayTimerEndsAt = 0;
}

function formatOverlayCountdown(endsAt) {
  const remainMs = Math.max(0, Number(endsAt || 0) - Date.now());
  return String(Math.ceil(remainMs / 1000));
}

function renderOverlay() {
  const overlay = state?.overlay || {};
  const mode = String(overlay.mode || "idle");
  const show = mode === "wrong" || mode === "thinking";
  mediaOverlay.classList.toggle("hidden", !show);
  overlayJudge.classList.toggle("hidden", mode !== "wrong");
  overlayThinking.classList.toggle("hidden", mode !== "thinking");
  overlayJudgeMark.textContent = mode === "wrong" ? "✕" : "";
  overlayThinkingCountdown.textContent = "";

  if (mode === "thinking" && overlay.thinkingEndsAt) {
    if (overlayTimerEndsAt === Number(overlay.thinkingEndsAt) && overlayTimer) return;
    stopOverlayTimer();
    const renderTick = () => {
      const value = formatOverlayCountdown(overlay.thinkingEndsAt);
      overlayThinkingCountdown.textContent = value;
      if (Number(value) <= 0) stopOverlayTimer();
    };
    renderTick();
    overlayTimerEndsAt = Number(overlay.thinkingEndsAt);
    overlayTimer = setInterval(renderTick, 200);
    return;
  }

  stopOverlayTimer();
}

function qs(id) {
  return document.getElementById(id);
}

function getCurrentQuestion() {
  return state?.current || null;
}

function getCurrentSource() {
  return getCurrentQuestion()?.source || null;
}

function getSourceKey(source) {
  if (!source) return "";
  return [
    source.type || "",
    source.resolvedUrl || "",
    source.videoId || "",
    source.path || ""
  ].join("|");
}

function dispatchAction(action) {
  try {
    window.parent?.QUMO_MOD_API?.dispatch?.(action);
  } catch (error) {
    console.warn("[intro_quiz] dispatch failed", error);
  }
}

function clearAutoStop() {
  if (!autoStopTimer) return;
  clearTimeout(autoStopTimer);
  autoStopTimer = null;
}

function getDesiredVolume() {
  const value =
    state?.volumeCommandValue ??
    state?.playbackStatus?.volume ??
    100;
  return Math.max(0, Math.min(100, Math.round(Number(value) || 100)));
}

function resetPlayerVolumes() {
  const desiredVolume = getDesiredVolume();
  audioPlayer.volume = desiredVolume / 100;
  videoPlayer.volume = desiredVolume / 100;
  if (youtubePlayer?.setVolume) {
    youtubePlayer.setVolume(desiredVolume);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fadeOutHtmlMedia(player, token) {
  const startVolume = Math.max(0, Math.min(1, Number(player.volume) || 1));
  const startedAt = performance.now();
  while (true) {
    if (token !== mediaFadeToken) return false;
    const elapsed = performance.now() - startedAt;
    const ratio = Math.max(0, 1 - (elapsed / MEDIA_FADE_OUT_MS));
    player.volume = startVolume * ratio;
    if (elapsed >= MEDIA_FADE_OUT_MS) break;
    await wait(16);
  }
  player.volume = 0;
  return true;
}

async function fadeOutYoutube(token) {
  if (!youtubePlayer?.getVolume || !youtubePlayer?.setVolume) return false;
  const startVolume = Math.max(0, Math.min(100, Number(youtubePlayer.getVolume()) || 100));
  const startedAt = performance.now();
  while (true) {
    if (token !== mediaFadeToken) return false;
    const elapsed = performance.now() - startedAt;
    const ratio = Math.max(0, 1 - (elapsed / MEDIA_FADE_OUT_MS));
    youtubePlayer.setVolume(Math.round(startVolume * ratio));
    if (elapsed >= MEDIA_FADE_OUT_MS) break;
    await wait(16);
  }
  youtubePlayer.setVolume(0);
  return true;
}

function scheduleAutoStop(source, enabled) {
  clearAutoStop();
  if (!enabled) return;
  const duration = Math.max(0, Number(source?.stopAfterSec) || 0);
  if (duration <= 0) return;
  autoStopTimer = setTimeout(() => stopPlayback(false), duration * 1000);
}

function emitPlaybackStatus(extra = {}) {
  const source = getCurrentSource();
  const provider = source?.providerLabel || "none";
  dispatchAction({
    type: "IQ_PLAYBACK_STATUS",
    provider,
    paused: extra.paused !== undefined ? extra.paused : true,
    currentTime: Number(extra.currentTime) || 0,
    duration: Number(extra.duration) || 0,
    ready: extra.ready === true,
    limitedControl: source?.limitedControl === true,
    volume: Math.max(0, Math.min(100, Math.round(Number(extra.volume) || getCurrentVolumeForSource(source) || 100)))
  });
}

function hideAllPlayers() {
  mediaFadeToken += 1;
  resetPlayerVolumes();
  audioPlayer.pause();
  videoPlayer.pause();
  videoPlayer.hidden = true;
  youtubeWrap.hidden = true;
}

function getCurrentTimeForSource(source) {
  if (!source) return 0;
  if (source.type === "local" || source.type === "audio_url") return Number(audioPlayer.currentTime) || 0;
  if (source.type === "video_url") return Number(videoPlayer.currentTime) || 0;
  if (source.type === "youtube" && youtubePlayer?.getCurrentTime) return Number(youtubePlayer.getCurrentTime()) || 0;
  return 0;
}

function getDurationForSource(source) {
  if (!source) return 0;
  if (source.type === "local" || source.type === "audio_url") return Number(audioPlayer.duration) || 0;
  if (source.type === "video_url") return Number(videoPlayer.duration) || 0;
  if (source.type === "youtube" && youtubePlayer?.getDuration) return Number(youtubePlayer.getDuration()) || 0;
  return 0;
}

function getCurrentVolumeForSource(source) {
  if (!source) return 100;
  if (source.type === "local" || source.type === "audio_url") return Math.round((Number(audioPlayer.volume) || 1) * 100);
  if (source.type === "video_url") return Math.round((Number(videoPlayer.volume) || 1) * 100);
  if (source.type === "youtube" && youtubePlayer?.getVolume) return Math.round(Number(youtubePlayer.getVolume()) || 100);
  return 100;
}

function applyVolumeToCurrentSource(volume) {
  const source = getCurrentSource();
  const next = Math.max(0, Math.min(100, Math.round(Number(volume) || 100)));
  if (!source) return;
  if (source.type === "local" || source.type === "audio_url") {
    audioPlayer.volume = next / 100;
  } else if (source.type === "video_url") {
    videoPlayer.volume = next / 100;
  } else if (source.type === "youtube" && youtubePlayer?.setVolume) {
    youtubePlayer.setVolume(next);
  }
}

async function stopPlayback(emitOnly = false, fadeOut = true) {
  clearAutoStop();
  const source = getCurrentSource();
  if (!source) {
    emitPlaybackStatus({ paused: true, currentTime: 0, duration: 0, ready: false });
    return;
  }

  if (!emitOnly) {
    const token = ++mediaFadeToken;
    if (source.type === "local" || source.type === "audio_url") {
      if (fadeOut) await fadeOutHtmlMedia(audioPlayer, token);
      audioPlayer.pause();
      audioPlayer.volume = getDesiredVolume() / 100;
    } else if (source.type === "video_url") {
      if (fadeOut) await fadeOutHtmlMedia(videoPlayer, token);
      videoPlayer.pause();
      videoPlayer.volume = getDesiredVolume() / 100;
    } else if (source.type === "youtube" && youtubePlayer?.pauseVideo) {
      if (fadeOut) await fadeOutYoutube(token);
      youtubePlayer.pauseVideo();
      if (youtubePlayer?.setVolume) youtubePlayer.setVolume(getDesiredVolume());
    }
  }

  emitPlaybackStatus({
    paused: true,
    currentTime: getCurrentTimeForSource(source),
    duration: getDurationForSource(source),
    ready: true
  });
}

function rewindPlayback(cueSec) {
  const source = getCurrentSource();
  if (!source) return;
  clearAutoStop();

  if (source.type === "local" || source.type === "audio_url") {
    audioPlayer.pause();
    audioPlayer.currentTime = cueSec;
  } else if (source.type === "video_url") {
    videoPlayer.pause();
    videoPlayer.currentTime = cueSec;
  } else if (source.type === "youtube" && youtubePlayer?.seekTo) {
    youtubePlayer.pauseVideo();
    youtubePlayer.seekTo(cueSec, true);
  }

  emitPlaybackStatus({
    paused: true,
    currentTime: cueSec,
    duration: getDurationForSource(source),
    ready: true,
    volume: getCurrentVolumeForSource(source)
  });
}

async function ensureYoutubeApi() {
  if (window.YT?.Player) return;
  if (!youtubeReadyPromise) {
    youtubeReadyPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
      window.onYouTubeIframeAPIReady = () => resolve();
    });
  }
  await youtubeReadyPromise;
}

async function ensureYoutubePlayer(videoId) {
  await ensureYoutubeApi();
  if (youtubePlayer) return youtubePlayer;
  youtubePlayer = new window.YT.Player("youtubePlayer", {
    videoId,
    playerVars: {
      autoplay: 0,
      controls: 0,
      modestbranding: 1,
      rel: 0
    },
    events: {
      onReady() {
        emitPlaybackStatus({
          paused: true,
          currentTime: 0,
          duration: youtubePlayer?.getDuration?.() || 0,
          ready: true,
          volume: youtubePlayer?.getVolume?.() || 100
        });
      },
      onStateChange() {
        emitPlaybackStatus({
          paused: youtubePlayer?.getPlayerState?.() !== window.YT.PlayerState.PLAYING,
          currentTime: youtubePlayer?.getCurrentTime?.() || 0,
          duration: youtubePlayer?.getDuration?.() || 0,
          ready: true,
          volume: youtubePlayer?.getVolume?.() || 100
        });
      }
    }
  });
  return youtubePlayer;
}

function startYoutubeStatusLoop() {
  stopYoutubeStatusLoop();
  youtubeStatusTimer = setInterval(() => {
    const source = getCurrentSource();
    if (!source || source.type !== "youtube" || !youtubePlayer?.getCurrentTime) return;
    emitPlaybackStatus({
      paused: youtubePlayer.getPlayerState?.() !== window.YT.PlayerState.PLAYING,
      currentTime: youtubePlayer.getCurrentTime() || 0,
      duration: youtubePlayer.getDuration?.() || 0,
      ready: true,
      volume: youtubePlayer.getVolume?.() || 100
    });
  }, 250);
}

function stopYoutubeStatusLoop() {
  if (!youtubeStatusTimer) return;
  clearInterval(youtubeStatusTimer);
  youtubeStatusTimer = null;
}

function setAudioSource(source) {
  hideAllPlayers();
  audioPlayer.src = source.resolvedUrl || "";
  emitPlaybackStatus({ paused: true, currentTime: 0, duration: 0, ready: false });
}

function setVideoSource(source) {
  hideAllPlayers();
  videoPlayer.src = source.resolvedUrl || "";
  emitPlaybackStatus({ paused: true, currentTime: 0, duration: 0, ready: false });
}

async function setYoutubeSource(source) {
  hideAllPlayers();
  const player = await ensureYoutubePlayer(source.videoId);
  player.cueVideoById(source.videoId, 0);
  startYoutubeStatusLoop();
}

async function syncSource() {
  const source = getCurrentSource();
  const nextKey = getSourceKey(source);
  if (currentSourceKey === nextKey) return;
  currentSourceKey = nextKey;
  clearAutoStop();
  stopYoutubeStatusLoop();

  if (!source) {
    hideAllPlayers();
    updateMediaVisibility();
    emitPlaybackStatus({ paused: true, currentTime: 0, duration: 0, ready: false });
    return;
  }

  if (source.type === "local" || source.type === "audio_url") {
    setAudioSource(source);
  } else if (source.type === "video_url") {
    setVideoSource(source);
  } else if (source.type === "youtube") {
    await setYoutubeSource(source);
  } else {
    hideAllPlayers();
    emitPlaybackStatus({ paused: true, currentTime: 0, duration: 0, ready: false });
  }
  updateMediaVisibility();
}

async function playFrom(cueSec, autoStopEnabled) {
  const source = getCurrentSource();
  if (!source) return;
  await syncSource();
  mediaFadeToken += 1;
  resetPlayerVolumes();

  if (source.type === "local" || source.type === "audio_url") {
    audioPlayer.currentTime = cueSec;
    await audioPlayer.play().catch(() => {});
  } else if (source.type === "video_url") {
    videoPlayer.currentTime = cueSec;
    await videoPlayer.play().catch(() => {});
  } else if (source.type === "youtube") {
    const player = await ensureYoutubePlayer(source.videoId);
    player.loadVideoById(source.videoId, cueSec);
  }

  scheduleAutoStop(source, autoStopEnabled);
}

function handleVolumeCommand() {
  if (!state) return;
  const nonce = Number(state.volumeCommandNonce || 0);
  if (nonce === currentVolumeCommandNonce) return;
  currentVolumeCommandNonce = nonce;
  applyVolumeToCurrentSource(state.volumeCommandValue);
}

async function handleCommand() {
  if (!state) return;
  const nonce = Number(state.playbackCommandNonce || 0);
  if (nonce === currentCommandNonce) return;
  currentCommandNonce = nonce;

  const action = String(state.playbackCommandAction || "stop");
  const cueSec = Math.max(0, Number(state.playbackCommandCueSec) || 0);
  const autoStopEnabled = state.playbackCommandAutoStop === true;
  const fadeOutEnabled = state.playbackCommandFadeOut !== false;

  if (action === "play") {
    await playFrom(cueSec, autoStopEnabled);
    return;
  }
  if (action === "rewind") {
    rewindPlayback(cueSec);
    return;
  }
  await stopPlayback(false, fadeOutEnabled);
}

function render() {
  const current = getCurrentQuestion();
  const showMeta = !!state?.showAnswer;
  const overlayMode = String(state?.overlay?.mode || "idle");
  const isThinking = overlayMode === "thinking";
  const isAnswering = !showMeta && state?.phase === "BUZZED";
  const showQuestionMark = state?.phase === "PLAYING" && !showMeta;
  const showAnswerLetter = isAnswering && !isThinking;
  const responderName = String(state?.respondentName || "");
  const yearText = current?.year ? `${current.year}年` : "";
  const noteText = current?.note || "";

  qs("title").textContent = current?.title || "";
  qs("artist").textContent = current?.artist || "";
  qs("year").textContent = yearText;
  qs("note").textContent = noteText;
  qs("title").classList.toggle("metaHidden", !showMeta);
  qs("artist").classList.toggle("metaHidden", !showMeta);
  qs("year").classList.toggle("metaHidden", !showMeta || !yearText);
  qs("note").classList.toggle("metaHidden", !showMeta || !noteText);

  answerMeta.classList.toggle("hidden", !isAnswering);
  answerMetaName.textContent = responderName;
  answerMetaName.classList.toggle("is-long", responderName.length >= 12);
  answerMetaName.classList.toggle("is-xlong", responderName.length >= 18);

  questionMark.textContent = showAnswerLetter ? "A" : "Q";
  questionMark.classList.toggle("visible", showQuestionMark || showAnswerLetter);

  const isActuallyPlaying = state?.playbackStatus?.paused === false;
  let playbackLabelIcon = "■";
  let playbackLabelText = "Waiting";
  if (isActuallyPlaying) {
    playbackLabelIcon = "▶";
    playbackLabelText = "Playing";
  } else if (state?.phase !== "IDLE") {
    playbackLabelIcon = "⏸";
    playbackLabelText = "Pause";
  }
  playerStatusIcon.textContent = playbackLabelIcon;
  playerStatusText.textContent = playbackLabelText;

  renderOverlay();
  updateMediaVisibility();
}

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "MOD_INIT") {
    window.parent.postMessage({
      type: "MOD_MAIN_CMD",
      cmd: { type: "IQ_SYNC_STATE" }
    }, "*");
    return;
  }

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    state = msg.event.state;
    render();
    await syncSource();
    handleVolumeCommand();
    await handleCommand();
  }
});

audioPlayer.addEventListener("loadedmetadata", () => {
  emitPlaybackStatus({
    paused: audioPlayer.paused,
    currentTime: audioPlayer.currentTime,
    duration: audioPlayer.duration,
    ready: true,
    volume: audioPlayer.volume * 100
  });
});

audioPlayer.addEventListener("timeupdate", () => {
  emitPlaybackStatus({
    paused: audioPlayer.paused,
    currentTime: audioPlayer.currentTime,
    duration: audioPlayer.duration,
    ready: true,
    volume: audioPlayer.volume * 100
  });
});

audioPlayer.addEventListener("pause", () => {
  emitPlaybackStatus({
    paused: true,
    currentTime: audioPlayer.currentTime,
    duration: audioPlayer.duration,
    ready: true,
    volume: audioPlayer.volume * 100
  });
});

audioPlayer.addEventListener("play", () => {
  emitPlaybackStatus({
    paused: false,
    currentTime: audioPlayer.currentTime,
    duration: audioPlayer.duration,
    ready: true,
    volume: audioPlayer.volume * 100
  });
});

videoPlayer.addEventListener("loadedmetadata", () => {
  emitPlaybackStatus({
    paused: videoPlayer.paused,
    currentTime: videoPlayer.currentTime,
    duration: videoPlayer.duration,
    ready: true,
    volume: videoPlayer.volume * 100
  });
});

videoPlayer.addEventListener("timeupdate", () => {
  emitPlaybackStatus({
    paused: videoPlayer.paused,
    currentTime: videoPlayer.currentTime,
    duration: videoPlayer.duration,
    ready: true,
    volume: videoPlayer.volume * 100
  });
});

videoPlayer.addEventListener("pause", () => {
  emitPlaybackStatus({
    paused: true,
    currentTime: videoPlayer.currentTime,
    duration: videoPlayer.duration,
    ready: true,
    volume: videoPlayer.volume * 100
  });
});

videoPlayer.addEventListener("play", () => {
  emitPlaybackStatus({
    paused: false,
    currentTime: videoPlayer.currentTime,
    duration: videoPlayer.duration,
    ready: true,
    volume: videoPlayer.volume * 100
  });
});

audioPlayer.addEventListener("ended", () => { void stopPlayback(false); });
videoPlayer.addEventListener("ended", () => { void stopPlayback(false); });
window.addEventListener("resize", resizeStaticCanvas);
window.addEventListener("pagehide", stopOverlayTimer);
ensureStaticAnimation();
