const CSV_COLUMNS = ["id", "title", "artist", "year", "note", "path", "startAt", "chorusAt"];

const state = {
  rows: [],
  currentIndex: 0,
  player: null,
  playerReady: false,
  currentVideoId: "",
  savePath: "",
  autosaveEnabled: false,
  autosaveTimer: null,
  autosaveInFlight: false,
  autosaveQueued: false
};

const dom = {
  fileInput: document.getElementById("fileInput"),
  exportButton: document.getElementById("exportButton"),
  playlistUrlInput: document.getElementById("playlistUrlInput"),
  generateButton: document.getElementById("generateButton"),
  statusText: document.getElementById("statusText"),
  savePathInput: document.getElementById("savePathInput"),
  openByPathButton: document.getElementById("openByPathButton"),
  enableAutosaveButton: document.getElementById("enableAutosaveButton"),
  saveStatusText: document.getElementById("saveStatusText"),
  prevButton: document.getElementById("prevButton"),
  nextButton: document.getElementById("nextButton"),
  emptyState: document.getElementById("emptyState"),
  editorArea: document.getElementById("editorArea"),
  counterText: document.getElementById("counterText"),
  videoTypeBadge: document.getElementById("videoTypeBadge"),
  songTitle: document.getElementById("songTitle"),
  songArtist: document.getElementById("songArtist"),
  playerFrame: document.getElementById("playerFrame"),
  playerFallback: document.getElementById("playerFallback"),
  openPathLink: document.getElementById("openPathLink"),
  playButton: document.getElementById("playButton"),
  back5Button: document.getElementById("back5Button"),
  forward5Button: document.getElementById("forward5Button"),
  previewIntroButton: document.getElementById("previewIntroButton"),
  previewChorusButton: document.getElementById("previewChorusButton"),
  setIntroButton: document.getElementById("setIntroButton"),
  setChorusButton: document.getElementById("setChorusButton"),
  timeText: document.getElementById("timeText"),
  tableWrap: document.getElementById("tableWrap"),
  renumberButton: document.getElementById("renumberButton"),
  youtubeSearchLink: document.getElementById("youtubeSearchLink"),
  wikipediaSearchLink: document.getElementById("wikipediaSearchLink"),
  openCurrentPathLink: document.getElementById("openCurrentPathLink"),
  fields: {
    id: document.getElementById("fieldId"),
    title: document.getElementById("fieldTitle"),
    artist: document.getElementById("fieldArtist"),
    year: document.getElementById("fieldYear"),
    note: document.getElementById("fieldNote"),
    path: document.getElementById("fieldPath"),
    startAt: document.getElementById("fieldStartAt"),
    chorusAt: document.getElementById("fieldChorusAt")
  }
};

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
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
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
  if (row.length > 1 || row[0] !== "") pushRow();
  return rows;
}

function escapeCsvField(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeRows(rows) {
  return rows.map((row, index) => {
    const normalized = {};
    CSV_COLUMNS.forEach((column) => {
      normalized[column] = String(row?.[column] ?? "");
    });
    if (!normalized.id) normalized.id = String(index + 1);
    return normalized;
  });
}

function rowsToCsv(rows) {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => escapeCsvField(row[column] ?? "")).join(","))
  ];
  return lines.join("\n");
}

function setSaveStatus(message, isError = false) {
  dom.saveStatusText.textContent = message || "";
  dom.saveStatusText.style.color = isError ? "#b42318" : "";
}

function syncSaveUi() {
  if (document.activeElement !== dom.savePathInput) {
    dom.savePathInput.value = state.savePath;
  }
  dom.enableAutosaveButton.textContent = state.autosaveEnabled ? "自動保存中" : "自動保存を有効化";
}

function loadCsvText(text) {
  const [header = [], ...body] = parseCsv(text);
  const columns = header.map((value) => String(value || "").trim());
  const rows = body
    .filter((cols) => cols.some((value) => String(value || "").trim() !== ""))
    .map((cols) => Object.fromEntries(columns.map((column, index) => [column, String(cols[index] ?? "").trim()])));
  state.rows = normalizeRows(rows);
  state.currentIndex = 0;
  render();
}

function currentRow() {
  return state.rows[state.currentIndex] || null;
}

function extractYoutubeVideoId(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  const shortMatch = value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  if (shortMatch) return shortMatch[1];
  const watchMatch = value.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
  if (watchMatch) return watchMatch[1];
  const embedMatch = value.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
  if (embedMatch) return embedMatch[1];
  return "";
}

function isYoutubeUrl(rawUrl) {
  return !!extractYoutubeVideoId(rawUrl);
}

