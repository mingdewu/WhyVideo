import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAuthorizationUrl,
  disconnectOAuth,
  getValidAccessToken,
  handleOAuthCallback,
  saveOAuthCredentials,
  YOUTUBE_OAUTH_SCOPE,
} from '../packages/qc-tools/ui-server/lib/youtube-oauth.mjs';

function makeTempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-oauth-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, '.youtube-oauth.json');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('saveOAuthCredentials saves credentials and preserves existing secret when omitted', (t) => {
  const storePath = makeTempStore(t);
  const first = saveOAuthCredentials({ clientId: 'cid-1', clientSecret: 'sec-1' }, { storePath });
  assert.deepEqual(first, { ok: true, hasCredentials: true, clientId: 'cid-1' });

  const second = saveOAuthCredentials({ clientId: 'cid-1', clientSecret: '' }, { storePath });
  assert.deepEqual(second, { ok: true, hasCredentials: true, clientId: 'cid-1' });

  const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(saved.clientId, 'cid-1');
  assert.equal(saved.clientSecret, 'sec-1');
  assert.throws(() => saveOAuthCredentials({ clientId: '', clientSecret: 'sec-1' }, { storePath }), /Client ID/);
});

test('createAuthorizationUrl includes offline access, consent prompt, and youtube.force-ssl scope', (t) => {
  const storePath = makeTempStore(t);
  saveOAuthCredentials({ clientId: 'cid-auth', clientSecret: 'sec-auth' }, { storePath });
  const stateStore = new Map();
  const redirectUri = 'http://localhost:4000/api/publish/youtube/oauth/callback';
  const { authUrl, state } = createAuthorizationUrl({ redirectUri }, { storePath, stateStore });

  const parsed = new URL(authUrl);
  assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(parsed.searchParams.get('client_id'), 'cid-auth');
  assert.equal(parsed.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('scope'), YOUTUBE_OAUTH_SCOPE);
  assert.equal(parsed.searchParams.get('access_type'), 'offline');
  assert.equal(parsed.searchParams.get('prompt'), 'consent');
  assert.equal(parsed.searchParams.get('state'), state);
  assert.ok(stateStore.has(state));
});

