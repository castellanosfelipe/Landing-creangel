import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const COOKIE = '__Host-creangel-oauth';
const SESSION_TTL = 10 * 60 * 1000;
const MAX_SESSIONS = 256;
const GITHUB = Object.freeze({
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  api: 'https://api.github.com',
});

export function loadConfiguration(env = process.env) {
  const site = new URL(env.PUBLIC_SITE_URL || 'https://portal.creangel.com');
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/') {
    throw new Error('PUBLIC_SITE_URL must be an HTTPS origin without a path.');
  }
  const allowedUsers = [...new Set((env.CMS_ALLOWED_USERS || 'castellanosfelipe').split(',').map(value => value.trim().toLowerCase()))];
  const repository = env.CONTENT_REPOSITORY || 'castellanosfelipe/Landing-creangel';
  if (!allowedUsers.length || allowedUsers.some(value => !/^[a-z0-9][a-z0-9-]{0,38}$/.test(value))) throw new Error('Invalid CMS_ALLOWED_USERS.');
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(repository)) throw new Error('Invalid CONTENT_REPOSITORY.');
  if (!/^[a-zA-Z0-9._-]+$/.test(env.GITHUB_CLIENT_ID || '')) throw new Error('GITHUB_CLIENT_ID is required.');
  if (!env.GITHUB_CLIENT_SECRET_FILE) throw new Error('GITHUB_CLIENT_SECRET_FILE is required.');
  let secret;
  try { secret = readFileSync(env.GITHUB_CLIENT_SECRET_FILE, 'utf8').trim(); }
  catch { throw new Error('Cannot read the GitHub OAuth secret file.'); }
  if (!secret || secret.length > 1024) throw new Error('The GitHub OAuth secret file is empty or invalid.');
  return Object.freeze({ origin: site.origin, allowedUsers: Object.freeze(allowedUsers), repository, clientId: env.GITHUB_CLIENT_ID, clientSecret: secret });
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieId(req) {
  const values = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function scriptLiteral(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function complete(res, origin, status, value) {
  const nonce = randomBytes(24).toString('base64');
  const result = `authorization:github:${status === 200 ? 'success' : 'error'}:${JSON.stringify(value)}`;
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  // Exact two-step protocol used by Decap's official netlify-auth.js client.
  // Only the configured CMS origin and the actual opener can receive a token.
  res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso al editor de Creangel</title><body><p>${status === 200 ? 'Acceso autorizado. Puede regresar al editor.' : 'No se pudo autorizar el acceso. Cierre esta ventana e inténtelo nuevamente.'}</p><script nonce="${nonce}">
(() => {
  const origin = ${scriptLiteral(origin)};
  const opener = window.opener;
  if (!opener) return;
  const handshake = 'authorizing:github';
  const receive = event => {
    if (event.origin !== origin || event.source !== opener || event.data !== handshake) return;
    window.removeEventListener('message', receive);
    opener.postMessage(${scriptLiteral(result)}, origin);
  };
  window.addEventListener('message', receive);
  opener.postMessage(handshake, origin);
  window.setTimeout(() => window.removeEventListener('message', receive), 60000);
})();
</script></body></html>`);
}

// Dependency injection is limited to this module API for HTTP tests. Production
// always uses the fixed GitHub.com endpoints; no endpoint override environment exists.
export function createAuthServer(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const sessions = new Map();
  const redirectUri = `${config.origin}/auth/callback`;
  const apiHeaders = token => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Creangel-Decap-OAuth' });
  const cleanup = () => {
    for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id);
  };
  async function requestJson(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('Provider request failed.');
    const result = await response.json();
    if (!result || typeof result !== 'object') throw new Error('Provider response invalid.');
    return result;
  }
  async function revoke(token) {
    if (!token) return;
    try {
      await fetchImpl(`${GITHUB.api}/applications/${encodeURIComponent(config.clientId)}/token`, {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/json', 'User-Agent': 'Creangel-Decap-OAuth', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ access_token: token }),
      });
    } catch { /* No credentials or upstream error details are logged. */ }
  }
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    securityHeaders(res);
    try {
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin) return json(res, 400, { error: 'Invalid request.' });
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed.' });
      }
      if (url.pathname === '/auth/health') return json(res, 200, { status: 'ok' });
      if (url.pathname === '/auth/auth') {
        cleanup();
        const siteIds = url.searchParams.getAll('site_id');
        const providers = url.searchParams.getAll('provider');
        // site_id is the configured hostname used by Decap, never a redirect URL.
        if (providers.length !== 1 || providers[0] !== 'github' || siteIds.length !== 1 || siteIds[0] !== new URL(config.origin).hostname) return json(res, 400, { error: 'Invalid authentication provider or site.' });
        if (req.headers.origin && req.headers.origin !== config.origin) return json(res, 403, { error: 'Origin not allowed.' });
        const previous = cookieId(req);
        if (previous) sessions.delete(previous);
        if (sessions.size >= MAX_SESSIONS) return json(res, 429, { error: 'Try again later.' });
        const id = randomBytes(32).toString('base64url');
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        sessions.set(id, { state, verifier, expires: now() + SESSION_TTL });
        const authorize = new URL(GITHUB.authorize);
        authorize.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, scope: 'public_repo', state, login: config.allowedUsers[0], allow_signup: 'false', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.setHeader('Set-Cookie', sessionCookie(id, SESSION_TTL / 1000));
        res.writeHead(302, { Location: authorize.href });
        return res.end();
      }
      if (url.pathname === '/auth/callback') {
        cleanup();
        const id = cookieId(req);
        const session = sessions.get(id);
        if (id) sessions.delete(id); // Consume before any asynchronous provider call.
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        const states = url.searchParams.getAll('state');
        if (!session || states.length !== 1 || !equal(states[0], session.state)) return complete(res, config.origin, 403, { message: 'La sesión de acceso venció o no es válida.' });
        const codes = url.searchParams.getAll('code');
        if (url.searchParams.has('error') || codes.length !== 1 || !codes[0] || codes[0].length > 1024) return complete(res, config.origin, 403, { message: 'La autorización fue cancelada o no es válida.' });
        let token;
        try {
          const grant = await requestJson(GITHUB.token, {
            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Creangel-Decap-OAuth' },
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code: codes[0], redirect_uri: redirectUri, code_verifier: session.verifier }).toString(),
          });
          if (grant.error || typeof grant.access_token !== 'string' || !/^[a-zA-Z0-9_-]{10,512}$/.test(grant.access_token) || String(grant.token_type).toLowerCase() !== 'bearer') throw new Error('Invalid token grant.');
          token = grant.access_token;
          const user = await requestJson(`${GITHUB.api}/user`, { headers: apiHeaders(token) });
          if (typeof user.login !== 'string' || !config.allowedUsers.includes(user.login.toLowerCase())) {
            await revoke(token);
            return complete(res, config.origin, 403, { message: 'Esta cuenta no está autorizada para editar el sitio.' });
          }
          const repository = await requestJson(`${GITHUB.api}/repos/${config.repository}`, { headers: apiHeaders(token) });
          if (String(repository.full_name).toLowerCase() !== config.repository.toLowerCase() || repository.permissions?.push !== true) {
            await revoke(token);
            return complete(res, config.origin, 403, { message: 'La cuenta no tiene permiso de escritura en el repositorio del sitio.' });
          }
          return complete(res, config.origin, 200, { token, provider: 'github' });
        } catch {
          await revoke(token);
          return complete(res, config.origin, 502, { message: 'No se pudo comprobar el acceso con GitHub. Inténtelo nuevamente.' });
        }
      }
      return json(res, 404, { error: 'Not found.' });
    } catch {
      if (!res.headersSent) return json(res, 400, { error: 'Invalid request.' });
      res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfiguration();
    const server = createAuthServer(config);
    server.listen(3000, '0.0.0.0', () => console.info('Creangel OAuth broker listening on port 3000.'));
    const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (error) {
    console.error(`OAuth configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}