function buildSearchLinks(row) {
  const query = [row.title, row.artist].filter(Boolean).join(" ");
  dom.youtubeSearchLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  dom.wikipediaSearchLink.href = `https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
  dom.openCurrentPathLink.href = row.path || "#";
  dom.openCurrentPathLink.style.pointerEvents = row.path ? "auto" : "none";
  dom.openCurrentPathLink.style.opacity = row.path ? "1" : "0.5";
}

async function saveToPath() {
  if (!state.autosaveEnabled || !state.savePath) return;
  if (state.autosaveInFlight) {
    state.autosaveQueued = true;
    return;
  }
  state.autosaveInFlight = true;
  setSaveStatus("保存中...");
  try {
    const response = await fetch("/api/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: state.savePath, rows: state.rows })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "保存に失敗しました");
    }
    setSaveStatus(`自動保存: ${payload.path}`);
  } catch (error) {
    setSaveStatus(error?.message || "保存に失敗しました", true);
  } finally {
    state.autosaveInFlight = false;
    if (state.autosaveQueued) {
      state.autosaveQueued = false;
      saveToPath();
    }
  }
}

function scheduleAutosave() {
  if (!state.autosaveEnabled || !state.savePath) return;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    saveToPath();
  }, 250);
}

function markDirty() {
  renderTable();
  renderHeader();
  scheduleAutosave();
}

function bindFieldInputs() {
  Object.entries(dom.fields).forEach(([key, input]) => {
    input.addEventListener("input", () => {
      const row = currentRow();
      if (!row) return;
      row[key] = input.value;
      if (key === "path") {
        state.currentVideoId = "";
        updatePlayerForRow(row);
      }
      markDirty();
    });
  });
}

function renderHeader() {
  const row = currentRow();
  const count = state.rows.length;
  dom.counterText.textContent = count ? `${state.currentIndex + 1} / ${count}` : "0 / 0";
  dom.songTitle.textContent = row?.title || "-";
  dom.songArtist.textContent = [row?.artist, row?.year].filter(Boolean).join(" / ");
  dom.videoTypeBadge.textContent = row ? (isYoutubeUrl(row.path) ? "YouTube" : "Direct / Local") : "-";
  if (row) {
    buildSearchLinks(row);
  }
}

function renderFields() {
  const row = currentRow();
  Object.entries(dom.fields).forEach(([key, input]) => {
    input.value = row?.[key] ?? "";
  });
}

function renderTable() {
  if (!state.rows.length) {
    dom.tableWrap.innerHTML = '<div class="emptyState">まだ行がありません。</div>';
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Title</th>
        <th>Artist</th>
        <th>Year</th>
        <th>Intro</th>
        <th>サビ</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  state.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (index === state.currentIndex) tr.classList.add("active");
    tr.innerHTML = `
      <td>${escapeHtml(row.id)}</td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.artist)}</td>
      <td>${escapeHtml(row.year)}</td>
      <td>${escapeHtml(row.startAt)}</td>
      <td>${escapeHtml(row.chorusAt)}</td>
    `;
    tr.addEventListener("click", () => {
      state.currentIndex = index;
      render();
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  dom.tableWrap.innerHTML = "";
  dom.tableWrap.appendChild(table);
}

function render() {
  const hasRows = state.rows.length > 0;
  dom.emptyState.classList.toggle("hidden", hasRows);
  dom.editorArea.classList.toggle("hidden", !hasRows);
  renderTable();
  syncSaveUi();
  if (!hasRows) {
    dom.statusText.textContent = "";
    return;
  }
  renderHeader();
  renderFields();
  updatePlayerForRow(currentRow());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ensurePlayer() {
  if (state.player || !window.YT || !window.YT.Player) return;
  state.player = new window.YT.Player("playerFrame", {
    videoId: "",
    playerVars: {
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        updatePlayerForRow(currentRow());
      }
    }
  });
}

function updatePlayerForRow(row) {
  if (!row) return;
  const videoId = extractYoutubeVideoId(row.path);
  if (!videoId) {
    dom.playerFrame.classList.add("hidden");
    dom.playerFallback.classList.remove("hidden");
    dom.openPathLink.href = row.path || "#";
    state.currentVideoId = "";
    return;
  }

  dom.playerFrame.classList.remove("hidden");
  dom.playerFallback.classList.add("hidden");
  ensurePlayer();
  if (!state.player || !state.playerReady) return;
  if (state.currentVideoId !== videoId) {
    state.currentVideoId = videoId;
    state.player.loadVideoById(videoId, Number(row.startAt) || 0);
    state.player.pauseVideo();
  }
}

function formatSec(value) {
  const num = Math.max(0, Number(value) || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function previewCue(column) {
  const row = currentRow();
  if (!row || !state.player || !state.playerReady) return;
  if (!isYoutubeUrl(row.path)) return;
  const cueSec = Math.max(0, Number(row?.[column]) || 0);
  state.player.seekTo(cueSec, true);
  state.player.playVideo();
}

function setCue(column) {
  const row = currentRow();
  if (!row || !state.player || !state.playerReady) return;
  const currentTime = Number(state.player.getCurrentTime?.() || 0);
  row[column] = formatSec(currentTime);
  renderFields();
  markDirty();
}

function seekBy(diffSec) {
  if (!state.player || !state.playerReady) return;
  const next = Math.max(0, Number(state.player.getCurrentTime?.() || 0) + diffSec);
  state.player.seekTo(next, true);
}

function togglePlay() {
  if (!state.player || !state.playerReady) return;
  const row = currentRow();
  if (!row || !isYoutubeUrl(row.path)) return;
  const stateCode = Number(state.player.getPlayerState?.());
  if (stateCode === window.YT.PlayerState.PLAYING) {
    state.player.pauseVideo();
  } else {
    state.player.playVideo();
  }
}

function exportCsv() {
  const blob = new Blob([rowsToCsv(state.rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "intro-quiz-set.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function generateFromPlaylist() {
  const url = dom.playlistUrlInput.value.trim();
  if (!url) return;
  dom.generateButton.disabled = true;
  dom.statusText.textContent = "生成中...";
  try {
    const response = await fetch(`/api/template?url=${encodeURIComponent(url)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "生成に失敗しました");
    }
    state.rows = normalizeRows(payload.rows || []);
    state.currentIndex = 0;
    dom.statusText.textContent = `${state.rows.length}件生成しました`;
    render();
    scheduleAutosave();
  } catch (error) {
    dom.statusText.textContent = error?.message || "生成に失敗しました";
  } finally {
    dom.generateButton.disabled = false;
  }
}

