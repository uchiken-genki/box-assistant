import { BOX_API_BASE, FOLDER_ITEM_FIELDS, SEARCH_FIELDS } from "./config.js";
import { boxFileUrl, boxFolderUrl } from "./context.js";

export async function boxRequest(accessToken, path, { method = "GET", params, body, headers } = {}) {
  const url = new URL(`${BOX_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error_description || data.error || `Box API ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data.code || data.error;
    error.details = data;
    throw error;
  }
  return data;
}

export async function searchContent(accessToken, query, { ancestorFolderId, limit = 20 } = {}) {
  const data = await boxRequest(accessToken, "/search", {
    params: {
      query,
      limit,
      type: "file",
      fields: SEARCH_FIELDS,
      ancestor_folder_ids: ancestorFolderId || undefined
    }
  });
  return {
    totalCount: data.total_count || 0,
    entries: (data.entries || []).map(normalizeItem)
  };
}

export async function getFile(accessToken, fileId) {
  const item = await boxRequest(accessToken, `/files/${fileId}`, {
    params: { fields: SEARCH_FIELDS }
  });
  return normalizeItem({ ...item, type: "file" });
}

export async function getFolder(accessToken, folderId) {
  const folder = await boxRequest(accessToken, `/folders/${folderId}`, {
    params: {
      fields: "id,name,modified_at,description,item_collection,path_collection,owned_by"
    }
  });
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description || "",
    modifiedAt: folder.modified_at,
    path: formatPath(folder.path_collection),
    ownedBy: folder.owned_by?.name || "",
    itemCount: folder.item_collection?.total_count || 0
  };
}

export async function listFolderItems(accessToken, folderId, { limit = 50 } = {}) {
  const data = await boxRequest(accessToken, `/folders/${folderId}/items`, {
    params: {
      limit,
      fields: FOLDER_ITEM_FIELDS
    }
  });
  return {
    totalCount: data.total_count || 0,
    entries: (data.entries || []).map(normalizeItem)
  };
}

export async function getItemMetadata(accessToken, item) {
  const path = item.type === "folder"
    ? `/folders/${item.id}/metadata`
    : `/files/${item.id}/metadata`;
  try {
    const data = await boxRequest(accessToken, path);
    return (data.entries || []).map(normalizeMetadataInstance);
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

const AI_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv",
  "txt", "md", "html", "htm", "rtf", "boxnote", "gdoc", "gsheet", "gslide"
]);

const AI_AUTH_CODES = new Set([
  "insufficient_scope",
  "unauthorized",
  "cors_origin_not_whitelisted"
]);

export async function listHubs(accessToken, { limit = 100 } = {}) {
  const data = await boxRequest(accessToken, "/hubs", {
    params: {
      scope: "all",
      sort: "name",
      direction: "ASC",
      limit
    },
    headers: { "box-version": "2025.0" }
  });
  return {
    entries: (data.entries || []).map((hub) => ({
      id: String(hub.id),
      title: hub.title || `Hub ${hub.id}`,
      description: hub.description || "",
      isAiEnabled: Boolean(hub.is_ai_enabled)
    }))
  };
}

export async function probeBoxAiAccess(accessToken) {
  return boxRequest(accessToken, "/ai_agent_default", {
    params: { mode: "ask" },
    headers: { "box-version": "2024.0" }
  });
}

export async function askBoxAiHub(accessToken, { prompt, hubId, dialogueHistory }) {
  const id = String(hubId || "").trim();
  if (!id) {
    const error = new Error("HUB_REQUIRED");
    error.code = "HUB_REQUIRED";
    throw error;
  }

  try {
    await probeBoxAiAccess(accessToken);
  } catch (error) {
    if (isAiAuthError(error) || Number(error?.status) === 403) throw error;
  }

  return postAiAsk(accessToken, {
    prompt,
    items: [{ type: "hubs", id }],
    mode: "single_item_qa",
    dialogueHistory
  });
}

