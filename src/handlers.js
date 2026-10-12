import {
  getAuthStatus,
  getSettings,
  getValidAccessToken,
  login,
  logout,
  saveSettings
} from "./lib/auth.js";
import {
  askBoxAi,
  askBoxAiHub,
  getFile,
  getFolder,
  getItemMetadata,
  isAiSupportedFile,
  listFolderItems,
  listHubs,
  searchContent
} from "./lib/box-api.js";
import { boxFileUrl, buildPageContext, extractSearchQuery } from "./lib/context.js";
import { boxHubUrl, composeHubPrompt } from "./lib/hub.js";

export async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_AUTH_STATUS":
      return { ok: true, data: await getAuthStatus() };
    case "LOGIN":
      await login();
      return { ok: true, data: await getAuthStatus() };
    case "LOGOUT":
      await logout();
      return { ok: true, data: await getAuthStatus() };
    case "GET_CONTEXT":
      await clearActionBadge();
      return { ok: true, data: await getStoredContext() };
    case "CAPTURE_ACTIVE_TAB":
      return { ok: true, data: await captureActiveTab() };
    case "SET_CONTEXT":
      await chrome.storage.session.set({ context: message.context });
      return { ok: true, data: message.context };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case "SEARCH":
      return { ok: true, data: await runSearch(message.query, message.context) };
    case "ASK":
      return { ok: true, data: await runAsk(message.prompt, message.context, message.mode) };
    case "ASK_HUB":
      return { ok: true, data: await runAskHub(message.prompt, message.context) };
    case "LIST_HUBS":
      return { ok: true, data: await runListHubs() };
    case "SAVE_HUB":
      await saveSettings({ hubId: message.hubId, hubTitle: message.hubTitle });
      return { ok: true, data: await getAuthStatus() };
    case "RELATED":
      return { ok: true, data: await runRelated(message.context) };
    case "FOLDER":
      return { ok: true, data: await runFolder(message.folderId) };
    case "POPOUT_PANEL":
      await openPopoutWindow();
      return { ok: true };
    case "PAGE_CONTEXT_FROM_TAB":
      if (sender.tab) {
        await saveContext(sender.tab, message.context || {});
      }
      return { ok: true };
    default:
      return { ok: false, error: "UNKNOWN_MESSAGE" };
  }
}

export async function hydrateContext(tab, extra = {}) {
  const fromContent = await requestPageContext(tab.id);
  await saveContext(tab, {
    ...extra,
    selection: extra.selection || fromContent.selection || "",
    pageUrl: extra.pageUrl || fromContent.pageUrl || tab.url,
    pageTitle: extra.pageTitle || fromContent.pageTitle || tab.title,
    boxFolderId: extra.boxFolderId || fromContent.boxFolderId,
    boxFileId: extra.boxFileId || fromContent.boxFileId
  });
}

async function saveContext(tab, extra) {
  const context = buildPageContext(tab, extra);
  await chrome.storage.session.set({ context });
  try {
    await chrome.runtime.sendMessage({ type: "CONTEXT_UPDATED", context });
  } catch {
    // Side panel may still be loading. It will read storage on boot.
  }
  return context;
}

async function getStoredContext() {
  const { context } = await chrome.storage.session.get("context");
  return context || null;
}

async function openPopoutWindow() {
  const [sourceTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const sourceWindowId = sourceTab?.windowId;
  const { popoutWindowId } = await chrome.storage.session.get("popoutWindowId");
  if (popoutWindowId) {
    try {
      await chrome.windows.update(popoutWindowId, { focused: true });
      await closeSidePanelIfPossible(sourceWindowId);
      return;
    } catch {
      await chrome.storage.session.remove("popoutWindowId");
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("src/sidepanel/index.html?popout=1"),
    type: "popup",
    width: 420,
    height: 760,
    focused: true
  });
  if (created?.id) {
    await chrome.storage.session.set({ popoutWindowId: created.id });
  }
  await closeSidePanelIfPossible(sourceWindowId);
}

async function closeSidePanelIfPossible(windowId) {
  try {
    if (windowId == null || !chrome.sidePanel?.close) return;
    await chrome.sidePanel.close({ windowId });
  } catch {
    // Older Chrome builds cannot close the side panel programmatically.
  }
}

async function clearActionBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    // Badge is optional.
  }
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return getStoredContext();
  const fromContent = await requestPageContext(tab.id);
  const context = buildPageContext(tab, fromContent);
  await chrome.storage.session.set({ context });
  return context;
}

