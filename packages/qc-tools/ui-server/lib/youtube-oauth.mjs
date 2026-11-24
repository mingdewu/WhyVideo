import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { rootDir } from './config.mjs';

export const DEFAULT_OAUTH_STORE_PATH = path.join(rootDir, '.youtube-oauth.json');
export const YOUTUBE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNEL_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 120 * 1000;

const defaultStateStore = new Map();
const inFlightRefreshes = new Map();

function normalizeStore(raw = {}) {
  return {
    clientId: typeof raw.clientId === 'string' ? raw.clientId.trim() : '',
    clientSecret: typeof raw.clientSecret === 'string' ? raw.clientSecret.trim() : '',
    refreshToken: typeof raw.refreshToken === 'string' ? raw.refreshToken.trim() : '',
    accessToken: typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '',
    expiresAt: Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : 0,
    scope: typeof raw.scope === 'string' ? raw.scope : '',
    channelTitle: typeof raw.channelTitle === 'string' ? raw.channelTitle : '',
    channelId: typeof raw.channelId === 'string' ? raw.channelId : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

function readOAuthStore(storePath = DEFAULT_OAUTH_STORE_PATH) {
  try {
    if (!fs.existsSync(storePath)) return normalizeStore();
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return normalizeStore(parsed && typeof parsed === 'object' ? parsed : {});
  } catch {
    return normalizeStore();
  }
}

function writeOAuthStore(storePath = DEFAULT_OAUTH_STORE_PATH, data = {}) {
  const normalized = normalizeStore(data);
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tempPath, 0o600);
  } catch {}
  fs.renameSync(tempPath, storePath);
  try {
    fs.chmodSync(storePath, 0o600);
  } catch {}
  return normalized;
}

