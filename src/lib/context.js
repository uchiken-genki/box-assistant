const BOX_FOLDER_RE = /\/folder\/(\d+)/;
const BOX_FILE_RE = /\/file\/(\d+)/;
const BOX_HOST_RE = /(^|\.)box\.com$/i;

export function isBoxHost(urlString) {
  try {
    const host = new URL(urlString).hostname;
    return BOX_HOST_RE.test(host);
  } catch {
    return false;
  }
}

export function parseBoxFolderId(urlString = "") {
  const match = String(urlString).match(BOX_FOLDER_RE);
  return match ? match[1] : null;
}

export function parseBoxFileId(urlString = "") {
  const match = String(urlString).match(BOX_FILE_RE);
  return match ? match[1] : null;
}

export function boxFileUrl(id) {
  return `https://app.box.com/file/${id}`;
}

export function boxFolderUrl(id) {
  return `https://app.box.com/folder/${id}`;
}

export function extractSearchQuery(context) {
  const selection = (context?.selection || "").trim();
  if (selection) {
    return selection.length > 180 ? selection.slice(0, 180) : selection;
  }
  const title = (context?.pageTitle || "")
    .split(/\s[|\-–—]\s/)[0]
    .trim();
  return title.slice(0, 180);
}

export function buildPageContext(tab = {}, extra = {}) {
  const pageUrl = extra.pageUrl || tab.url || "";
  return {
    selection: (extra.selection || "").trim(),
    pageUrl,
    pageTitle: extra.pageTitle || tab.title || "",
    boxFolderId: extra.boxFolderId || parseBoxFolderId(pageUrl),
    boxFileId: extra.boxFileId || parseBoxFileId(pageUrl),
    capturedAt: Date.now()
  };
}
