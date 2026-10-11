import {
  BOX_AUTHORIZE_URL,
  BOX_REVOKE_URL,
  BOX_TOKEN_URL
} from "./config.js";
import { boxRequest } from "./box-api.js";

const TOKEN_SKEW_MS = 60_000;

export function getRedirectUri() {
  return chrome.identity.getRedirectURL();
}

export async function getSettings() {
  const stored = await chrome.storage.local.get([
    "clientId",
    "clientSecret",
    "ancestorFolderId",
    "hubId",
    "hubTitle"
  ]);
  return {
    clientId: (stored.clientId || "").trim(),
    clientSecret: (stored.clientSecret || "").trim(),
    ancestorFolderId: (stored.ancestorFolderId || "").trim(),
    hubId: (stored.hubId || "").trim(),
    hubTitle: (stored.hubTitle || "").trim()
  };
}

export async function saveSettings(updates = {}) {
  const current = await getSettings();
  const next = {
    clientId: updates.clientId !== undefined ? String(updates.clientId).trim() : current.clientId,
    clientSecret: updates.clientSecret !== undefined ? String(updates.clientSecret).trim() : current.clientSecret,
    ancestorFolderId: updates.ancestorFolderId !== undefined ? String(updates.ancestorFolderId).trim() : current.ancestorFolderId,
    hubId: updates.hubId !== undefined ? String(updates.hubId).trim() : current.hubId,
    hubTitle: updates.hubTitle !== undefined ? String(updates.hubTitle).trim() : current.hubTitle
  };
  await chrome.storage.local.set(next);
  return next;
}

export async function getStoredSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

export async function getAuthStatus() {
  const settings = await getSettings();
  const session = await getStoredSession();
  const configured = Boolean(settings.clientId && settings.clientSecret);
  return {
    configured,
    authenticated: Boolean(session?.accessToken && session?.refreshToken),
    user: session?.user || null,
    redirectUri: getRedirectUri(),
    ancestorFolderId: settings.ancestorFolderId,
    hubId: settings.hubId,
    hubTitle: settings.hubTitle
  };
}

async function saveSession(session) {
  await chrome.storage.local.set({ session });
}

let inFlightLogin = null;

export async function login() {
  if (inFlightLogin) return inFlightLogin;
  inFlightLogin = doLogin().finally(() => {
    inFlightLogin = null;
  });
  return inFlightLogin;
}

async function doLogin() {
  const { clientId, clientSecret } = await getSettings();
  if (!clientId || !clientSecret) {
    const error = new Error("MISSING_CREDENTIALS");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }

  const redirectUri = getRedirectUri();
  const state = crypto.randomUUID();
  const authUrl = new URL(BOX_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  if (!redirectUrl) {
    const error = new Error("AUTH_CANCELLED");
    error.code = "AUTH_CANCELLED";
    throw error;
  }

  const redirected = new URL(redirectUrl);
  const returnedState = redirected.searchParams.get("state");
  const code = redirected.searchParams.get("code");
  const oauthError = redirected.searchParams.get("error");

  if (oauthError) {
    const error = new Error(oauthError);
    error.code = "OAUTH_ERROR";
    throw error;
  }
  if (returnedState !== state || !code) {
    const error = new Error("INVALID_OAUTH_RESPONSE");
    error.code = "INVALID_OAUTH_RESPONSE";
    throw error;
  }

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  });

  const session = toSession(tokens);
  session.user = await fetchCurrentUser(session.accessToken);
  await saveSession(session);
  return session;
}

export async function logout() {
  const { clientId, clientSecret } = await getSettings();
  const session = await getStoredSession();
  if (session?.accessToken && clientId && clientSecret) {
    try {
      await fetch(BOX_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token: session.accessToken
        })
      });
    } catch {
      // Best-effort revoke. Local session is cleared either way.
    }
  }
  await chrome.storage.local.remove("session");
}

export async function getValidAccessToken() {
  const session = await getStoredSession();
  if (!session?.accessToken) return null;

  if (Date.now() < session.expiresAt) {
    return session.accessToken;
  }

  if (!session.refreshToken) {
    await chrome.storage.local.remove("session");
    return null;
  }

  const { clientId, clientSecret } = await getSettings();
  try {
    const tokens = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });
    const next = toSession(tokens, session.user);
    if (!next.user) {
      next.user = await fetchCurrentUser(next.accessToken);
    }
    await saveSession(next);
    return next.accessToken;
  } catch {
    await chrome.storage.local.remove("session");
    return null;
  }
}

async function exchangeToken(params) {
  const response = await fetch(BOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || "TOKEN_EXCHANGE_FAILED");
    error.code = data.error || "TOKEN_EXCHANGE_FAILED";
    throw error;
  }
  return data;
}

function toSession(tokens, existingUser = null) {
  const lifetimeMs = Math.max(30, (tokens.expires_in || 3600)) * 1000;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + lifetimeMs - TOKEN_SKEW_MS,
    user: existingUser
  };
}

async function fetchCurrentUser(accessToken) {
  try {
    const user = await boxRequest(accessToken, "/users/me", {
      params: { fields: "id,name,login,avatar_url" }
    });
    return {
      id: user.id,
      name: user.name,
      login: user.login,
      avatarUrl: user.avatar_url || null
    };
  } catch {
    return null;
  }
}
