import { ASK_PROMPTS, FOLDER_PROMPTS } from "../lib/config.js";
import { getAuthStatus, login, logout } from "../lib/auth.js";
import { HUB_CHIPS } from "../lib/hub.js";

const state = {
  auth: null,
  context: null,
  tab: "ask",
  busy: false,
  lastAutoAsk: "",
  lastAutoHub: "",
  hubs: [],
  lastSelection: ""
};

const els = {
  status: document.getElementById("status-line"),
  loginBtn: document.getElementById("login-btn"),
  optionsBtn: document.getElementById("options-btn"),
  popoutBtn: document.getElementById("popout-btn"),
  setupBanner: document.getElementById("setup-banner"),
  folderBanner: document.getElementById("folder-banner"),
  selection: document.getElementById("selection-text"),
  pageMeta: document.getElementById("page-meta"),
  askChips: document.getElementById("ask-chips"),
  askForm: document.getElementById("ask-form"),
  askInput: document.getElementById("ask-input"),
  askSubmit: document.getElementById("ask-submit"),
  askResult: document.getElementById("ask-result"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  searchResult: document.getElementById("search-result"),
  relatedResult: document.getElementById("related-result"),
  hubSelect: document.getElementById("hub-select"),
  hubRefresh: document.getElementById("hub-refresh"),
  hubSave: document.getElementById("hub-save"),
  hubStatus: document.getElementById("hub-status"),
  hubChips: document.getElementById("hub-chips"),
  hubForm: document.getElementById("hub-form"),
  hubInput: document.getElementById("hub-input"),
  hubSubmit: document.getElementById("hub-submit"),
  hubResult: document.getElementById("hub-result")
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

els.optionsBtn.addEventListener("click", (event) => {
  event.preventDefault();
  openSettings();
});
els.popoutBtn.addEventListener("click", (event) => {
  event.preventDefault();
  popOutPanel();
});
els.loginBtn.addEventListener("click", onLoginClick);
els.askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askCurrent(inferAskMode());
});
els.hubForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askHub();
});
els.hubRefresh.addEventListener("click", (event) => {
  event.preventDefault();
  loadHubList();
});
els.hubSave.addEventListener("click", (event) => {
  event.preventDefault();
  saveSelectedHub();
});
els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(els.searchInput.value);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CONTEXT_UPDATED") {
    state.context = message.context;
    renderContext();
    refreshForContext();
  }
});

document.addEventListener("click", (event) => {
  const connect = event.target.closest("[data-action='connect']");
  if (connect) {
    event.preventDefault();
    onLoginClick(event);
    return;
  }
  const reconnect = event.target.closest("[data-action='reconnect']");
  if (reconnect) {
    event.preventDefault();
    reconnectForAi(event);
    return;
  }
  const options = event.target.closest("[data-action='options']");
  if (options) {
    event.preventDefault();
    openSettings();
    return;
  }
  const link = event.target.closest("a.file-card");
  if (!link) return;
  event.preventDefault();
  chrome.tabs.create({ url: link.href });
});

init();

function openSettings() {
  chrome.runtime.openOptionsPage();
}

async function popOutPanel() {
  if (state.busy) return;
  try {
    await send({ type: "POPOUT_PANEL" });
  } catch (error) {
    showAuthOrError(els.askResult, error);
  }
}

async function init() {
  if (new URLSearchParams(location.search).get("popout") === "1") {
    document.body.classList.add("is-popout");
  }
  try {
    await refreshAuth();
    const stored = (await chrome.storage.session.get("context")).context || null;
    const isFresh = stored?.capturedAt && Date.now() - stored.capturedAt < 15000;
    if (isFresh) {
      state.context = stored;
    } else {
      const captured = await captureActiveTabLocal();
      if (stored?.selection && captured && !captured.selection) {
        captured.selection = stored.selection;
      }
      state.context = captured || stored || null;
    }
  } catch (error) {
    showAuthOrError(els.askResult, error);
  }
  renderContext();
  renderChips();
  renderHubChips();
  renderHubStatus();
  await refreshForContext();
  await loadHubList();
}

