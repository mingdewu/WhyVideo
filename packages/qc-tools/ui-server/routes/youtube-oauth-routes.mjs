import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBody } from '../lib/config.mjs';

const scope = 'https://www.googleapis.com/auth/youtube.force-ssl';
const storeDir = path.join(os.homedir(), '.whyvideo');
const storePath = path.join(storeDir, 'youtube-oauth.json');
const pending = new Map();
let refreshPending = null;

function readStore() {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch { return {}; }
}
function writeStore(data) {
  fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(storeDir, 0o700);
  const temp = storePath + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, storePath);
  fs.chmodSync(storePath, 0o600);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
  return true;
}
function originFor(req) {
  const host = req.headers.host || '';
  if (!/^localhost:\d{1,5}$/.test(host) && !/^127\.0\.0\.1:\d{1,5}$/.test(host)) throw new Error('请从 localhost 打开 WhyVideo。');
  return 'http://' + host;
}
function checkLocal(req) {
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new Error('YouTube 授权仅允许从本机访问。');
  const origin = originFor(req);
  if (req.method === 'POST' && req.headers.origin !== origin) throw new Error('请求来源不匹配。');
  return origin;
}
async function exchange(form) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google 令牌交换失败');
  return data;
}
async function getAccessToken() {
  const saved = readStore();
  if (!saved.refreshToken) throw new Error('请先完成 Google 授权。');
  if (saved.accessToken && saved.expiresAt > Date.now() + 120000) return saved.accessToken;
  if (!refreshPending) {
    refreshPending = (async () => {
      const data = await exchange({ client_id: saved.clientId, client_secret: saved.clientSecret, refresh_token: saved.refreshToken, grant_type: 'refresh_token' });
      writeStore({ ...readStore(), accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
      return data.access_token;
    })().finally(() => { refreshPending = null; });
  }
  return refreshPending;
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
  return true;
}
function callbackResult(origin, result) {
  return origin + '/?tab=publish&youtube_oauth=' + encodeURIComponent(result);
}

export async function handleYoutubeOAuthRoutes(req, res, { pathname, url }) {
  if (!pathname.startsWith('/api/youtube/oauth/')) return false;
  let origin;
  try { origin = checkLocal(req); } catch (err) { return json(res, 403, { error: err.message }); }
  const redirectUri = origin + '/api/youtube/oauth/callback';
  try {
    if (pathname === '/api/youtube/oauth/status' && req.method === 'GET') {
      const saved = readStore();
      return json(res, 200, { configured: Boolean(saved.clientId && saved.clientSecret), connected: Boolean(saved.refreshToken), channelTitle: saved.channelTitle || '', redirectUri });
    }
    if (pathname === '/api/youtube/oauth/config' && req.method === 'POST') {
      const body = await readBody(req);
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret || clientSecret.length > 500) return json(res, 400, { error: '请填写有效的 OAuth Client ID 和 Client Secret。' });
      writeStore({ clientId, clientSecret });
      const state = crypto.randomBytes(32).toString('base64url');
      pending.set(state, { origin, created: Date.now() });
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state }).toString();
      return json(res, 200, { authUrl: auth.href });
    }
    if (pathname === '/api/youtube/oauth/callback' && req.method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const request = pending.get(state);
      pending.delete(state);
      if (!request || request.origin !== origin || Date.now() - request.created > 10 * 60 * 1000) return redirect(res, callbackResult(origin, 'invalid_state'));
      if (url.searchParams.has('error')) return redirect(res, callbackResult(origin, 'cancelled'));
      const code = url.searchParams.get('code');
      if (!code) return redirect(res, callbackResult(origin, 'missing_code'));
      const saved = readStore();
      const data = await exchange({ code, client_id: saved.clientId, client_secret: saved.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
      if (!data.refresh_token) return redirect(res, callbackResult(origin, 'missing_refresh'));
      const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + data.access_token } });
      const channelData = await channelResponse.json();
      if (!channelResponse.ok || !channelData.items?.[0]) return redirect(res, callbackResult(origin, 'channel_error'));
      writeStore({ ...saved, refreshToken: data.refresh_token, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, channelTitle: channelData.items[0].snippet.title });
      return redirect(res, callbackResult(origin, 'connected'));
    }
    if (pathname === '/api/youtube/oauth/token' && req.method === 'GET') return json(res, 200, { accessToken: await getAccessToken(), channelTitle: readStore().channelTitle });
    if (pathname === '/api/youtube/oauth/disconnect' && req.method === 'POST') {
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (pathname === '/api/youtube/oauth/callback') return redirect(res, callbackResult(origin, 'exchange_error'));
    return json(res, 400, { error: err.message });
  }
}