export async function askBoxAi(accessToken, { prompt, files, dialogueHistory }) {
  const usable = (files || []).filter(isAiSupportedFile).slice(0, 5);
  if (!usable.length) {
    const error = new Error("NO_FILES_FOR_AI");
    error.code = "NO_FILES_FOR_AI";
    throw error;
  }

  try {
    await probeBoxAiAccess(accessToken);
  } catch (error) {
    if (isAiAuthError(error) || Number(error?.status) === 403) throw error;
  }

  const seen = new Set();
  let lastError = null;

  for (const batch of aiFileBatches(usable)) {
    const key = batch.map((file) => file.id).join(",");
    if (!batch.length || seen.has(key)) continue;
    seen.add(key);
    try {
      const data = await postAiAsk(accessToken, {
        prompt,
        files: batch,
        dialogueHistory
      });
      return { ...data, usedFiles: batch };
    } catch (error) {
      lastError = error;
      if (isAiAuthError(error)) throw error;
    }
  }

  throw lastError || new Error("BOX_AI_FAILED");
}

async function postAiAsk(accessToken, { prompt, files, items, mode, dialogueHistory }) {
  const resolvedItems = items || (files || []).map((file) => ({ type: "file", id: String(file.id) }));
  const body = {
    mode: mode || (resolvedItems.length === 1 ? "single_item_qa" : "multiple_item_qa"),
    prompt: String(prompt || "").slice(0, 10000),
    items: resolvedItems,
    include_citations: true,
    ...(dialogueHistory?.length ? { dialogue_history: dialogueHistory } : {})
  };
  try {
    return await boxRequest(accessToken, "/ai/ask", {
      method: "POST",
      headers: { "box-version": "2024.0" },
      body
    });
  } catch (error) {
    if (error.status === 400 && /box-version|header/i.test(String(error.message))) {
      return boxRequest(accessToken, "/ai/ask", { method: "POST", body });
    }
    throw error;
  }
}

export function isAiSupportedFile(file) {
  if (file?.type && file.type !== "file") return false;
  return AI_EXTENSIONS.has((file.extension || "").toLowerCase());
}

function aiFileBatches(files) {
  const batches = [];
  if (files.length >= 2) batches.push(files.slice(0, Math.min(5, files.length)));
  if (files.length >= 3) batches.push(files.slice(0, 3));
  for (const file of files) batches.push([file]);
  return batches;
}

function isAiAuthError(error) {
  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.status);
  if (AI_AUTH_CODES.has(code)) return true;
  return status === 401;
}

export function normalizeItem(item) {
  const extension = (item.extension || fileExtension(item.name) || "").toLowerCase();
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    extension,
    fileType: describeFileType(item.type, extension),
    modifiedAt: item.modified_at || null,
    size: item.size || 0,
    description: item.description || "",
    folderName: item.parent?.name || "",
    folderId: item.parent?.id || "",
    path: formatPath(item.path_collection),
    url: item.type === "folder" ? boxFolderUrl(item.id) : boxFileUrl(item.id)
  };
}

export function normalizeMetadataInstance(instance) {
  const fields = {};
  for (const [key, value] of Object.entries(instance || {})) {
    if (key.startsWith("$")) continue;
    fields[key] = value;
  }
  return {
    template: instance.$template || "unknown",
    scope: instance.$scope || "",
    fields
  };
}

function formatPath(pathCollection) {
  const names = (pathCollection?.entries || [])
    .map((entry) => entry.name)
    .filter((name) => name && name !== "All Files");
  return names.join(" / ");
}

function fileExtension(name = "") {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function describeFileType(type, extension) {
  if (type === "folder") return "フォルダ";
  const map = {
    pdf: "PDF",
    pptx: "PowerPoint",
    ppt: "PowerPoint",
    docx: "Word",
    doc: "Word",
    xlsx: "Excel",
    xls: "Excel",
    csv: "CSV",
    png: "画像",
    jpg: "画像",
    jpeg: "画像",
    gif: "画像",
    mp4: "動画",
    boxnote: "Box Note",
    txt: "テキスト",
    md: "Markdown"
  };
  return map[extension] || (extension ? extension.toUpperCase() : "ファイル");
}