async function captureActiveTabLocal() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return null;
    let fromContent = {};
    try {
      fromContent = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
    } catch {
      fromContent = {};
    }
    const context = {
      selection: fromContent.selection || "",
      pageUrl: fromContent.pageUrl || tab.url || "",
      pageTitle: fromContent.pageTitle || tab.title || "",
      boxFolderId: fromContent.boxFolderId || null,
      boxFileId: fromContent.boxFileId || null,
      capturedAt: Date.now()
    };
    await chrome.storage.session.set({ context });
    try {
      await chrome.action.setBadgeText({ text: "" });
    } catch {
      // Badge is optional.
    }
    return context;
  } catch {
    return null;
  }
}

async function refreshAuth() {
  state.auth = await getAuthStatus();
  renderAuth();
}

function renderAuth() {
  const auth = state.auth || {};
  if (auth.authenticated) {
    els.status.textContent = auth.user?.name ? `${auth.user.name} で接続中` : "Boxに接続済み";
    els.loginBtn.textContent = "切断";
    els.setupBanner.classList.add("hidden");
    return;
  }
  els.loginBtn.textContent = "Boxに接続";
  els.setupBanner.classList.remove("hidden");
  if (!auth.configured) {
    els.status.textContent = "Box未設定";
    els.setupBanner.innerHTML = `
      <div>先に設定で Client ID / Secret を保存してください。保存後、下のボタンでBoxに接続できます。</div>
      <button type="button" class="primary-btn compact" data-action="options">設定を開く</button>
      <button type="button" class="primary-btn compact" data-action="connect">Boxに接続</button>
    `;
    return;
  }
  els.status.textContent = "Box未接続";
  els.setupBanner.innerHTML = `
    <div>Boxに接続すると、選択テキストで社内資料を検索できます。</div>
    <button type="button" class="primary-btn compact" data-action="connect">Boxに接続</button>
  `;
}

async function onLoginClick(event) {
  event?.preventDefault?.();
  if (state.busy) return;
  if (!state.auth?.configured) {
    openSettings();
    return;
  }
  setBusy(true);
  els.loginBtn.textContent = state.auth.authenticated ? "切断中…" : "接続中…";
  try {
    if (state.auth.authenticated) {
      await logout();
    } else {
      await login();
    }
    await refreshAuth();
    await refreshForContext();
    await loadHubList();
  } catch (error) {
    renderAuth();
    showAuthOrError(els.askResult, error);
  } finally {
    setBusy(false);
    renderAuth();
  }
}

async function reconnectForAi(event) {
  event?.preventDefault?.();
  if (state.busy) return;
  if (!state.auth?.configured) {
    openSettings();
    return;
  }
  setBusy(true);
  els.loginBtn.textContent = "再接続中…";
  try {
    if (state.auth.authenticated) await logout();
    await login();
    await refreshAuth();
    await refreshForContext();
    await loadHubList();
    els.askResult.innerHTML = emptyHtml("再接続しました。もう一度 Box AI に質問してください。");
  } catch (error) {
    renderAuth();
    showAuthOrError(els.askResult, error);
  } finally {
    setBusy(false);
    renderAuth();
  }
}

function renderContext() {
  const ctx = state.context;
  if (ctx?.selection) {
    els.selection.textContent = ctx.selection;
  } else {
    els.selection.textContent = "テキストを選択して右クリックすると、ここに表示されます。";
  }
  const bits = [];
  if (ctx?.pageTitle) bits.push(ctx.pageTitle);
  if (ctx?.pageUrl) bits.push(ctx.pageUrl);
  els.pageMeta.textContent = bits.join("\n");
  els.searchInput.value = ctx?.selection || "";
  syncAskInputFromSelection();
  syncHubInputFromSelection();
  renderFolderBanner();
  renderChips();
}

