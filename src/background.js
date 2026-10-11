import { handleMessage, hydrateContext } from "./handlers.js";

const BOX_API_ORIGIN_RULE_ID = 1;

async function stripBoxApiOriginHeader() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BOX_API_ORIGIN_RULE_ID],
      addRules: [
        {
          id: BOX_API_ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "remove" },
              { header: "referer", operation: "remove" }
            ]
          },
          condition: {
            requestDomains: ["api.box.com"],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["xmlhttprequest", "other"]
          }
        }
      ]
    });
  } catch (error) {
    console.warn("Failed to update Box API header rules", error);
  }
}

stripBoxApiOriginHeader();

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "ask-box-assistant",
      title: "Box Assistantに聞く",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "open-box-assistant",
      title: "このページをBox Assistantで調べる",
      contexts: ["page"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  stripBoxApiOriginHeader();
  setupContextMenus();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  stripBoxApiOriginHeader();
  setupContextMenus();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  openSidePanelNow(tab, info.selectionText || "");

  const extra = {
    selection: info.selectionText || "",
    pageUrl: info.pageUrl || tab?.url || "",
    pageTitle: tab?.title || ""
  };

  chrome.storage.session.set({
    context: {
      selection: extra.selection,
      pageUrl: extra.pageUrl,
      pageTitle: extra.pageTitle,
      boxFolderId: folderIdFromUrl(extra.pageUrl),
      boxFileId: fileIdFromUrl(extra.pageUrl),
      capturedAt: Date.now()
    }
  });

  if (tab?.id) {
    chrome.action.setBadgeBackgroundColor({ color: "#0061D5" });
    chrome.action.setBadgeText({ tabId: tab.id, text: "1" });
  }

  hydrateContext(tab, extra).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message,
        code: error.code || "UNKNOWN"
      });
    });
  return true;
});

function openSidePanelNow(tab, selection = "") {
  if (!tab) return;
  const options = tab.windowId != null
    ? { windowId: tab.windowId }
    : tab.id != null
      ? { tabId: tab.id }
      : null;
  if (!options) return;
  const opening = chrome.sidePanel.open(options);
  if (opening?.catch) {
    opening.catch(() => {
      if (!tab.id) return;
      chrome.tabs.sendMessage(
        tab.id,
        { type: "SHOW_PANEL_HINT", selection },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.get("popoutWindowId").then(({ popoutWindowId }) => {
    if (popoutWindowId === windowId) {
      chrome.storage.session.remove("popoutWindowId");
    }
  });
});

function folderIdFromUrl(url) {
  const match = String(url).match(/\/folder\/(\d+)/);
  return match ? match[1] : null;
}

function fileIdFromUrl(url) {
  const match = String(url).match(/\/file\/(\d+)/);
  return match ? match[1] : null;
}