async function requestPageContext(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
  } catch {
    return {};
  }
}

async function requireBoxToken() {
  const settings = await getSettings();
  if (!settings.clientId || !settings.clientSecret) {
    const error = new Error("MISSING_CREDENTIALS");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }
  const token = await getValidAccessToken();
  if (!token) {
    const error = new Error("NOT_AUTHENTICATED");
    error.code = "NOT_AUTHENTICATED";
    throw error;
  }
  return token;
}

async function runSearch(query, context) {
  const q = (query || extractSearchQuery(context) || "").trim();
  if (!q) {
    return { query: "", totalCount: 0, entries: [], source: "empty" };
  }
  const token = await requireBoxToken();
  const { ancestorFolderId } = await getSettings();
  const result = await searchContent(token, q, { ancestorFolderId });
  return { query: q, ...result, source: "box" };
}

async function runRelated(context) {
  const parts = [
    context?.selection,
    context?.pageTitle,
    context?.pageUrl
  ].filter(Boolean);
  const query = extractSearchQuery(context) || parts.join(" ");
  const search = await runSearch(query, context);
  return {
    query: search.query,
    entries: search.entries.slice(0, 8),
    source: search.source
  };
}

async function runAsk(prompt, context, mode = "web") {
  const question = (prompt || "").trim();
  if (!question) {
    const error = new Error("PROMPT_REQUIRED");
    error.code = "PROMPT_REQUIRED";
    throw error;
  }

  const token = await requireBoxToken();
  if (mode === "folder" && context?.boxFolderId) {
    const special = await maybeFolderSpecialAnswer(token, question, context);
    if (special) return special;
  }
  const files = await collectContextFiles(token, context, mode);
  const composed = composeAskPrompt(question, context, mode);
  const aiFiles = files.filter(isAiSupportedFile);

  if (!aiFiles.length) {
    return {
      answer: [
        "Box AI が読める資料（PDF / Word / PowerPoint / テキストなど）が見つかりませんでした。",
        "検索キーワードを短くする、別の社名で探す、またはフォルダを指定すると精度が上がります。"
      ].join("\n"),
      citations: files,
      source: "search-empty"
    };
  }

  try {
    const ai = await askBoxAi(token, { prompt: composed, files: aiFiles });
    return {
      answer: ai.answer || ai.response || "Box AI から空の回答が返されました。",
      citations: mergeAiCitations(ai.usedFiles || aiFiles, ai.citations),
      source: "box-ai",
      createdAt: ai.created_at || null
    };
  } catch (error) {
    throw mapBoxAiError(error);
  }
}

async function runAskHub(prompt, context) {
  const question = (prompt || "").trim();
  if (!question) {
    const error = new Error("PROMPT_REQUIRED");
    error.code = "PROMPT_REQUIRED";
    throw error;
  }

  const token = await requireBoxToken();
  const { hubId, hubTitle } = await getSettings();
  if (!hubId) {
    const error = new Error("HUB_REQUIRED");
    error.code = "HUB_REQUIRED";
    throw error;
  }
  const composed = composeHubPrompt(question, context);

  try {
    const ai = await askBoxAiHub(token, { prompt: composed, hubId });
    return {
      answer: ai.answer || ai.response || "Box AI から空の回答が返されました。",
      citations: mergeAiCitations([], ai.citations),
      source: "box-ai-hub",
      hubId,
      hubTitle: hubTitle || `Hub ${hubId}`,
      hubUrl: boxHubUrl(hubId),
      createdAt: ai.created_at || null
    };
  } catch (error) {
    throw mapBoxAiError(error);
  }
}