function renderFolderBanner() {
  const folderId = state.context?.boxFolderId;
  if (!folderId) {
    els.folderBanner.classList.add("hidden");
    els.folderBanner.innerHTML = "";
    return;
  }
  els.folderBanner.classList.remove("hidden");
  els.folderBanner.innerHTML = `
    <div class="folder-title">このフォルダについてAIに聞く</div>
    <div class="folder-path">Boxフォルダ ID: ${escapeHtml(folderId)}</div>
  `;
}

function renderChips() {
  const prompts = state.context?.boxFolderId ? [...ASK_PROMPTS, ...FOLDER_PROMPTS] : ASK_PROMPTS;
  els.askChips.innerHTML = prompts
    .map((prompt) => `<button class="chip" type="button" data-id="${prompt.id}" data-mode="${FOLDER_PROMPTS.some((item) => item.id === prompt.id) ? "folder" : "web"}">${escapeHtml(prompt.label)}</button>`)
    .join("");
  els.askChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.askInput.value = withSelection(chip.textContent);
      state.lastAutoAsk = els.askInput.value;
      askCurrent(chip.dataset.mode);
    });
  });
}

function renderHubChips() {
  els.hubChips.innerHTML = HUB_CHIPS
    .map((prompt) => `<button class="chip" type="button" data-id="${prompt.id}">${escapeHtml(prompt.label)}</button>`)
    .join("");
  els.hubChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.hubInput.value = withSelection(chip.textContent);
      state.lastAutoHub = els.hubInput.value;
      askHub();
    });
  });
}

function renderHubStatus() {
  const title = state.auth?.hubTitle;
  const id = state.auth?.hubId;
  if (id) {
    els.hubStatus.textContent = `保存済み: ${title || "Hub"}（${id}）`;
  } else {
    els.hubStatus.textContent = "まだ Hub が保存されていません。";
  }
}

function fillHubSelect() {
  const savedId = state.auth?.hubId || "";
  const options = state.hubs.length
    ? state.hubs.map((hub) => {
      const selected = hub.id === savedId ? "selected" : "";
      const ai = hub.isAiEnabled ? "" : "（AI無効）";
      return `<option value="${escapeHtml(hub.id)}" ${selected}>${escapeHtml(hub.title)}${ai}</option>`;
    })
    : [`<option value="">${state.auth?.authenticated ? "アクセスできる Hub がありません" : "ログインすると一覧を表示します"}</option>`];
  if (savedId && !state.hubs.some((hub) => hub.id === savedId)) {
    options.unshift(`<option value="${escapeHtml(savedId)}" selected>${escapeHtml(state.auth?.hubTitle || savedId)}（保存済み）</option>`);
  }
  els.hubSelect.innerHTML = options.join("");
}

async function loadHubList() {
  if (!state.auth?.authenticated) {
    state.hubs = [];
    fillHubSelect();
    renderHubStatus();
    return;
  }
  try {
    const res = await send({ type: "LIST_HUBS" });
    state.hubs = res.data?.entries || [];
    fillHubSelect();
    renderHubStatus();
  } catch (error) {
    fillHubSelect();
    showAuthOrError(els.hubResult, error);
  }
}

async function saveSelectedHub() {
  if (!ensureAuthenticated(els.hubResult)) return;
  const hubId = els.hubSelect.value.trim();
  if (!hubId) {
    els.hubStatus.textContent = "保存する Hub を選んでください。";
    return;
  }
  const selected = state.hubs.find((hub) => hub.id === hubId);
  const hubTitle = selected?.title || state.auth?.hubTitle || hubId;
  try {
    const res = await send({ type: "SAVE_HUB", hubId, hubTitle });
    state.auth = res.data;
    renderHubStatus();
    els.hubStatus.textContent = `保存しました: ${hubTitle}（${hubId}）`;
  } catch (error) {
    showAuthOrError(els.hubResult, error);
  }
}

