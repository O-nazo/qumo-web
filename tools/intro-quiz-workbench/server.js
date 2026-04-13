const express = require("express");
const fs = require("fs");
const path = require("path");

const HTTP_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "accept-language": "ja,en-US;q=0.9,en;q=0.8"
};

const app = express();
const port = Number(process.env.INTRO_WORKBENCH_PORT || 4315);
const publicDir = path.join(__dirname, "public");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function escapeCsvField(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows) {
  const columns = ["id", "title", "artist", "year", "note", "path", "startAt", "chorusAt"];
  return [
    columns.join(","),
    ...(Array.isArray(rows) ? rows : []).map((row) =>
      columns.map((column) => escapeCsvField(row?.[column] ?? "")).join(",")
    )
  ].join("\n");
}

function textFromRuns(node) {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) {
    return node.runs.map((run) => String(run?.text || "")).join("").trim();
  }
  return "";
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
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
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

function extractYear(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanupWrappedTitle(value) {
  const text = normalizeSpace(value);
  const matches = [...text.matchAll(/[「『](.+?)[」』]/g)];
  if (!matches.length) return text;
  const candidate = normalizeSpace(matches[0][1]);
  return candidate || text;
}

function cleanupSongTitle(value) {
  let text = normalizeSpace(value)
    .replace(/\s*\([^)]*(official\s*)?(music\s*video|mv)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*(official\s*)?(music\s*video|mv)[^\]]*\]/gi, " ")
    .replace(/\s*[-|｜:：]\s*(official\s*)?(music\s*video|mv)\b/gi, " ")
    .replace(/\b(official\s+music\s+video|music\s+video|official\s+mv|mv)\b/gi, " ");

  text = cleanupWrappedTitle(text)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();

  return normalizeSpace(text);
}

function cleanupArtistName(value) {
  let text = normalizeSpace(value)
    .replace(/\s*[-|｜]\s*topic\b/gi, " ")
    .replace(/\bofficial\s+youtube\s+channel\b/gi, " ")
    .replace(/\bofficial\s+channel\b/gi, " ")
    .replace(/\btopic\b/gi, " ")
    .replace(/\bchannel\b$/gi, " ");

  text = text
    .replace(/[・•|｜].*$/, " ")
    .replace(/\s*\([^)]*official[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*official[^\]]*\]/gi, " ");

  return normalizeSpace(text);
}

function normalizeGeneratedMeta(meta = {}, fallback = {}) {
  const rawTitle = meta.title || fallback.title || "";
  const rawArtist = meta.artist || fallback.artist || "";
  const title = cleanupSongTitle(rawTitle) || normalizeSpace(rawTitle);
  const artist = cleanupArtistName(rawArtist) || normalizeSpace(rawArtist);
  return {
    ...meta,
    title,
    artist
  };
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
  const year = extractYear(textCandidates.join(" | ")) || "";

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

  return normalizeGeneratedMeta({
    playableInEmbed: youtubeMeta.playableInEmbed,
    title: musicMeta?.title || youtubeMeta.title,
    artist: musicMeta?.artist || youtubeMeta.artist,
    year: musicMeta?.year || youtubeMeta.year || "",
    path: youtubeMeta.path
  }, {
    title: youtubeMeta.title,
    artist: youtubeMeta.artist
  });
}

app.get("/api/template", async (req, res) => {
  const sourceUrl = String(req.query.url || "").trim();
  if (!sourceUrl) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const playlistUrl = normalizePlaylistUrl(sourceUrl);
  if (!playlistUrl) {
    res.status(400).json({ error: "playlist url is invalid" });
    return;
  }

  const preferMusicMeta = isYoutubeMusicUrl(sourceUrl);

  try {
    const entries = await fetchPlaylistEntries(playlistUrl);
    const rows = [];
    let nextId = 1;

    for (const entry of entries) {
      try {
        const meta = await fetchVideoMeta(entry.videoId, { preferMusicMeta });
        if (!meta.playableInEmbed) continue;
        const normalizedMeta = normalizeGeneratedMeta(meta, entry);
        rows.push({
          id: String(nextId),
          title: normalizedMeta.title || "",
          artist: normalizedMeta.artist || "",
          year: preferMusicMeta ? (normalizedMeta.year || "") : "",
          note: "",
          path: normalizedMeta.path,
          startAt: "",
          chorusAt: ""
        });
        nextId += 1;
      } catch (error) {
        console.warn("[intro-quiz-workbench] skipped video", entry?.videoId, error);
      }
    }

    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: error?.message || "failed to generate template" });
  }
});

app.get("/api/file", (req, res) => {
  const rawPath = String(req.query.path || "").trim();
  if (!rawPath) {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const filePath = path.resolve(rawPath);
  try {
    const text = fs.readFileSync(filePath, "utf8");
    res.json({ path: filePath, text });
  } catch (error) {
    res.status(500).json({ error: error?.message || "failed to read file" });
  }
});

app.post("/api/file", (req, res) => {
  const rawPath = String(req.body?.path || "").trim();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rawPath) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  if (!rows) {
    res.status(400).json({ error: "rows are required" });
    return;
  }

  const filePath = path.resolve(rawPath);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rowsToCsv(rows), "utf8");
    res.json({ ok: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error?.message || "failed to write file" });
  }
});

app.get("/api/ping", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Intro Quiz Workbench: http://localhost:${port}`);
});