function resolveCredentials(stored) {
  const envClientId = (process.env.YOUTUBE_OAUTH_CLIENT_ID || '').trim();
  const envClientSecret = (process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim();
  return {
    clientId: stored.clientId || envClientId,
    clientSecret: stored.clientSecret || envClientSecret,
  };
}

function pruneExpiredStates(stateStore, nowMs) {
  for (const [key, entry] of stateStore.entries()) {
    if (!entry || nowMs - entry.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function saveOAuthCredentials({ clientId, clientSecret } = {}, opts = {}) {
  const storePath = opts.storePath || DEFAULT_OAUTH_STORE_PATH;
  const nowFn = opts.now || Date.now;
  const stored = readOAuthStore(storePath);
  const trimmedId = typeof clientId === 'string' ? clientId.trim() : '';
  const trimmedSecret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
  const effectiveSecret = trimmedSecret || stored.clientSecret || (process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim();

  if (!trimmedId) {
    throw new Error('请填写 Google OAuth Client ID。');
  }
  if (!effectiveSecret) {
    throw new Error('请填写 Google OAuth Client Secret。');
  }

  const clientChanged = Boolean(stored.clientId && stored.clientId !== trimmedId);
  const next = {
    ...stored,
    clientId: trimmedId,
    clientSecret: effectiveSecret,
    ...(clientChanged
      ? {
          refreshToken: '',
          accessToken: '',
          expiresAt: 0,
          scope: '',
          channelTitle: '',
          channelId: '',
        }
      : {}),
    updatedAt: new Date(nowFn()).toISOString(),
  };

  writeOAuthStore(storePath, next);
  return {
    ok: true,
    hasCredentials: true,
    clientId: trimmedId,
  };
}

export function createAuthorizationUrl({ redirectUri } = {}, opts = {}) {
  const storePath = opts.storePath || DEFAULT_OAUTH_STORE_PATH;
  const stateStore = opts.stateStore || defaultStateStore;
  const nowFn = opts.now || Date.now;
  const nowMs = nowFn();

  if (typeof redirectUri !== 'string' || !redirectUri.trim()) {
    throw new Error('缺少 OAuth 回调地址 (redirectUri)。');
  }

  const stored = readOAuthStore(storePath);
  const { clientId, clientSecret } = resolveCredentials(stored);
  if (!clientId || !clientSecret) {
    throw new Error('请先配置 Google OAuth Client ID 和 Client Secret。');
  }

  pruneExpiredStates(stateStore, nowMs);
  const state = crypto.randomBytes(24).toString('hex');
  const cleanRedirectUri = redirectUri.trim();
  stateStore.set(state, { redirectUri: cleanRedirectUri, createdAt: nowMs });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: cleanRedirectUri,
    response_type: 'code',
    scope: YOUTUBE_OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return {
    authUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
    state,
    redirectUri: cleanRedirectUri,
  };
}

export async function handleOAuthCallback({ code, state, error } = {}, opts = {}) {
  const storePath = opts.storePath || DEFAULT_OAUTH_STORE_PATH;
  const stateStore = opts.stateStore || defaultStateStore;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const nowFn = opts.now || Date.now;
  const nowMs = nowFn();

  pruneExpiredStates(stateStore, nowMs);
  const stateKey = typeof state === 'string' ? state.trim() : '';
  const pending = stateKey ? stateStore.get(stateKey) : null;
  if (stateKey) stateStore.delete(stateKey);

  if (!pending || nowMs - pending.createdAt > STATE_TTL_MS) {
    throw new Error('授权状态无效或已过期，请返回发布台重新发起授权。');
  }
  if (error) {
    throw new Error(`Google 授权被取消或失败：${String(error)}`);
  }
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('回调缺少授权码 (code)，请重试。');
  }

  const stored = readOAuthStore(storePath);
  const { clientId, clientSecret } = resolveCredentials(stored);
  if (!clientId || !clientSecret) {
    throw new Error('缺少 Google OAuth Client ID 或 Client Secret，无法交换令牌。');
  }

  const tokenBody = new URLSearchParams({
    code: code.trim(),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: pending.redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  const tokenData = await parseJsonSafe(tokenResponse);
  if (!tokenResponse.ok || !tokenData.access_token) {
    const detail = tokenData.error_description || tokenData.error || `HTTP ${tokenResponse.status}`;
    throw new Error(`获取 Google 访问令牌失败：${detail}`);
  }

  const channelResponse = await fetchImpl(YOUTUBE_CHANNEL_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const channelData = await parseJsonSafe(channelResponse);
  if (!channelResponse.ok) {
    const detail = channelData.error?.message || `HTTP ${channelResponse.status}`;
    throw new Error(`读取 YouTube 频道失败：${detail}`);
  }
  const channel = channelData.items?.[0];
  if (!channel) {
    throw new Error('未找到 YouTube 频道，请确认所选 Google 账号已开通频道并授予权限。');
  }

  const expiresInSec = Number(tokenData.expires_in) > 0 ? Number(tokenData.expires_in) : 3600;
  const refreshToken = typeof tokenData.refresh_token === 'string' && tokenData.refresh_token.trim()
    ? tokenData.refresh_token.trim()
    : stored.refreshToken;
  const channelTitle = channel.snippet?.title || 'YouTube 频道';
  const channelId = channel.id || '';

  writeOAuthStore(storePath, {
    ...stored,
    clientId,
    clientSecret,
    refreshToken,
    accessToken: tokenData.access_token,
    expiresAt: nowMs + expiresInSec * 1000,
    scope: typeof tokenData.scope === 'string' ? tokenData.scope : YOUTUBE_OAUTH_SCOPE,
    channelTitle,
    channelId,
    updatedAt: new Date(nowMs).toISOString(),
  });

  return {
    channelTitle,
    channelId,
    hasRefreshToken: Boolean(refreshToken),
  };
}

async function performTokenRefresh(storePath, fetchImpl, nowFn) {
  const stored = readOAuthStore(storePath);
  const { clientId, clientSecret } = resolveCredentials(stored);
  const hasCredentials = Boolean(clientId && clientSecret);

  if (!stored.refreshToken) {
    return {
      connected: false,
      mode: 'none',
      hasCredentials,
      clientId: clientId || '',
    };
  }
  if (!hasCredentials) {
    return {
      connected: false,
      mode: 'oauth',
      hasCredentials: false,
      clientId: clientId || '',
      error: '缺少 Google OAuth Client ID 或 Client Secret，请重新保存凭据并授权。',
    };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: stored.refreshToken,
    grant_type: 'refresh_token',
  });

  try {
    const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await parseJsonSafe(response);
    const nowMs = nowFn();

    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_grant') {
        writeOAuthStore(storePath, {
          ...stored,
          clientId,
          clientSecret,
          refreshToken: '',
          accessToken: '',
          expiresAt: 0,
          updatedAt: new Date(nowMs).toISOString(),
        });
        return {
          connected: false,
          expired: true,
          mode: 'oauth',
          hasCredentials: true,
          clientId,
          error: '刷新令牌已失效（若 Google Cloud 应用处于“测试”状态，令牌会在 7 天后过期；请重新授权，或在 Google Cloud 将应用发布状态改为“生产”）。',
        };
      }
      const detail = data.error_description || data.error || `HTTP ${response.status}`;
      return {
        connected: false,
        mode: 'oauth',
        hasCredentials: true,
        clientId,
        error: `自动续期失败：${detail}`,
      };
    }

    const expiresInSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    const expiresAt = nowMs + expiresInSec * 1000;
    const nextRefresh = typeof data.refresh_token === 'string' && data.refresh_token.trim()
      ? data.refresh_token.trim()
      : stored.refreshToken;

    writeOAuthStore(storePath, {
      ...stored,
      clientId,
      clientSecret,
      refreshToken: nextRefresh,
      accessToken: data.access_token,
      expiresAt,
      scope: typeof data.scope === 'string' ? data.scope : stored.scope,
      updatedAt: new Date(nowMs).toISOString(),
    });

    return {
      connected: true,
      mode: 'oauth',
      accessToken: data.access_token,
      expiresAt,
      channelTitle: stored.channelTitle || '',
      clientId,
      hasCredentials: true,
    };
  } catch (err) {
    return {
      connected: false,
      mode: 'oauth',
      hasCredentials: true,
      clientId,
      error: `刷新令牌时网络请求失败：${err.message}`,
    };
  }
}

export async function getValidAccessToken({ forceRefresh = false } = {}, opts = {}) {
  const storePath = opts.storePath || DEFAULT_OAUTH_STORE_PATH;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const nowFn = opts.now || Date.now;
  const stored = readOAuthStore(storePath);
  const { clientId, clientSecret } = resolveCredentials(stored);
  const hasCredentials = Boolean(clientId && clientSecret);

  if (!stored.refreshToken) {
    return {
      connected: false,
      mode: 'none',
      hasCredentials,
      clientId: clientId || '',
    };
  }

  if (!forceRefresh && stored.accessToken && stored.expiresAt - nowFn() > REFRESH_MARGIN_MS) {
    return {
      connected: true,
      mode: 'oauth',
      accessToken: stored.accessToken,
      expiresAt: stored.expiresAt,
      channelTitle: stored.channelTitle || '',
      clientId: clientId || '',
      hasCredentials,
    };
  }

  const refreshKey = path.resolve(storePath);
  let pending = inFlightRefreshes.get(refreshKey);
  if (!pending) {
    pending = performTokenRefresh(storePath, fetchImpl, nowFn).finally(() => {
      inFlightRefreshes.delete(refreshKey);
    });
    inFlightRefreshes.set(refreshKey, pending);
  }
  return pending;
}

export function disconnectOAuth({ clearCredentials = false } = {}, opts = {}) {
  const storePath = opts.storePath || DEFAULT_OAUTH_STORE_PATH;
  const nowFn = opts.now || Date.now;
  const stored = readOAuthStore(storePath);

  const next = {
    ...stored,
    ...(clearCredentials ? { clientId: '', clientSecret: '' } : {}),
    refreshToken: '',
    accessToken: '',
    expiresAt: 0,
    scope: '',
    channelTitle: '',
    channelId: '',
    updatedAt: new Date(nowFn()).toISOString(),
  };

  writeOAuthStore(storePath, next);
  return {
    ok: true,
    hasCredentials: Boolean(next.clientId && next.clientSecret),
  };
}