async function refreshForContext() {
  if (!state.context) {
    els.searchResult.innerHTML = emptyHtml("Webページのテキストを選択するか、ツールバーから開いてください。");
    els.relatedResult.innerHTML = emptyHtml("ページを開いた状態で関連資料を探せます。");
    return;
  }
  if (state.context.selection || state.context.pageTitle) {
    await Promise.all([runSearch(state.context.selection || ""), runRelated()]);
  }
  if (state.context.boxFolderId) {
    await loadFolder();
  }
}

async function askCurrent(mode) {
  const prompt = withSelection(els.askInput.value.trim());
  if (prompt) els.askInput.value = prompt;
  if (!prompt) {
    els.askResult.innerHTML = emptyHtml("質問を入力するか、上の候補を選んでください。");
    return;
  }
  if (!ensureAuthenticated(els.askResult)) return;
  switchTab("ask");
  els.askResult.innerHTML = loadingHtml("Box AI が社内資料を参照して回答しています…");
  setBusy(true);
  try {
    const res = await send({
      type: "ASK",
      prompt,
      context: state.context,
      mode: mode === "folder" ? "folder" : "web"
    });
    renderAnswer(els.askResult, res.data);
  } catch (error) {
    showAuthOrError(els.askResult, error);
  } finally {
    setBusy(false);
  }
}

async function askHub() {
  const prompt = withSelection(els.hubInput.value.trim());
  if (prompt) els.hubInput.value = prompt;
  if (!prompt) {
    els.hubResult.innerHTML = emptyHtml("質問を入力するか、上の候補を選んでください。");
    return;
  }
  if (!ensureAuthenticated(els.hubResult)) return;
  if (!state.auth?.hubId) {
    els.hubResult.innerHTML = emptyHtml("先に質問する Hub を選んで保存してください。");
    switchTab("hub");
    return;
  }
  switchTab("hub");
  els.hubResult.innerHTML = loadingHtml("保存した Hub の資料を参照して回答しています…");
  setBusy(true);
  try {
    const res = await send({
      type: "ASK_HUB",
      prompt,
      context: state.context
    });
    renderAnswer(els.hubResult, res.data);
  } catch (error) {
    showAuthOrError(els.hubResult, error);
  } finally {
    setBusy(false);
  }
}

async function runSearch(query) {
  if (!ensureAuthenticated(els.searchResult)) return;
  els.searchResult.innerHTML = loadingHtml("Box内を検索しています…");
  try {
    const res = await send({
      type: "SEARCH",
      query,
      context: state.context
    });
    renderFiles(els.searchResult, res.data.entries, res.data.source, `${res.data.totalCount || 0}件`);
  } catch (error) {
    showAuthOrError(els.searchResult, error);
  }
}

async function runRelated() {
  if (!ensureAuthenticated(els.relatedResult)) return;
  els.relatedResult.innerHTML = loadingHtml("関連する社内資料を探しています…");
  try {
    const res = await send({ type: "RELATED", context: state.context });
    renderFiles(els.relatedResult, res.data.entries, res.data.source, "関連資料");
  } catch (error) {
    showAuthOrError(els.relatedResult, error);
  }
}

async function loadFolder() {
  try {
    const res = await send({ type: "FOLDER", folderId: state.context.boxFolderId });
    if (res.data?.folder) {
      els.folderBanner.innerHTML = `
        <div class="folder-title">${escapeHtml(res.data.folder.name)}</div>
        <div class="folder-path">${escapeHtml(res.data.folder.path || "")} · ${res.data.folder.itemCount || res.data.items.length}件</div>
      `;
    }
  } catch {
    // Banner already shows the folder ID.
  }
}