function renumberRows() {
  state.rows.forEach((row, index) => {
    row.id = String(index + 1);
  });
  render();
  scheduleAutosave();
}

function tickCurrentTime() {
  if (state.player && state.playerReady && state.currentVideoId) {
    dom.timeText.textContent = `${formatSec(state.player.getCurrentTime?.() || 0)} sec`;
  } else {
    dom.timeText.textContent = "0.0 sec";
  }
  window.requestAnimationFrame(tickCurrentTime);
}

async function openByPath() {
  const filePath = dom.savePathInput.value.trim();
  if (!filePath) return;
  setSaveStatus("読み込み中...");
  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "読み込みに失敗しました");
    }
    state.savePath = payload.path;
    state.autosaveEnabled = true;
    loadCsvText(payload.text || "");
    setSaveStatus(`読み込み済み: ${payload.path}`);
  } catch (error) {
    setSaveStatus(error?.message || "読み込みに失敗しました", true);
  }
}

function enableAutosave() {
  const filePath = dom.savePathInput.value.trim();
  if (!filePath) {
    setSaveStatus("保存先パスを入力してください", true);
    return;
  }
  state.savePath = filePath;
  state.autosaveEnabled = true;
  syncSaveUi();
  setSaveStatus(`自動保存先: ${state.savePath}`);
  scheduleAutosave();
}

dom.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  loadCsvText(text);
  dom.statusText.textContent = `${file.name} を読み込みました`;
  setSaveStatus("自動保存するには保存先パスを設定してください");
});

dom.exportButton.addEventListener("click", exportCsv);
dom.generateButton.addEventListener("click", generateFromPlaylist);
dom.openByPathButton.addEventListener("click", openByPath);
dom.enableAutosaveButton.addEventListener("click", enableAutosave);
dom.prevButton.addEventListener("click", () => {
  if (!state.rows.length) return;
  state.currentIndex = Math.max(0, state.currentIndex - 1);
  render();
});
dom.nextButton.addEventListener("click", () => {
  if (!state.rows.length) return;
  state.currentIndex = Math.min(state.rows.length - 1, state.currentIndex + 1);
  render();
});
dom.playButton.addEventListener("click", togglePlay);
dom.back5Button.addEventListener("click", () => seekBy(-5));
dom.forward5Button.addEventListener("click", () => seekBy(5));
dom.previewIntroButton.addEventListener("click", () => previewCue("startAt"));
dom.previewChorusButton.addEventListener("click", () => previewCue("chorusAt"));
dom.setIntroButton.addEventListener("click", () => setCue("startAt"));
dom.setChorusButton.addEventListener("click", () => setCue("chorusAt"));
dom.renumberButton.addEventListener("click", renumberRows);
dom.savePathInput.addEventListener("input", () => {
  state.savePath = dom.savePathInput.value.trim();
  if (state.autosaveEnabled) syncSaveUi();
});

bindFieldInputs();
tickCurrentTime();
renderTable();
syncSaveUi();

window.onYouTubeIframeAPIReady = () => {
  ensurePlayer();
  render();
};
