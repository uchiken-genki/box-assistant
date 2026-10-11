function parseBoxId(pathname, kind) {
  const match = pathname.match(new RegExp(`/${kind}/(\\d+)`));
  return match ? match[1] : null;
}

function getPageContext() {
  const selection = (window.getSelection?.().toString() || "").trim();
  return {
    selection,
    pageUrl: location.href,
    pageTitle: document.title || "",
    boxFolderId: parseBoxId(location.pathname, "folder"),
    boxFileId: parseBoxId(location.pathname, "file")
  };
}

function showPanelHint(selection) {
  const existing = document.getElementById("box-assistant-hint");
  if (existing) existing.remove();

  const hint = document.createElement("div");
  hint.id = "box-assistant-hint";
  hint.setAttribute("role", "status");
  hint.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "max-width:320px",
    "padding:14px 16px",
    "border-radius:12px",
    "background:#1a2733",
    "color:#fff",
    "font:13px/1.5 Segoe UI,Hiragino Kaku Gothic ProN,Meiryo,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.25)"
  ].join(";");

  const subject = selection ? `「${selection.slice(0, 40)}」` : "選択したテキスト";
  hint.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">Box Assistant</div>
    <div style="margin-bottom:8px">${escapeHtml(subject)} を渡しました。サイドパネルの開き方:</div>
    <div>1. Chrome右上の <b>パズル（拡張機能）</b> をクリック</div>
    <div>2. <b>Box Assistant</b> をクリック（ピン留めすると次回からツールバーに出ます）</div>
    <div style="margin-top:8px;opacity:.85">ショートカット: Ctrl + Shift + Y</div>
  `;
  document.documentElement.appendChild(hint);
  setTimeout(() => hint.remove(), 8000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_CONTEXT") {
    sendResponse(getPageContext());
    return;
  }
  if (message?.type === "SHOW_PANEL_HINT") {
    showPanelHint(message.selection || "");
    sendResponse({ ok: true });
  }
});