async function runListHubs() {
  const token = await requireBoxToken();
  return listHubs(token);
}

async function maybeFolderSpecialAnswer(token, question, context) {
  const items = await listFolderItems(token, context.boxFolderId, { limit: 50 });
  const files = items.entries.filter((item) => item.type === "file");

  if (/未設定/.test(question)) {
    const missing = [];
    for (const file of files.slice(0, 20)) {
      const meta = await getItemMetadata(token, file);
      if (!meta.length) missing.push(file);
    }
    return {
      answer: missing.length
        ? `Metadataが未設定のファイルは ${missing.length} 件です。\n\n${missing.map((file) => `・${file.name}`).join("\n")}`
        : "確認した範囲では、Metadata未設定のファイルはありません。",
      citations: missing,
      source: "metadata"
    };
  }

  if (/古い/.test(question)) {
    const oldest = [...files]
      .sort((a, b) => new Date(a.modifiedAt || 0) - new Date(b.modifiedAt || 0))
      .slice(0, 5);
    return {
      answer: `更新日が古い資料です。\n\n${oldest.map((file) => `・${file.name}`).join("\n")}`,
      citations: oldest,
      source: "folder"
    };
  }

  if (/何が入っている|顧客別/.test(question) && files.length) {
    const lines = files.slice(0, 15).map((file) => `・${file.name}（${file.fileType} / ${file.path || file.folderName}）`);
    return {
      answer: `このフォルダには ${files.length} 件のファイルがあります。\n\n${lines.join("\n")}`,
      citations: files.slice(0, 8),
      source: "folder"
    };
  }

  return null;
}

async function collectContextFiles(token, context, mode) {
  const collected = [];

  if (context?.boxFileId) {
    try {
      collected.push(await getFile(token, context.boxFileId));
    } catch {
      // The current page may not be a readable Box file.
    }
  }

  if (context?.boxFolderId) {
    const items = await listFolderItems(token, context.boxFolderId, { limit: 40 });
    collected.push(...items.entries.filter((item) => item.type === "file"));
    if (mode === "folder" && collected.some(isAiSupportedFile)) {
      return prioritizeAiFiles(collected);
    }
  }

  const query = extractSearchQuery(context);
  if (query) {
    const { ancestorFolderId } = await getSettings();
    const search = await searchContent(token, query, { ancestorFolderId, limit: 12 });
    collected.push(...search.entries.filter((item) => item.type === "file"));
  }

  return prioritizeAiFiles(collected);
}

function prioritizeAiFiles(files) {
  const unique = [];
  const seen = new Set();
  for (const file of files) {
    if (!file?.id || seen.has(file.id)) continue;
    seen.add(file.id);
    unique.push(file);
  }
  const aiReady = unique.filter(isAiSupportedFile);
  return aiReady.length ? aiReady.concat(unique.filter((file) => !isAiSupportedFile(file))) : unique;
}

function composeAskPrompt(question, context, mode) {
  const lines = [
    "あなたは Box AI です。社内のBoxファイルだけを根拠に、日本語で簡潔に答えてください。",
    "根拠となるファイル名を挙げ、分からないことは推測で埋めないでください。"
  ];
  if (mode === "folder") {
    lines.push(`ユーザーはBoxフォルダ「${context?.pageTitle || context?.boxFolderId}」を見ています。`);
  } else {
    if (context?.pageTitle) lines.push(`閲覧中のWebページ: ${context.pageTitle}`);
    if (context?.pageUrl) lines.push(`URL: ${context.pageUrl}`);
    if (context?.selection) lines.push(`Webページで選択された対象: ${context.selection}`);
  }
  lines.push(`Box AI への質問: ${question}`);
  return lines.join("\n");
}