function renderAnswer(target, data) {
  const citations = (data.citations || []).map((item) => fileCard(item)).join("");
  const hubLink = data.hubUrl
    ? `<a class="file-card" href="${escapeHtml(data.hubUrl)}" target="_blank" rel="noreferrer">
        <div class="file-icon">📚</div>
        <div>
          <div class="file-name">${escapeHtml(data.hubTitle || "Box Hub")}</div>
          <div class="file-meta">Box Hub</div>
        </div>
      </a>`
    : "";
  target.innerHTML = `
    <article class="answer-card">
      <span class="source-tag">${sourceLabel(data.source)}</span>
      <div class="answer-text">${escapeHtml(data.answer || "")}</div>
    </article>
    ${hubLink}
    ${citations || (data.source === "box-ai-hub" ? "" : emptyHtml("引用できる関連ファイルはありません。"))}
  `;
}

function renderFiles(target, entries, source, heading) {
  if (!entries?.length) {
    target.innerHTML = emptyHtml("該当するBoxファイルは見つかりませんでした。");
    return;
  }
  target.innerHTML = `
    <div class="source-tag">${escapeHtml(heading)} · ${sourceLabel(source)}</div>
    ${entries.map(fileCard).join("")}
  `;
}

function fileCard(item) {
  const excerpt = (item.excerpt || "").trim();
  return `
    <a class="file-card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
      <div class="file-icon">${iconFor(item)}</div>
      <div>
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-meta">
          ${escapeHtml(item.fileType || item.type)}
          ${item.modifiedAt ? ` · ${escapeHtml(formatDate(item.modifiedAt))}` : ""}
          ${item.path ? `<br>${escapeHtml(item.path)}` : ""}
        </div>
        ${excerpt ? `<div class="file-excerpt">${escapeHtml(excerpt)}</div>` : ""}
      </div>
    </a>
  `;
}

function selectionPrefix(selection) {
  const text = (selection || "").trim();
  return text ? `「${text}」について、` : "";
}

function withSelection(question) {
  const selection = (state.context?.selection || "").trim();
  const q = (question || "").trim();
  if (!selection) return q;
  if (q.includes(selection)) return q;
  return `${selectionPrefix(selection)}${q}`;
}

function syncAskInputFromSelection() {
  const selection = (state.context?.selection || "").trim();
  const prefix = selectionPrefix(selection);
  const current = els.askInput.value;
  const previousPrefix = selectionPrefix(state.lastSelection);
  const canReplace = !current.trim() || current === state.lastAutoAsk || current === previousPrefix;
  if (selection && canReplace) {
    els.askInput.value = prefix;
    state.lastAutoAsk = prefix;
  }
  state.lastSelection = selection;
  els.askInput.placeholder = selection
    ? `${prefix}社内資料から教えて`
    : "選択した内容について、Box AI に質問する";
}

function syncHubInputFromSelection() {
  const selection = (state.context?.selection || "").trim();
  const prefix = selectionPrefix(selection);
  const current = els.hubInput.value;
  const previousPrefix = selectionPrefix(state.lastSelection);
  const canReplace = !current.trim() || current === state.lastAutoHub || current === previousPrefix;
  if (selection && canReplace) {
    els.hubInput.value = prefix;
    state.lastAutoHub = prefix;
  }
  els.hubInput.placeholder = selection
    ? `${prefix}Hubの資料から教えて`
    : "保存した Hub に聞きたいことを入力";
}

function inferAskMode() {
  const text = els.askInput.value.trim();
  if (state.context?.boxFolderId && FOLDER_PROMPTS.some((prompt) => text.includes(prompt.label) || text.includes("このフォルダ") || text.includes("Metadata"))) {
    return "folder";
  }
  return "web";
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.tab === tab);
  });
  document.querySelectorAll(".panel").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.panel === tab);
  });
  if (tab === "hub") {
    loadHubList();
  }
}

function setBusy(busy) {
  state.busy = busy;
  els.loginBtn.disabled = busy;
  els.askSubmit.disabled = busy;
  els.hubSubmit.disabled = busy;
}

function loadingHtml(text) {
  return `<div class="loading">${escapeHtml(text)}</div>`;
}

