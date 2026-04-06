let state = null;
let coreState = null;
let prevPhase = null;
let prevQuestionKey = "";
let prevShowAnswer = false;
let lastDisplayedMediaKey = "";
let lastRewindNonce = -1;
let lastMediaControlNonce = -1;
let lastInstantCloseNonce = -1;
let lastMediaStatusSignature = "";
let lastMediaStatusAt = 0;

function getVisualizerQuestionText(question) {
  const raw = String(question ?? "");
  const match = raw.match(/【([^【】]+)】/);
  if (match) return match[1].trim();
  return raw;
}

function getPromptMedia(question) {
  if (!question) return null;
  if (question.promptMedia?.file) return question.promptMedia;
  if (question.file) {
    return {
      file: question.file,
      kind: question.mediaKind || "image"
    };
  }
  return null;
}

function getAnswerMedia(question) {
  return question?.answerMedia?.file ? question.answerMedia : null;
}

function getMediaKey(media) {
  if (!media?.file) return "";
  return `${media.kind || "image"}:${media.url || media.file}`;
}

function getMediaUrl(media) {
  if (!media?.file) return "";
  if (media.url) return media.url;
  const setId = String(media.setId ?? state?.setId ?? "");
  if (!setId) return "";
  return `../assets/q/${encodeURIComponent(setId)}/images/${encodeURIComponent(media.file)}`;
}

function dispatchAction(action) {
  try {
    window.parent?.QUMO_MOD_API?.dispatch?.(action);
  } catch (e) {
    console.warn("[visual_quiz] dispatch failed", e);
  }
}

function emitMediaStatus(video, media, { force = false } = {}) {
  const isVideo = !!media?.file && media?.kind === "video";
  const paused = isVideo ? (video?.paused !== false) : true;
  const currentTime = isVideo ? (Number(video?.currentTime) || 0) : 0;
  const duration = isVideo && Number.isFinite(Number(video?.duration)) ? Number(video.duration) : 0;
  const roundedTime = Math.round(currentTime * 2) / 2;
  const roundedDuration = Math.round(duration * 2) / 2;
  const mediaKey = getMediaKey(media);
  const signature = `${mediaKey}|${isVideo ? 1 : 0}|${paused ? 1 : 0}|${roundedTime}|${roundedDuration}`;
  const now = performance.now();

  if (!force) {
    if (signature === lastMediaStatusSignature) return;
    if (isVideo && !paused && now - lastMediaStatusAt < 200) return;
  }

  lastMediaStatusSignature = signature;
  lastMediaStatusAt = now;
  dispatchAction({
    type: "VQ_MEDIA_STATUS",
    isVideo,
    paused,
    currentTime,
    duration,
    mediaKey
  });
}

function pauseVideo(video) {
  try {
    video.pause();
  } catch {}
}

function rewindVideo(video) {
  pauseVideo(video);
  try {
    video.currentTime = 0;
  } catch {}
}

async function playVideo(video, resetToStart = false) {
  try {
    if (resetToStart) video.currentTime = 0;
    await video.play();
  } catch {}
}

function setVideoSource(video, media) {
  const key = getMediaKey(media);
  if (video.dataset.mediaKey === key) return false;

  pauseVideo(video);
  video.removeAttribute("src");
  video.load();
  video.dataset.mediaKey = key;

  if (media?.file) {
    video.src = getMediaUrl(media);
    video.load();
  }
  emitMediaStatus(video, media, { force: true });
  return true;
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "MOD_STATE") {
    coreState = msg.state || null;
    render();
    return;
  }

  if (msg.type === "MOD_EVENT" && msg.event?.type === "STATE") {
    state = msg.event.state;
    render();
  }
});