test('handleOAuthCallback exchanges code, stores refresh token + channel, and rejects invalid state', async (t) => {
  const storePath = makeTempStore(t);
  saveOAuthCredentials({ clientId: 'cid-cb', clientSecret: 'sec-cb' }, { storePath });
  const stateStore = new Map();
  const redirectUri = 'http://localhost:4000/api/publish/youtube/oauth/callback';
  const { state } = createAuthorizationUrl({ redirectUri }, { storePath, stateStore });

  let nowMs = 1_700_000_000_000;
  const mockFetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'auth-code-123');
      assert.equal(form.get('redirect_uri'), redirectUri);
      return jsonResponse({
        access_token: 'access-initial',
        refresh_token: 'refresh-secret-1',
        expires_in: 3600,
        scope: YOUTUBE_OAUTH_SCOPE,
      });
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      assert.equal(init.headers.Authorization, 'Bearer access-initial');
      return jsonResponse({
        items: [{ id: 'UC_TEST_1', snippet: { title: 'My Why Channel' } }],
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const callbackRes = await handleOAuthCallback(
    { code: 'auth-code-123', state },
    { storePath, stateStore, fetchImpl: mockFetch, now: () => nowMs }
  );
  assert.deepEqual(callbackRes, {
    channelTitle: 'My Why Channel',
    channelId: 'UC_TEST_1',
    hasRefreshToken: true,
  });

  // State is single-use and rejected on replay or invalid state
  await assert.rejects(
    () => handleOAuthCallback({ code: 'auth-code-123', state }, { storePath, stateStore, fetchImpl: mockFetch }),
    /无效或已过期/
  );
  await assert.rejects(
    () => handleOAuthCallback({ code: 'auth-code-123', state: 'bad-state' }, { storePath, stateStore, fetchImpl: mockFetch }),
    /无效或已过期/
  );

  // Never exposes refreshToken or clientSecret in getValidAccessToken response
  const tokenRes = await getValidAccessToken({}, { storePath, fetchImpl: mockFetch, now: () => nowMs + 10_000 });
  assert.equal(tokenRes.connected, true);
  assert.equal(tokenRes.accessToken, 'access-initial');
  assert.equal(tokenRes.channelTitle, 'My Why Channel');
  assert.equal('refreshToken' in tokenRes, false);
  assert.equal('clientSecret' in tokenRes, false);
});

test('getValidAccessToken refreshes automatically when access token is expired or within margin', async (t) => {
  const storePath = makeTempStore(t);
  saveOAuthCredentials({ clientId: 'cid-ref', clientSecret: 'sec-ref' }, { storePath });
  const stateStore = new Map();
  const { state } = createAuthorizationUrl(
    { redirectUri: 'http://localhost:4000/api/publish/youtube/oauth/callback' },
    { storePath, stateStore }
  );

  let nowMs = 1_700_000_000_000;
  let refreshCalls = 0;
  const mockFetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        return jsonResponse({ access_token: 'tok-1', refresh_token: 'rt-1', expires_in: 3600 });
      }
      if (form.get('grant_type') === 'refresh_token') {
        refreshCalls += 1;
        assert.equal(form.get('refresh_token'), 'rt-1');
        return jsonResponse({ access_token: 'tok-refreshed-2', expires_in: 3600 });
      }
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return jsonResponse({ items: [{ id: 'UC_2', snippet: { title: 'Channel 2' } }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await handleOAuthCallback({ code: 'c1', state }, { storePath, stateStore, fetchImpl: mockFetch, now: () => nowMs });

  // Advance time past 1h expiry
  nowMs += 3600 * 1000;
  const [r1, r2] = await Promise.all([
    getValidAccessToken({}, { storePath, fetchImpl: mockFetch, now: () => nowMs }),
    getValidAccessToken({}, { storePath, fetchImpl: mockFetch, now: () => nowMs }),
  ]);

  assert.equal(refreshCalls, 1);
  assert.equal(r1.connected, true);
  assert.equal(r1.accessToken, 'tok-refreshed-2');
  assert.equal(r2.accessToken, 'tok-refreshed-2');
});

test('getValidAccessToken handles invalid_grant gracefully and clears stale tokens', async (t) => {
  const storePath = makeTempStore(t);
  saveOAuthCredentials({ clientId: 'cid-rev', clientSecret: 'sec-rev' }, { storePath });
  const stateStore = new Map();
  const { state } = createAuthorizationUrl(
    { redirectUri: 'http://localhost:4000/api/publish/youtube/oauth/callback' },
    { storePath, stateStore }
  );

  let nowMs = 1_700_000_000_000;
  const mockFetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        return jsonResponse({ access_token: 'tok-1', refresh_token: 'rt-revoked', expires_in: 3600 });
      }
      return jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return jsonResponse({ items: [{ id: 'UC_3', snippet: { title: 'Channel 3' } }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await handleOAuthCallback({ code: 'c2', state }, { storePath, stateStore, fetchImpl: mockFetch, now: () => nowMs });
  nowMs += 4000 * 1000;

  const res = await getValidAccessToken({}, { storePath, fetchImpl: mockFetch, now: () => nowMs });
  assert.equal(res.connected, false);
  assert.equal(res.expired, true);
  assert.equal(res.hasCredentials, true);
  assert.match(res.error, /刷新令牌已失效/);

  const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(stored.refreshToken, '');
  assert.equal(stored.accessToken, '');
  assert.equal(stored.clientId, 'cid-rev');
  assert.equal(stored.clientSecret, 'sec-rev');
});

test('disconnectOAuth clears tokens while preserving saved credentials', async (t) => {
  const storePath = makeTempStore(t);
  saveOAuthCredentials({ clientId: 'cid-disc', clientSecret: 'sec-disc' }, { storePath });
  const stateStore = new Map();
  const { state } = createAuthorizationUrl(
    { redirectUri: 'http://localhost:4000/api/publish/youtube/oauth/callback' },
    { storePath, stateStore }
  );

  const mockFetch = async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return jsonResponse({ access_token: 'tok-d', refresh_token: 'rt-d', expires_in: 3600 });
    }
    return jsonResponse({ items: [{ id: 'UC_D', snippet: { title: 'Channel D' } }] });
  };

  await handleOAuthCallback({ code: 'cd', state }, { storePath, stateStore, fetchImpl: mockFetch });
  const disc = disconnectOAuth({ clearCredentials: false }, { storePath });
  assert.deepEqual(disc, { ok: true, hasCredentials: true });

  const after = await getValidAccessToken({}, { storePath, fetchImpl: mockFetch });
  assert.deepEqual(after, {
    connected: false,
    mode: 'none',
    hasCredentials: true,
    clientId: 'cid-disc',
  });
});
