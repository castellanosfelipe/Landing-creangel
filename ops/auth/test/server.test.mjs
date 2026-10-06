import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createAuthServer, loadConfiguration } from '../server.mjs';

const ORIGIN = 'https://portal.creangel.com';
const TOKEN = 'gho_mock_authorized_editor';
const SECRET = 'mock-secret-never-send-to-browser';

async function listening(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  const done = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await done;
}

async function fixture(t, { login = 'castellanosfelipe', push = true, fullName = 'castellanosfelipe/Landing-creangel', tokenError = false, allowedUsers = ['castellanosfelipe'], clock } = {}) {
  const requests = [];
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, body, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login/oauth/access_token') return res.end(JSON.stringify(tokenError ? { error: 'bad_verification_code' } : { access_token: TOKEN, token_type: 'bearer', scope: 'public_repo' }));
    if (req.url === '/user') return res.end(JSON.stringify({ login, id: 123 }));
    if (req.url === '/repos/castellanosfelipe/Landing-creangel') return res.end(JSON.stringify({ full_name: fullName, permissions: { push } }));
    if (req.url === '/applications/mock-client/token' && req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
    res.statusCode = 404;
    res.end('{}');
  });
  const providerUrl = await listening(provider);
  const broker = createAuthServer({ origin: ORIGIN, clientId: 'mock-client', clientSecret: SECRET, repository: 'castellanosfelipe/Landing-creangel', allowedUsers }, {
    fetchImpl: (url, options) => {
      const fixedUrl = new URL(url);
      assert.ok(['https://github.com', 'https://api.github.com'].includes(fixedUrl.origin));
      return fetch(`${providerUrl}${fixedUrl.pathname}${fixedUrl.search}`, options);
    },
    ...(clock ? { now: clock } : {}),
  });
  const brokerUrl = await listening(broker);
  t.after(async () => { await close(broker); await close(provider); });
  const start = async () => {
    const response = await fetch(`${brokerUrl}/auth/auth?provider=github&site_id=portal.creangel.com&scope=repo`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const cookie = response.headers.get('set-cookie');
    const authorize = new URL(response.headers.get('location'));
    return { cookie: cookie.split(';')[0], cookieHeader: cookie, authorize, state: authorize.searchParams.get('state') };
  };
  const callback = (session, extra = '') => fetch(`${brokerUrl}/auth/callback?code=mock-code&state=${session.state}${extra}`, { headers: { Cookie: session.cookie } });
  return { requests, brokerUrl, start, callback };
}