function emptyHtml(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function showAuthOrError(target, error) {
  if (isAuthError(error)) {
    target.innerHTML = authRequiredHtml(error);
    return;
  }
  if (error?.code === "AI_SCOPE_REQUIRED" || error?.code === "AI_CORS") {
    target.innerHTML = `
      <div class="error">
        ${escapeHtml(toUserError(error))}
        <br>
        <button type="button" class="primary-btn compact" data-action="reconnect">切断して再接続</button>
      </div>
    `;
    return;
  }
  showError(target, toUserError(error));
}

function showError(target, text) {
  target.innerHTML = `<div class="error">${escapeHtml(text)}</div>`;
}

function isAuthError(error) {
  return error?.code === "MISSING_CREDENTIALS" || error?.code === "NOT_AUTHENTICATED";
}

function authRequiredHtml(error) {
  const needsSettings = error?.code === "MISSING_CREDENTIALS" || !state.auth?.configured;
  const selection = (state.context?.selection || "").trim();
  const subject = selection ? `「${escapeHtml(selection)}」` : "選択した内容";
  if (needsSettings) {
    return `
      <div class="empty">
        ${subject} で社内のBoxを探すには、先にアプリ設定が必要です。<br>
        <button type="button" class="primary-btn compact" data-action="options">設定を開く</button>
      </div>
    `;
  }
  return `
    <div class="empty">
      ${subject} で社内のBoxを探すには、ログインしてください。<br>
      <button type="button" class="primary-btn compact" data-action="connect">Boxに接続</button>
    </div>
  `;
}

function sourceLabel(source) {
  const map = {
    "box-ai": "Box AI",
    "box-ai-hub": "Box AI for Hubs",
    box: "Box Search",
    demo: "デモデータ",
    "search-fallback": "検索フォールバック",
    "search-empty": "検索結果なし",
    folder: "フォルダ",
    metadata: "Metadata"
  };
  return map[source] || source || "Box Assistant";
}

function iconFor(item) {
  if (item.type === "folder") return "📁";
  const ext = item.extension || "";
  if (["pptx", "ppt"].includes(ext)) return "📊";
  if (ext === "pdf") return "📄";
  if (["docx", "doc"].includes(ext)) return "📝";
  if (["xlsx", "xls", "csv"].includes(ext)) return "📈";
  return "📄";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureAuthenticated(target) {
  if (state.auth?.authenticated) return true;
  const code = state.auth?.configured ? "NOT_AUTHENTICATED" : "MISSING_CREDENTIALS";
  target.innerHTML = authRequiredHtml({ code });
  return false;
}

function toUserError(error) {
  const code = error?.code || "";
  const message = error?.error || error?.message || "";
  if (code === "MISSING_CREDENTIALS") return "先に設定画面で Client ID と Client Secret を保存してください。";
  if (code === "NOT_AUTHENTICATED") return "Boxに接続すると、選択テキストで社内資料を検索できます。";
  if (code === "AUTH_CANCELLED") return "Boxへのログインがキャンセルされました。";
  if (code === "PROMPT_REQUIRED") return "質問を入力してください。";
  if (code === "HUB_REQUIRED") return "質問する Box Hub が未設定です。Hub タブで選んで保存してください。";
  if (code === "AI_SCOPE_REQUIRED") {
    return message || "今のログイントークンに Box AI の権限がありません。いったん切断して再接続してください。";
  }
  if (code === "AI_CORS") {
    return message || `Developer Console の CORS Domains に chrome-extension://${chrome.runtime.id} を追加してください。`;
  }
  if (code === "NO_FILES_FOR_AI" || code === "BOX_AI_FAILED") {
    return message || "Box AI の呼び出しに失敗しました。";
  }
  if (/only one web auth flow/i.test(message)) {
    return "ログイン画面がすでに開いています。そのウィンドウで操作を続けるか、閉じてからもう一度「Boxに接続」を押してください。";
  }
  return message || "処理に失敗しました。";
}

async function send(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    const error = new Error(response?.error || "REQUEST_FAILED");
    error.code = response?.code;
    throw error;
  }
  return response;
}