function mergeAiCitations(files, aiCitations = []) {
  const byId = new Map();
  for (const file of files || []) {
    if (!file?.id) continue;
    byId.set(String(file.id), { ...file });
  }
  for (const citation of aiCitations || []) {
    const id = String(citation.id || "");
    if (!id) continue;
    const existing = byId.get(id) || {
      id,
      type: citation.type || "file",
      name: citation.name || `file ${id}`,
      url: boxFileUrl(id),
      fileType: "ファイル"
    };
    const excerpt = String(citation.content || "").trim();
    if (excerpt) {
      existing.excerpt = existing.excerpt ? `${existing.excerpt}\n${excerpt}` : excerpt;
    }
    if (!existing.name && citation.name) existing.name = citation.name;
    byId.set(id, existing);
  }
  return [...byId.values()];
}

function mapBoxAiError(error) {
  const mapped = new Error(boxAiErrorMessage(error));
  mapped.code = boxAiErrorCode(error);
  mapped.status = error.status;
  mapped.details = error.details;
  return mapped;
}

function boxAiErrorCode(error) {
  const code = String(error?.code || "");
  const blob = `${code} ${error?.message || ""} ${JSON.stringify(error?.details || {})}`.toLowerCase();
  if (code === "NO_FILES_FOR_AI") return "NO_FILES_FOR_AI";
  if (code === "HUB_REQUIRED") return "HUB_REQUIRED";
  if (error?.status === 401 || code === "unauthorized") return "NOT_AUTHENTICATED";
  if (code === "cors_origin_not_whitelisted" || blob.includes("cors_origin_not_whitelisted")) return "AI_CORS";
  if (
    code === "insufficient_scope" ||
    blob.includes("insufficient_scope") ||
    blob.includes("ai.readwrite") ||
    code === "access_denied_insufficient_permissions"
  ) {
    return "AI_SCOPE_REQUIRED";
  }
  return code || "BOX_AI_FAILED";
}

function boxAiErrorMessage(error) {
  const code = boxAiErrorCode(error);
  const detail = boxErrorDetail(error);
  if (code === "NO_FILES_FOR_AI") {
    return "Box AI が読めるファイルが見つかりませんでした。PDF / Word / PowerPoint / テキストを含む資料で聞いてください。";
  }
  if (code === "HUB_REQUIRED") {
    return "質問する Box Hub が未設定です。Hub タブで一覧から選んで保存してください。";
  }
  if (code === "AI_SCOPE_REQUIRED") {
    return [
      "アプリの「AIを管理する」は有効でも、今のログイントークンに Box AI の権限が付いていません。",
      "いったん切断し、もう一度「Boxに接続」してください。スコープ追加後はアプリの再認可も必要です。",
      detail
    ].filter(Boolean).join(" ");
  }
  if (code === "AI_CORS") {
    return [
      "Box API が拡張機能のオリジンを拒否しています。Developer Console の CORS Domains に次を追加してください:",
      `chrome-extension://${chrome.runtime.id}`,
      detail
    ].filter(Boolean).join(" ");
  }
  if (code === "NOT_AUTHENTICATED") {
    return "Boxへの接続が切れたため、再接続してください。";
  }
  return `Box AI の呼び出しに失敗しました。${detail || error?.message || "不明なエラー"}`;
}

function boxErrorDetail(error) {
  const status = error?.status ? `HTTP ${error.status}` : "";
  const code = error?.code || "";
  const message = error?.message || error?.details?.message || "";
  const requestId = error?.details?.request_id || "";
  const parts = [status, code, message].filter(Boolean);
  if (!parts.length && !requestId) return "";
  return `（${parts.join(" / ")}${requestId ? ` / request_id: ${requestId}` : ""}）`;
}

async function runFolder(folderId) {
  if (!folderId) return { folder: null, items: [], source: "empty" };
  const token = await requireBoxToken();
  const [folder, items] = await Promise.all([
    getFolder(token, folderId),
    listFolderItems(token, folderId)
  ]);
  return { folder, items: items.entries, source: "box" };
}