function render() {
  if (!state) return;

  const windowInner = document.getElementById("window-inner");
  const img = document.getElementById("q-image");
  const video = document.getElementById("q-video");
  const titleScreen = document.getElementById("title-screen");

  const q1 = document.getElementById("q-text");
  const q2 = document.getElementById("q-text2");

  const telop = document.getElementById("telop");
  const answer = document.getElementById("answer-text");
  const current = state.current || null;
  const promptMedia = getPromptMedia(current);
  const answerMedia = getAnswerMedia(current);
  const isShowingAnswerMedia = !!(state.showAnswer && answerMedia?.file);
  const shouldRevealPromptMedia = !!state.lidOpen && !isShowingAnswerMedia;
  const activeMedia = isShowingAnswerMedia ? answerMedia : promptMedia;
  const questionKey = `${String(current?.setId ?? state?.setId ?? "")}:${String(current?.no ?? "")}`;
  const activeMediaKey = getMediaKey(activeMedia);
  const rewindNonce = Number(state.rewindNonce ?? 0);
  const mediaControlNonce = Number(state.mediaControlNonce ?? 0);
  const mediaControlAction = String(state.mediaControlAction || "");
  const mediaSeekTimeSec = Math.max(0, Number(state.mediaSeekTimeSec) || 0);
  const instantCloseNonce = Number(state.instantCloseNonce ?? 0);
  const instantCloseChanged = instantCloseNonce !== lastInstantCloseNonce;
  const mediaControlChanged = mediaControlNonce !== lastMediaControlNonce;
  const phaseChanged = (state.phase || null) !== prevPhase;
  const showTitleScreen = coreState?.titleScreenVisible === true;
  if (titleScreen) {
    titleScreen.hidden = !showTitleScreen;
  }

  // 蓋（開閉）
  if (instantCloseChanged) {
    windowInner.classList.add("instantClose");
  }
  windowInner.classList.toggle("open", showTitleScreen ? false : !!state.lidOpen);
  if (instantCloseChanged) {
    requestAnimationFrame(() => {
      windowInner.classList.remove("instantClose");
    });
  }

  // 問題文：全文を上下2枚に同じ位置で描画
  const q = showTitleScreen
    ? ""
    : state.showQuestionText
    ? getVisualizerQuestionText(state.current?.question)
    : "";
  if (q1) {
    q1.textContent = q;
  }
  if (q2) {
    q2.textContent = q;
  }

  if (showTitleScreen) {
    pauseVideo(video);
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
    video.dataset.mediaKey = "";
    img.hidden = true;
    img.removeAttribute("src");
    if (state.mediaPlayback?.isVideo) {
      emitMediaStatus(video, null, { force: true });
    }
  } else if (activeMedia?.kind === "video") {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = !shouldRevealPromptMedia && !isShowingAnswerMedia;

    const mediaChanged = setVideoSource(video, activeMedia);
    const questionChanged = questionKey !== prevQuestionKey;
    const rewound = rewindNonce !== lastRewindNonce;
    let handledByManualControl = false;

    if (rewound) {
      rewindVideo(video);
      handledByManualControl = true;
    }

    if (mediaControlChanged) {
      if (mediaControlAction === "pause") {
        pauseVideo(video);
        handledByManualControl = true;
      } else if (mediaControlAction === "play") {
        void playVideo(video, false);
        handledByManualControl = true;
      } else if (mediaControlAction === "toggle") {
        if (video.paused) {
          void playVideo(video, false);
        } else {
          pauseVideo(video);
        }
        handledByManualControl = true;
      } else if (mediaControlAction === "seek") {
        try {
          video.currentTime = mediaSeekTimeSec;
        } catch {}
        handledByManualControl = true;
      }
    }

    if (!handledByManualControl && isShowingAnswerMedia) {
      if (mediaChanged || !prevShowAnswer || questionChanged) {
        void playVideo(video, true);
      }
    } else if (!handledByManualControl && state.phase === "REVEALED") {
      const enteredRevealed = phaseChanged && prevPhase !== "REVEALED";
      const resumeFromBuzz = prevPhase === "BUZZED" && !questionChanged && !prevShowAnswer;
      if (mediaChanged || questionChanged || enteredRevealed) {
        void playVideo(video, !resumeFromBuzz);
      }
    } else if (!handledByManualControl && state.phase === "BUZZED") {
      pauseVideo(video);
    } else if (!handledByManualControl && state.phase === "LOADED") {
      pauseVideo(video);
      if (mediaChanged || questionChanged) {
        video.currentTime = 0;
      }
    } else if (!handledByManualControl && !state.lidOpen) {
      pauseVideo(video);
    }
  } else {
    pauseVideo(video);
    video.hidden = true;
    video.removeAttribute("src");
    video.load();
    video.dataset.mediaKey = "";

    if (activeMedia?.file) {
      img.hidden = !shouldRevealPromptMedia && !isShowingAnswerMedia;
      img.src = getMediaUrl(activeMedia);
    } else {
      img.hidden = false;
      img.removeAttribute("src");
    }

    if (state.mediaPlayback?.isVideo) {
      emitMediaStatus(video, null, { force: true });
    }
  }

  // 解答テロップ（重ね表示）
  if (!showTitleScreen && state.showAnswer && current) {
    answer.textContent = current.answer ?? "";
    telop.classList.remove("hidden");
  } else {
    answer.textContent = "";
    telop.classList.add("hidden");
  }

  prevPhase = state.phase || null;
  prevQuestionKey = questionKey;
  prevShowAnswer = !!state.showAnswer;
  lastDisplayedMediaKey = activeMediaKey;
  lastRewindNonce = rewindNonce;
  lastMediaControlNonce = mediaControlNonce;
  lastInstantCloseNonce = instantCloseNonce;

}

document.getElementById("q-video")?.addEventListener("ended", () => {
  const current = state?.current || null;
  const promptMedia = getPromptMedia(current);
  const promptKey = getMediaKey(promptMedia);
  if (!promptKey) return;
  if (lastDisplayedMediaKey !== promptKey) return;
  if (state?.phase !== "REVEALED" || state?.showAnswer) return;

  dispatchAction({
    type: "CORE_COMMAND",
    command: "JUDGE_SKIP"
  });
});

document.getElementById("q-video")?.addEventListener("loadedmetadata", () => {
  const current = state?.current || null;
  const media = state?.showAnswer ? getAnswerMedia(current) || getPromptMedia(current) : getPromptMedia(current);
  emitMediaStatus(document.getElementById("q-video"), media, { force: true });
});

document.getElementById("q-video")?.addEventListener("play", () => {
  const current = state?.current || null;
  const media = state?.showAnswer ? getAnswerMedia(current) || getPromptMedia(current) : getPromptMedia(current);
  emitMediaStatus(document.getElementById("q-video"), media, { force: true });
});

document.getElementById("q-video")?.addEventListener("pause", () => {
  const current = state?.current || null;
  const media = state?.showAnswer ? getAnswerMedia(current) || getPromptMedia(current) : getPromptMedia(current);
  emitMediaStatus(document.getElementById("q-video"), media, { force: true });
});

document.getElementById("q-video")?.addEventListener("timeupdate", () => {
  const current = state?.current || null;
  const media = state?.showAnswer ? getAnswerMedia(current) || getPromptMedia(current) : getPromptMedia(current);
  emitMediaStatus(document.getElementById("q-video"), media);
});
