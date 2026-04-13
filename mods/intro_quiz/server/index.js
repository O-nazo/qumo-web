const express = require("express");
const fs = require("fs");
const path = require("path");

const modId = "intro_quiz";
const SUPPORTED_SET_EXTENSIONS = new Set([".csv"]);
const MEDIA_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);
const HTTP_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "accept-language": "ja,en-US;q=0.9,en;q=0.8"
};
function registerIntroQuiz(ctx) {
  const assetsDir = path.join(__dirname, "../assets");
  const setsDir = path.join(assetsDir, "sets");
  const base = `/mods/${modId}/assets`;

  ctx.app.use(base, express.static(assetsDir));

  const state = {
    sets: [],
    setId: null,
    questions: [],
    qIndex: 0,
    selectedQIndex: 0,
    phase: "IDLE",
    showAnswer: false,
    respondentName: "",
    overlay: {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    },
    playbackCommandNonce: 0,
    playbackCommandAction: "stop",
    playbackCommandCueSec: 0,
    playbackCommandAutoStop: false,
    playbackCommandFadeOut: true,
    volumeCommandNonce: 0,
    volumeCommandValue: 100,
    playbackStatus: {
      provider: "none",
      paused: true,
      currentTime: 0,
      duration: 0,
      ready: false,
        limitedControl: false,
        volume: 100
    }
  };

  let rootWatcher = null;
  let refreshTimer = null;
  let lastSfxNonce = 0;

  function emitState() {
    ctx.broadcast({
      type: "MOD_EVENT",
      modId,
      event: {
        type: "STATE",
        state: {
          ...state,
          current: typeof state.qIndex === "number" ? (state.questions[state.qIndex] || null) : null,
          selected: typeof state.selectedQIndex === "number" ? (state.questions[state.selectedQIndex] || null) : null
        }
      }
    });
  }

  function normalizeSetId(value) {
    return String(value || "").trim();
  }

  function clampNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function detectMediaKindFromPath(value) {
    const ext = path.extname(String(value || "")).toLowerCase();
    return MEDIA_VIDEO_EXTENSIONS.has(ext) ? "video" : "audio";
  }

  function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;

    function pushField() {
      row.push(field);
      field = "";
    }

    function pushRow() {
      if (row.length === 1 && row[0] === "" && rows.length === 0) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    }

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === "\"") {
          if (text[i + 1] === "\"") {
            field += "\"";
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === "\"") {
        inQuotes = true;
        continue;
      }

      if (ch === ",") {
        pushField();
        continue;
      }

      if (ch === "\n") {
        pushField();
        pushRow();
        continue;
      }

      if (ch !== "\r") {
        field += ch;
      }
    }

    pushField();
    if (row.length > 1 || row[0] !== "") {
      pushRow();
    }

    return rows;
  }

  function escapeCsvField(value) {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  function extractPlaylistId(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      return String(url.searchParams.get("list") || "").trim();
    } catch {
      return "";
    }
  }

  function isYoutubeMusicUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      return /^music\.youtube\.com$/i.test(url.hostname);
    } catch {
      return false;
    }
  }

  function normalizePlaylistUrl(rawUrl) {
    const playlistId = extractPlaylistId(rawUrl);
    if (!playlistId) return "";
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=ja`;
  }

  function extractJsonBlock(text, marker) {
    const start = text.indexOf(marker);
    if (start < 0) return null;
    let i = start + marker.length;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const open = text[i];
    const close = open === "{" ? "}" : open === "[" ? "]" : "";
    if (!close) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    const begin = i;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === open) {
        depth += 1;
      } else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(begin, i + 1);
        }
      }
    }
    return null;
  }

  function textFromRuns(node) {
    if (!node) return "";
    if (typeof node.simpleText === "string") return node.simpleText;
    if (Array.isArray(node.runs)) {
      return node.runs.map((run) => String(run?.text || "")).join("").trim();
    }
    return "";
  }

  function collectPlaylistEntries(node, bucket = []) {
    if (!node || typeof node !== "object") return bucket;
    if (Array.isArray(node)) {
      node.forEach((child) => collectPlaylistEntries(child, bucket));
      return bucket;
    }

    const playlistVideo = node.playlistVideoRenderer;
    if (playlistVideo?.videoId) {
      bucket.push({
        videoId: String(playlistVideo.videoId),
        title: textFromRuns(playlistVideo.title),
        artist: textFromRuns(playlistVideo.shortBylineText)
      });
    }

    const musicItem = node.musicResponsiveListItemRenderer;
    const musicVideoId =
      musicItem?.playlistItemData?.videoId ||
      musicItem?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
      musicItem?.navigationEndpoint?.watchEndpoint?.videoId;
    if (musicVideoId) {
      const columns = Array.isArray(musicItem.flexColumns) ? musicItem.flexColumns : [];
      const title = textFromRuns(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
      const artist = textFromRuns(columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
      bucket.push({
        videoId: String(musicVideoId),
        title,
        artist
      });
    }

    Object.values(node).forEach((child) => collectPlaylistEntries(child, bucket));
    return bucket;
  }

  function findRenderer(node, rendererKey) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findRenderer(child, rendererKey);
        if (found) return found;
      }
      return null;
    }
    if (node[rendererKey]) return node[rendererKey];
    for (const child of Object.values(node)) {
      const found = findRenderer(child, rendererKey);
      if (found) return found;
    }
    return null;
  }

  function extractYear(value) {
    const match = String(value || "").match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : "";
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[ \t]+$/g, "")
      .replace(/^[ \t]+/g, "")
      .trim();
  }

  function cleanupArtist(value) {
    let text = normalizeWhitespace(value);
    const patterns = [
      /\s*-\s*Topic\b/gi,
      /\bOfficial YouTube Channel\b/gi,
      /\bOfficial Channel\b/gi,
      /\b公式チャンネル\b/gi,
      /\bVEVO\b/gi
    ];
    patterns.forEach((pattern) => {
      text = text.replace(pattern, "");
    });
    return normalizeWhitespace(text.replace(/\s{2,}/g, " "));
  }

  function extractQuotedJapaneseTitle(value) {
    const text = String(value || "");
    const match = text.match(/[「『]([^」』]{2,})[」』]/);
    return match ? normalizeWhitespace(match[1]) : "";
  }

  function cleanupTitle(value) {
    let text = normalizeWhitespace(value);
    const quoted = extractQuotedJapaneseTitle(text);
    if (quoted) {
      return quoted;
    }

    const patterns = [
      /\bOfficial Music Video\b/gi,
      /\bMusic Video\b/gi,
      /\bOfficial Video\b/gi,
      /\bOfficial MV\b/gi,
      /\bMV\b/gi,
      /\bLyric Video\b/gi,
      /\bVisualizer\b/gi
    ];
    patterns.forEach((pattern) => {
      text = text.replace(pattern, "");
    });

    text = text
      .replace(/\[[^\]]*(official|music video|mv|lyric|video)[^\]]*\]/gi, "")
      .replace(/\([^\)]*(official|music video|mv|lyric|video)[^\)]*\)/gi, "")
      .replace(/【[^】]*(official|music video|mv|lyric|video)[^】]*】/gi, "")
      .replace(/[|｜].*$/, "")
      .replace(/\s+-\s+.*$/, "");

    return normalizeWhitespace(text);
  }

  function collectTextCandidates(node) {
    const values = [];
    if (!node || typeof node !== "object") return values;
    if (Array.isArray(node)) {
      node.forEach((child) => values.push(...collectTextCandidates(child)));
      return values;
    }
    const directText = textFromRuns(node);
    if (directText) values.push(directText);
    Object.values(node).forEach((child) => {
      values.push(...collectTextCandidates(child));
    });
    return values;
  }

  async function fetchText(url) {
    if (typeof fetch !== "function") {
      throw new Error("fetch is not available in this runtime");
    }
    const response = await fetch(url, { headers: HTTP_HEADERS });
    if (!response.ok) {
      throw new Error(`request failed: ${response.status}`);
    }
    return response.text();
  }

  async function fetchPlaylistEntries(playlistUrl) {
    const html = await fetchText(playlistUrl);
    const jsonBlock =
      extractJsonBlock(html, "var ytInitialData = ") ||
      extractJsonBlock(html, "window[\"ytInitialData\"] = ") ||
      extractJsonBlock(html, "ytInitialData = ");
    if (!jsonBlock) {
      throw new Error("playlist data not found");
    }

    const data = JSON.parse(jsonBlock);
    const rawEntries = collectPlaylistEntries(data, []);
    const seen = new Set();
    return rawEntries.filter((entry) => {
      const key = String(entry?.videoId || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function fetchYoutubeWatchMeta(videoId) {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=ja`;
    const html = await fetchText(url);
    const playerJson =
      extractJsonBlock(html, "var ytInitialPlayerResponse = ") ||
      extractJsonBlock(html, "ytInitialPlayerResponse = ");
    if (!playerJson) {
      throw new Error("player response not found");
    }

    const player = JSON.parse(playerJson);
    const details = player.videoDetails || {};
    const microformat = player.microformat?.playerMicroformatRenderer || {};
    const playableInEmbed =
      player.playabilityStatus?.status === "OK" &&
      player.playabilityStatus?.playableInEmbed !== false;
    return {
      playableInEmbed,
      title: String(details.title || "").trim(),
      artist: String(details.author || microformat.ownerChannelName || "").trim(),
      year: extractYear(microformat.publishDate || ""),
      path: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    };
  }

  async function fetchYoutubeMusicWatchMeta(videoId) {
    const url = `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=ja`;
    const html = await fetchText(url);
    const initialDataJson =
      extractJsonBlock(html, "var ytInitialData = ") ||
      extractJsonBlock(html, "window[\"ytInitialData\"] = ") ||
      extractJsonBlock(html, "ytInitialData = ");
    if (!initialDataJson) {
      return null;
    }

    const data = JSON.parse(initialDataJson);
    const header =
      findRenderer(data, "musicDetailHeaderRenderer") ||
      findRenderer(data, "musicResponsiveHeaderRenderer") ||
      findRenderer(data, "musicVisualHeaderRenderer") ||
      findRenderer(data, "musicImmersiveHeaderRenderer");
    const textCandidates = collectTextCandidates(header);
    const title =
      textFromRuns(header?.title) ||
      textFromRuns(header?.headline) ||
      "";
    const artist =
      textFromRuns(header?.subtitle) ||
      textFromRuns(header?.straplineTextOne) ||
      "";
    const year =
      extractYear(textCandidates.join(" | ")) ||
      "";

    return {
      title: title.trim(),
      artist: artist.split(/[•|]/)[0]?.trim() || artist.trim(),
      year
    };
  }

  async function fetchVideoMeta(videoId, options = {}) {
    const youtubeMeta = await fetchYoutubeWatchMeta(videoId);
    let musicMeta = null;

    if (options.preferMusicMeta) {
      try {
        musicMeta = await fetchYoutubeMusicWatchMeta(videoId);
      } catch {}
    }

    return {
      playableInEmbed: youtubeMeta.playableInEmbed,
      title: cleanupTitle(musicMeta?.title || youtubeMeta.title),
      artist: cleanupArtist(musicMeta?.artist || youtubeMeta.artist),
      year: musicMeta?.year || youtubeMeta.year || "",
      path: youtubeMeta.path
    };
  }

  async function buildCsvTemplateFromPlaylist(sourceUrl) {
    const playlistUrl = normalizePlaylistUrl(sourceUrl);
    if (!playlistUrl) {
      throw new Error("playlist url is invalid");
    }
    const preferMusicMeta = isYoutubeMusicUrl(sourceUrl);

    const entries = await fetchPlaylistEntries(playlistUrl);
    const rows = [["id", "title", "artist", "year", "note", "path", "startAt", "chorusAt"]];
    let nextId = 1;
    state.csvGenerateProgress = {
      current: 0,
      total: entries.length,
      message: entries.length ? `0 / ${entries.length}` : "0 / 0"
    };
    emitState();

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      state.csvGenerateProgress = {
        current: index + 1,
        total: entries.length,
        message: `${index + 1} / ${entries.length}`
      };
      emitState();
      try {
        const meta = await fetchVideoMeta(entry.videoId, { preferMusicMeta });
        if (!meta.playableInEmbed) continue;
        rows.push([
          String(nextId),
          meta.title || entry.title || "",
          meta.artist || entry.artist || "",
          preferMusicMeta ? (meta.year || "") : "",
          "",
          meta.path
          ,
          "",
          ""
        ]);
        nextId += 1;
      } catch (error) {
        console.warn("[intro_quiz] csv generation skipped video", entry?.videoId, error);
      }
    }

    return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
  }

  function inferSourceType(rawPath) {
    const value = String(rawPath || "").trim();
    if (!value) return "local";
    if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(value)) return "youtube";
    if (/^https?:\/\//i.test(value)) {
      return detectMediaKindFromPath(value) === "video" ? "video_url" : "audio_url";
    }
    return "local";
  }

  function buildLocalAssetUrl(relativePath) {
    return `${base}/library/${String(relativePath || "")
      .split(/[\\/]+/)
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
  }

  function parseYoutubeVideoId(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const shortMatch = raw.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (shortMatch) return shortMatch[1];
    const watchMatch = raw.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    if (watchMatch) return watchMatch[1];
    const embedMatch = raw.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (embedMatch) return embedMatch[1];
    return "";
  }

  function normalizeQuestion(row, index, setMeta) {
    const rawPath = String(row?.path || "").trim();
    const type = inferSourceType(rawPath);
    const startAtSec = Math.max(0, clampNumber(row?.startAt, 0));
    const chorusAtSec = Math.max(0, clampNumber(row?.chorusAt, startAtSec));
    const stopAfterSec = 7;
    const localPath = type === "local" ? rawPath : "";
    const directUrl = type === "audio_url" || type === "video_url" ? rawPath : "";
    const videoId = type === "youtube" ? parseYoutubeVideoId(rawPath) : "";
    const mediaKind =
      type === "video_url" || type === "youtube" ? "video" :
      type === "audio_url" ? "audio" :
      detectMediaKindFromPath(rawPath);
    const title = String(row?.title || "");
    const artist = String(row?.artist || "");
    const year = String(row?.year || "").trim();
    const note = String(row?.note || "").trim();

    return {
      id: String(row?.id || `${index + 1}`),
      no: Number(row?.id || index + 1),
      title,
      artist,
      year,
      note,
      answer: artist ? `${title} / ${artist}` : title,
      notes: note,
      playlistName: setMeta.label,
      playlist: {
        provider: "",
        id: setMeta.id,
        name: setMeta.label
      },
      source: {
        type,
        mediaKind,
        startAtSec,
        chorusAtSec,
        stopAfterSec,
        path: rawPath,
        url: directUrl,
        videoId,
        resolvedUrl:
          type === "local" ? buildLocalAssetUrl(localPath) :
          type === "audio_url" || type === "video_url" ? directUrl :
          "",
        limitedControl: false,
        providerLabel:
          type === "local" ? "Local" :
          type === "audio_url" ? "Audio URL" :
          type === "video_url" ? "Video URL" :
          type === "youtube" ? "YouTube" :
          type
      }
    };
  }

  function listSetFiles() {
    if (!fs.existsSync(setsDir)) return [];
    return fs.readdirSync(setsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .filter((entry) => SUPPORTED_SET_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(setsDir, entry.name));
  }

  function readSetFile(filePath) {
    const csvText = fs.readFileSync(filePath, "utf-8");
    const rows = parseCsv(csvText);
    const [header = [], ...body] = rows;
    const columns = header.map((column) => String(column || "").trim());
    const setId = normalizeSetId(path.basename(filePath, path.extname(filePath)));
    const setMeta = {
      id: setId,
      label: setId
    };
    const questions = body
      .filter((cols) => cols.some((value) => String(value || "").trim() !== ""))
      .map((cols) => Object.fromEntries(columns.map((key, idx) => [key, String(cols[idx] ?? "").trim()])))
      .map((row, index) => normalizeQuestion(row, index, setMeta));

    return {
      id: setId,
      label: setMeta.label,
      playlist: {
        provider: "",
        id: setMeta.id,
        name: setMeta.label
      },
      questions
    };
  }

  function selectQuestion(index) {
    if (!Array.isArray(state.questions) || !state.questions.length) {
      state.qIndex = null;
      state.selectedQIndex = null;
      return;
    }
    const next = Math.max(0, Math.min(Number(index) || 0, state.questions.length - 1));
    state.qIndex = next;
    state.selectedQIndex = next;
  }

  function stopPlayback(options = {}) {
    state.playbackCommandNonce += 1;
    state.playbackCommandAction = "stop";
    state.playbackCommandCueSec = 0;
    state.playbackCommandAutoStop = false;
    state.playbackCommandFadeOut = options.fadeOut !== false;
    state.playbackStatus = {
      ...state.playbackStatus,
      paused: true
    };
  }

  function queuePlayback(action, cueSec, options = {}) {
    state.playbackCommandNonce += 1;
    state.playbackCommandAction = action;
    state.playbackCommandCueSec = Math.max(0, clampNumber(cueSec, 0));
    state.playbackCommandAutoStop = options.autoStop === true;
    state.playbackCommandFadeOut = options.fadeOut !== false;
  }

  function loadSet(setId) {
    const target = state.sets.find((set) => set.id === setId) || null;
    state.setId = target?.id || null;
    state.questions = target?.questions || [];
    state.phase = "IDLE";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    selectQuestion(0);
    stopPlayback();
  }

  function refreshSets({ preserveSelection = true } = {}) {
    const previousSetId = preserveSelection ? state.setId : null;
    const previousQuestionId =
      preserveSelection && typeof state.selectedQIndex === "number"
        ? state.questions[state.selectedQIndex]?.id || null
        : null;

    state.sets = listSetFiles()
      .map((filePath) => {
        try {
          return readSetFile(filePath);
        } catch (error) {
          console.error("[intro_quiz] failed to read set:", filePath, error);
          return null;
        }
      })
      .filter(Boolean);

    const nextSetId =
      state.sets.some((set) => set.id === previousSetId)
        ? previousSetId
        : (state.sets[0]?.id || null);

    loadSet(nextSetId);

    if (previousQuestionId) {
      const index = state.questions.findIndex((question) => question.id === previousQuestionId);
      if (index >= 0) selectQuestion(index);
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshSets({ preserveSelection: true });
      emitState();
    }, 120);
  }

  function watchSets() {
    if (rootWatcher) {
      try {
        rootWatcher.close();
      } catch {}
      rootWatcher = null;
    }
    if (!fs.existsSync(setsDir)) return;
    try {
      rootWatcher = fs.watch(setsDir, { persistent: false }, scheduleRefresh);
    } catch (error) {
      console.warn("[intro_quiz] watch failed:", error);
    }
  }

  function beginQuestion(cueKey) {
    const current = typeof state.qIndex === "number" ? state.questions[state.qIndex] : null;
    if (!current) return;
    const source = current.source || {};
    const cueSec = cueKey === "chorus" ? source.chorusAtSec : source.startAtSec;
    state.phase = "PLAYING";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    queuePlayback("play", cueSec, { autoStop: false });
    emitState();
  }

  function updateQuestionCues(qIndex, nextValues = {}) {
    if (!Array.isArray(state.questions) || !state.questions.length) return false;
    const index = Math.max(0, Math.min(Number(qIndex) || 0, state.questions.length - 1));
    const current = state.questions[index];
    if (!current?.source) return false;

    const prevStart = Math.max(0, clampNumber(current.source.startAtSec, 0));
    const prevChorus = Math.max(0, clampNumber(current.source.chorusAtSec, prevStart));
    const hasStart = nextValues.startAtSec !== undefined;
    const hasChorus = nextValues.chorusAtSec !== undefined;
    const startAtSec = hasStart ? Math.max(0, clampNumber(nextValues.startAtSec, prevStart)) : prevStart;
    const chorusAtSec = hasChorus ? Math.max(0, clampNumber(nextValues.chorusAtSec, hasStart ? startAtSec : prevChorus)) : prevChorus;

    current.source = {
      ...current.source,
      startAtSec,
      chorusAtSec
    };
    return true;
  }

  refreshSets({ preserveSelection: false });
  watchSets();
  emitState();

  ctx.on("CLIENT_CONNECTED", emitState);
  ctx.on("MOD_ACTIVATED", emitState);
  ctx.on("IQ_SYNC_STATE", emitState);

  ctx.on("IQ_SELECT_SET", (cmd) => {
    const setId = normalizeSetId(cmd?.setId);
    if (!setId || !state.sets.some((set) => set.id === setId)) return;
    loadSet(setId);
    emitState();
  });

  ctx.on("IQ_SELECT_Q", (cmd) => {
    const qIndex = Number(cmd?.qIndex);
    if (!Number.isFinite(qIndex)) return;
    selectQuestion(qIndex);
    state.phase = "IDLE";
    state.showAnswer = false;
    stopPlayback();
    emitState();
  });

  ctx.on("IQ_SET_CUES", (cmd) => {
    const qIndex = Number(cmd?.qIndex);
    if (!Number.isFinite(qIndex)) return;
    const changed = updateQuestionCues(qIndex, {
      startAtSec: cmd?.startAtSec,
      chorusAtSec: cmd?.chorusAtSec
    });
    if (!changed) return;
    emitState();
  });

  ctx.on("IQ_SET_VOLUME", (cmd) => {
    const current = typeof state.qIndex === "number" ? state.questions[state.qIndex] : null;
    if (!current || current.source?.type !== "youtube") return;
    const volume = Math.max(0, Math.min(100, Math.round(clampNumber(cmd?.volume, 100))));
    state.volumeCommandNonce += 1;
    state.volumeCommandValue = volume;
    state.playbackStatus = {
      ...state.playbackStatus,
      volume
    };
    emitState();
  });

  ctx.on("IQ_PRESENT", () => {
    selectQuestion(state.selectedQIndex || 0);
    state.phase = "IDLE";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    stopPlayback();
    emitState();
  });

  ctx.on("IQ_RESET", () => {
    state.phase = "IDLE";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    stopPlayback();
    emitState();
  });

  ctx.on("IQ_PLAY", () => beginQuestion("intro"));
  ctx.on("IQ_PLAY_CHORUS", () => beginQuestion("chorus"));

  ctx.on("IQ_STOP", () => {
    state.phase = state.showAnswer ? "ANSWER" : "STOPPED";
    stopPlayback();
    emitState();
  });

  ctx.on("IQ_HARD_STOP", () => {
    state.phase = state.showAnswer ? "ANSWER" : "STOPPED";
    stopPlayback({ fadeOut: false });
    emitState();
  });

  ctx.on("IQ_REWIND", () => {
    const current = typeof state.qIndex === "number" ? state.questions[state.qIndex] : null;
    if (!current) return;
    state.phase = "STOPPED";
    queuePlayback("rewind", current.source?.startAtSec || 0, { autoStop: false });
    emitState();
  });

  ctx.on("IQ_TOGGLE_ANSWER", () => {
    state.showAnswer = !state.showAnswer;
    state.phase = state.showAnswer ? "ANSWER" : "STOPPED";
    if (state.showAnswer) {
      const current = typeof state.qIndex === "number" ? state.questions[state.qIndex] : null;
      queuePlayback("play", current?.source?.chorusAtSec || 0, { autoStop: false });
    } else {
      stopPlayback();
    }
    emitState();
  });

  ctx.on("IQ_NEXT", () => {
    if (!state.questions.length) return;
    selectQuestion(Math.min((state.qIndex || 0) + 1, state.questions.length - 1));
    state.phase = "IDLE";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    stopPlayback();
    emitState();
  });

  ctx.on("IQ_PREV", () => {
    if (!state.questions.length) return;
    selectQuestion(Math.max((state.qIndex || 0) - 1, 0));
    state.phase = "IDLE";
    state.showAnswer = false;
    state.respondentName = "";
    state.overlay = {
      mode: "idle",
      primaryText: "",
      secondaryText: "",
      thinkingEndsAt: null
    };
    stopPlayback();
    emitState();
  });

  ctx.on("BUZZ", (ev) => {
    if (state.showAnswer) return;
    if (state.phase !== "PLAYING" && state.phase !== "STOPPED" && state.phase !== "BUZZED") return;
    const root = ctx.getState() || {};
    const playerName = String(root.players?.[ev?.playerId]?.name || ev?.playerId || "");
    state.phase = "BUZZED";
    state.respondentName = playerName;
    state.overlay = {
      mode: "idle",
      primaryText: "Answer>>",
      secondaryText: playerName,
      thinkingEndsAt: null
    };
    stopPlayback();
    emitState();
  });

  function handleJudge(phase) {
    state.phase = phase;
    if (phase === "ANSWER") {
      state.showAnswer = true;
      state.overlay = {
        mode: "idle",
        primaryText: "",
        secondaryText: "",
        thinkingEndsAt: null
      };
      const current = typeof state.qIndex === "number" ? state.questions[state.qIndex] : null;
      queuePlayback("play", current?.source?.chorusAtSec || 0, { autoStop: false });
    } else {
      state.showAnswer = false;
      state.respondentName = "";
      state.overlay = {
        mode: phase === "STOPPED" ? "wrong" : "idle",
        primaryText: phase === "STOPPED" ? "✕" : "",
        secondaryText: "",
        thinkingEndsAt: null
      };
      stopPlayback();
    }
    emitState();
  }

  ctx.on("JUDGE_CORRECT", () => handleJudge("ANSWER"));
  ctx.on("JUDGE_WRONG", () => handleJudge("STOPPED"));
  ctx.on("JUDGE_SKIP", () => handleJudge("ENDED"));

  ctx.on("DISPATCH", (action) => {
    if (!action || action.type !== "IQ_PLAYBACK_STATUS") return;
    state.playbackStatus = {
      provider: String(action.provider || "none"),
      paused: action.paused !== false,
      currentTime: Math.max(0, clampNumber(action.currentTime, 0)),
      duration: Math.max(0, clampNumber(action.duration, 0)),
      ready: action.ready === true,
      limitedControl: action.limitedControl === true,
      volume: Math.max(0, Math.min(100, Math.round(clampNumber(action.volume, state.playbackStatus.volume))))
    };
    emitState();
  });

  ctx.on("STATE_UPDATED", () => {
    const root = ctx.getState() || {};
    const sfx = root.sfx || {};
    const nonce = Number(sfx.nonce || 0);
    if (nonce !== lastSfxNonce) {
      lastSfxNonce = nonce;
      if (String(sfx.key || "") === "thinking") {
        const durationSec = Math.max(0, clampNumber(sfx.durationSec, clampNumber(root.rules?.thinkingSeconds, 5)));
        state.overlay = {
          mode: "thinking",
          primaryText: "",
          secondaryText: "",
          thinkingEndsAt: Date.now() + (durationSec * 1000)
        };
        emitState();
        return;
      }
    }

    if (state.overlay?.mode === "thinking" && Number(state.overlay.thinkingEndsAt || 0) <= Date.now()) {
      state.overlay = {
        mode: "idle",
        primaryText: "",
        secondaryText: "",
        thinkingEndsAt: null
      };
      emitState();
    }
  });
}

module.exports = registerIntroQuiz;
