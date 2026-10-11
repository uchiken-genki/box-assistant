const form = document.getElementById("settings-form");
const statusEl = document.getElementById("save-status");
const redirectEl = document.getElementById("redirect-uri");
const corsEl = document.getElementById("cors-origin");
const extensionIdEl = document.getElementById("extension-id");

const redirectUri = chrome.identity.getRedirectURL();
const corsOrigin = `chrome-extension://${chrome.runtime.id}`;
redirectEl.textContent = redirectUri;
corsEl.textContent = corsOrigin;
extensionIdEl.textContent = chrome.runtime.id;

const stored = await chrome.storage.local.get([
  "clientId",
  "clientSecret",
  "ancestorFolderId",
  "hubId",
  "hubTitle"
]);
form.clientId.value = stored.clientId || "";
form.clientSecret.value = stored.clientSecret || "";
form.ancestorFolderId.value = stored.ancestorFolderId || "";
form.hubId.value = stored.hubId || "";
form.hubTitle.value = stored.hubTitle || "";

bindCopy("copy-redirect", redirectUri);
bindCopy("copy-cors", corsOrigin);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    clientId: form.clientId.value.trim(),
    clientSecret: form.clientSecret.value.trim(),
    ancestorFolderId: form.ancestorFolderId.value.trim(),
    hubId: form.hubId.value.trim(),
    hubTitle: form.hubTitle.value.trim()
  });
  statusEl.hidden = false;
});

function bindCopy(buttonId, value) {
  const button = document.getElementById(buttonId);
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = "コピー済み";
    setTimeout(() => {
      button.textContent = "コピー";
    }, 1500);
  });
}