test('configuration requires HTTPS, secret file and normalized explicit editor allowlist', () => {
  const directory = mkdtempSync(join(tmpdir(), 'creangel-oauth-'));
  const secretFile = join(directory, 'secret');
  writeFileSync(secretFile, SECRET);
  try {
    const env = { PUBLIC_SITE_URL: ORIGIN, GITHUB_CLIENT_ID: 'mock-client', GITHUB_CLIENT_SECRET_FILE: secretFile, CMS_ALLOWED_USERS: ' CastellanosFelipe, editor-two,castellanosfelipe ' };
    const config = loadConfiguration(env);
    assert.deepEqual(config.allowedUsers, ['castellanosfelipe', 'editor-two']);
    assert.equal(config.origin, ORIGIN);
    assert.equal(config.clientSecret, SECRET);
    assert.throws(() => loadConfiguration({ ...env, PUBLIC_SITE_URL: 'http://portal.creangel.com' }), /HTTPS/);
    assert.throws(() => loadConfiguration({ ...env, PUBLIC_SITE_URL: `${ORIGIN}/admin/` }), /without a path/);
    assert.throws(() => loadConfiguration({ ...env, CMS_ALLOWED_USERS: 'castellanosfelipe,*' }), /CMS_ALLOWED_USERS/);
    assert.throws(() => loadConfiguration({ ...env, GITHUB_CLIENT_SECRET_FILE: join(directory, 'missing') }), /Cannot read/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('start uses fixed provider, scope, secure ten-minute cookie and PKCE', async t => {
  const { start, callback, requests } = await fixture(t);
  const session = await start();
  assert.equal(session.authorize.origin, 'https://github.com');
  assert.equal(session.authorize.pathname, '/login/oauth/authorize');
  assert.equal(session.authorize.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.equal(session.authorize.searchParams.get('scope'), 'public_repo');
  assert.equal(session.authorize.searchParams.get('allow_signup'), 'false');
  assert.equal(session.authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(session.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.cookieHeader, /^__Host-creangel-oauth=/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(session.cookieHeader.includes(attribute));
  const response = await callback(session);
  assert.equal(response.status, 200);
  const exchange = new URLSearchParams(requests[0].body);
  assert.equal(exchange.get('client_secret'), SECRET);
  assert.equal(exchange.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), session.authorize.searchParams.get('code_challenge'));
});

test('success follows exact Decap handshake and never sends token to another origin or source', async t => {
  const { start, callback, requests } = await fixture(t);
  const response = await callback(await start());
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.ok(!html.includes(SECRET));
  assert.ok(!html.includes('mock-code'));
  assert.equal(requests[1].headers.authorization, `Bearer ${TOKEN}`);
  const messages = [];
  const opener = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const listeners = new Map();
  const window = { opener, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type), setTimeout: () => 1 };
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  runInNewContext(script, { window });
  assert.deepEqual(messages, [{ data: 'authorizing:github', origin: ORIGIN }]);
  listeners.get('message')({ origin: 'https://evil.invalid', source: opener, data: 'authorizing:github' });
  listeners.get('message')({ origin: ORIGIN, source: {}, data: 'authorizing:github' });
  assert.equal(messages.length, 1);
  listeners.get('message')({ origin: ORIGIN, source: opener, data: 'authorizing:github' });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].origin, ORIGIN);
  const prefix = 'authorization:github:success:';
  assert.ok(messages[1].data.startsWith(prefix));
  assert.deepEqual(JSON.parse(messages[1].data.slice(prefix.length)), { token: TOKEN, provider: 'github' });
  assert.equal(listeners.has('message'), false);
});

test('state mismatch consumes session and callback replay cannot exchange tokens', async t => {
  const { start, callback, requests } = await fixture(t);
  const session = await start();
  const mismatch = await callback({ ...session, state: 'invalid' });
  assert.equal(mismatch.status, 403);
  assert.ok((await mismatch.text()).includes('authorization:github:error:'));
  const replay = await callback(session);
  assert.equal(replay.status, 403);
  assert.equal(requests.length, 0);
});

test('successful callbacks also reject replay', async t => {
  const { start, callback, requests } = await fixture(t);
  const session = await start();
  assert.equal((await callback(session)).status, 200);
  assert.equal((await callback(session)).status, 403);
  assert.equal(requests.length, 3);
});

test('expired state and missing cookie deny access before provider requests', async t => {
  let time = 0;
  const { start, callback, brokerUrl, requests } = await fixture(t, { clock: () => time });
  const session = await start();
  time = 600001;
  assert.equal((await callback(session)).status, 403);
  assert.equal((await fetch(`${brokerUrl}/auth/callback?code=mock-code&state=${session.state}`)).status, 403);
  assert.equal(requests.length, 0);
});

test('new browser session replaces previous login attempt', async t => {
  const { brokerUrl, start, callback, requests } = await fixture(t);
  const previous = await start();
  const next = await fetch(`${brokerUrl}/auth/auth?provider=github&site_id=portal.creangel.com`, { redirect: 'manual', headers: { Cookie: previous.cookie } });
  assert.equal(next.status, 302);
  assert.equal((await callback(previous)).status, 403);
  assert.equal(requests.length, 0);
});

test('unlisted editor is denied even with repository write access and token is revoked', async t => {
  const { start, callback, requests } = await fixture(t, { login: 'unlisted-collaborator' });
  const response = await callback(await start());
  const html = await response.text();
  assert.equal(response.status, 403);
  assert.ok(!html.includes(TOKEN));
  assert.deepEqual(requests.map(request => request.path), ['/login/oauth/access_token', '/user', '/applications/mock-client/token']);
  assert.equal(requests[2].method, 'DELETE');
  assert.equal(JSON.parse(requests[2].body).access_token, TOKEN);
});

test('second explicitly configured editor with push permission is accepted', async t => {
  const { start, callback } = await fixture(t, { login: 'Editor-Two', allowedUsers: ['castellanosfelipe', 'editor-two'] });
  assert.equal((await callback(await start())).status, 200);
});

test('listed account without push access is denied and token never appears in browser', async t => {
  const { start, callback, requests } = await fixture(t, { push: false });
  const response = await callback(await start());
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes(TOKEN));
  assert.equal(requests.at(-1).method, 'DELETE');
});

test('repository mismatch is denied even when response grants push', async t => {
  const { start, callback } = await fixture(t, { fullName: 'other/repository' });
  const response = await callback(await start());
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes(TOKEN));
});

test('GitHub exchange failure returns a generic error without client secret', async t => {
  const { start, callback, requests } = await fixture(t, { tokenError: true });
  const response = await callback(await start());
  const html = await response.text();
  assert.equal(response.status, 502);
  assert.ok(html.includes('authorization:github:error:'));
  assert.ok(!html.includes(SECRET));
  assert.ok(!html.includes('bad_verification_code'));
  assert.equal(requests.length, 1);
});

test('other site, unexpected provider, cross-origin start and duplicate states are rejected', async t => {
  const { brokerUrl, start, callback, requests } = await fixture(t);
  const invalid = await fetch(`${brokerUrl}/auth/auth?provider=github&site_id=evil.invalid`, { redirect: 'manual' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('location'), null);
  assert.equal((await fetch(`${brokerUrl}/auth/auth?provider=gitlab&site_id=portal.creangel.com`)).status, 400);
  assert.equal((await fetch(`${brokerUrl}/auth/auth?provider=github&site_id=portal.creangel.com`, { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await callback(await start(), '&state=duplicate')).status, 403);
  assert.equal(requests.length, 0);
});

test('health is public, methods are constrained and callback cancellation is handled', async t => {
  const { brokerUrl, start, requests } = await fixture(t);
  assert.deepEqual(await (await fetch(`${brokerUrl}/auth/health`)).json(), { status: 'ok' });
  assert.equal((await fetch(`${brokerUrl}/auth/auth`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${brokerUrl}/unknown`)).status, 404);
  const session = await start();
  const response = await fetch(`${brokerUrl}/auth/callback?error=access_denied&state=${session.state}`, { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 403);
  assert.equal(requests.length, 0);
});
