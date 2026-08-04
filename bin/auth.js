import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_API_BASE_URL = 'https://api.lexmount.cn';

const CONNECT_SCOPE = ['browser:sessions', 'browser:actions'];
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 30 * 1000;

function normalizeHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  const isLoopback =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '[::1]' ||
    parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error(`${label} must use https (http is allowed only for loopback)`);
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function oneLine(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && !/[\r\n]/.test(normalized) ? normalized : undefined;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEnvFile(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );
    if (!match || match[1].startsWith('#')) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function readLocalEnv(cwd) {
  const values = {};
  const loaded = [];
  for (const name of ['.env', '.env.local']) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) continue;
    Object.assign(values, parseEnvFile(readFileSync(filePath, 'utf8')));
    loaded.push(name);
  }
  return loaded.length > 0 ? { names: loaded, values } : undefined;
}

function browserCliCredentialsPath(env, homeDirectory) {
  if (oneLine(env.LEXMOUNT_BROWSER_CREDENTIALS_FILE)) {
    return path.resolve(env.LEXMOUNT_BROWSER_CREDENTIALS_FILE);
  }
  const configRoot = oneLine(env.XDG_CONFIG_HOME)
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(homeDirectory, '.config');
  return path.join(configRoot, 'lexmount', 'browser-cli', 'credentials.json');
}

function readBrowserCliCredentials(env, homeDirectory) {
  const filePath = browserCliCredentialsPath(env, homeDirectory);
  if (!existsSync(filePath)) return undefined;

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object' || data.kind !== 'api_key') {
    return undefined;
  }

  const apiKey = oneLine(data.api_key);
  const projectId = oneLine(data.project_id);
  if (!apiKey || !projectId) return undefined;

  return {
    apiKey,
    projectId,
    apiBaseUrl: oneLine(data.api_base_url),
    source: 'browser-cli credentials',
  };
}

function credentialPair(values, source) {
  const apiKey = oneLine(values.LEXMOUNT_API_KEY);
  const projectId = oneLine(values.LEXMOUNT_PROJECT_ID);
  if (!apiKey || !projectId) return undefined;
  return {
    apiKey,
    projectId,
    apiBaseUrl: oneLine(values.LEXMOUNT_BASE_URL),
    source,
  };
}

function sameBaseUrl(left, right) {
  return (
    normalizeHttpUrl(left, 'LEXMOUNT_BASE_URL') ===
    normalizeHttpUrl(right, 'LEXMOUNT_BASE_URL')
  );
}

export function discoverCredentials({
  cwd = process.cwd(),
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const localEnv = readLocalEnv(cwd);
  const explicitApiBaseUrl =
    oneLine(env.LEXMOUNT_BASE_URL) ||
    oneLine(localEnv?.values.LEXMOUNT_BASE_URL);

  const candidates = [
    credentialPair(env, 'environment'),
    localEnv
      ? credentialPair(localEnv.values, localEnv.names.join(' + '))
      : undefined,
    readBrowserCliCredentials(env, homeDirectory),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      explicitApiBaseUrl &&
      candidate.apiBaseUrl &&
      !sameBaseUrl(explicitApiBaseUrl, candidate.apiBaseUrl)
    ) {
      continue;
    }
    return {
      credentials: candidate,
      apiBaseUrl: normalizeHttpUrl(
        explicitApiBaseUrl || candidate.apiBaseUrl || DEFAULT_API_BASE_URL,
        'LEXMOUNT_BASE_URL'
      ),
    };
  }

  return {
    credentials: undefined,
    apiBaseUrl: normalizeHttpUrl(
      explicitApiBaseUrl || DEFAULT_API_BASE_URL,
      'LEXMOUNT_BASE_URL'
    ),
  };
}

export function resolveConnectBaseUrl(apiBaseUrl, override) {
  if (override) {
    return normalizeHttpUrl(override, '--connect-base-url');
  }

  const parsed = new URL(normalizeHttpUrl(apiBaseUrl, 'LEXMOUNT_BASE_URL'));
  if (parsed.hostname.startsWith('apitest.')) {
    parsed.hostname = `test.${parsed.hostname.slice('apitest.'.length)}`;
  } else if (parsed.hostname.startsWith('api.')) {
    parsed.hostname = `browser.${parsed.hostname.slice('api.'.length)}`;
  } else {
    throw new Error(
      `Cannot infer the Lexmount console from ${parsed.origin}. Set --connect-base-url explicitly.`
    );
  }
  parsed.port = '';
  parsed.pathname = '';
  return parsed.origin;
}

function pkceVerifier() {
  return randomBytes(48).toString('base64url');
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sendCallbackPage(response, status, title, message) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<main style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>${title}</h1><p>${message}</p></main>`
  );
}

function createCallbackServer(expectedState) {
  let settle;
  const callback = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/callback') {
      sendCallbackPage(response, 404, 'Not found', 'This callback path is not valid.');
      return;
    }

    const state = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    const authError = requestUrl.searchParams.get('error');
    if (state !== expectedState) {
      sendCallbackPage(
        response,
        400,
        'Authorization failed',
        'The callback state did not match. Return to your terminal and try again.'
      );
      settle.reject(new Error('Authorization callback state did not match'));
      return;
    }
    if (authError || !code) {
      sendCallbackPage(
        response,
        400,
        'Authorization canceled',
        'No credential was issued. Return to your terminal to retry.'
      );
      settle.reject(new Error('Authorization was canceled or did not return a code'));
      return;
    }

    sendCallbackPage(
      response,
      200,
      'Lexmount authorization received',
      'The credential exchange is finishing in your terminal. You can close this window.'
    );
    settle.resolve(code);
  });

  return { server, callback };
}

export function openExternalUrl(url) {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

function extractCredential(payload) {
  const candidates = [payload?.credential, payload?.env, payload];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const apiKey = oneLine(
      candidate.api_key ?? candidate.apiKey ?? candidate.LEXMOUNT_API_KEY
    );
    const projectId = oneLine(
      candidate.project_id ??
        candidate.projectId ??
        candidate.LEXMOUNT_PROJECT_ID
    );
    const apiBaseUrl = oneLine(
      candidate.api_base_url ??
        candidate.apiBaseUrl ??
        candidate.LEXMOUNT_BASE_URL ??
        payload?.api_base_url
    );
    if (apiKey && projectId) {
      return { apiKey, projectId, apiBaseUrl };
    }
  }
  return undefined;
}

async function exchangeCode({
  connectBaseUrl,
  code,
  verifier,
  redirectUri,
  fetchImpl,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${connectBaseUrl}/api/connect/codex/exchange`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
        signal: controller.signal,
      }
    );
    const payload = await response.json().catch(() => undefined);
    const credentials = extractCredential(payload);
    if (!response.ok || !credentials) {
      throw new Error('Lexmount credential exchange failed');
    }
    return credentials;
  } finally {
    clearTimeout(timeout);
  }
}

export async function authorizeWithBrowser({
  apiBaseUrl,
  connectBaseUrl,
  openUrl = openExternalUrl,
  fetchImpl = fetch,
  timeoutMs = AUTH_TIMEOUT_MS,
  onManualUrl = () => {},
} = {}) {
  const normalizedApiBaseUrl = normalizeHttpUrl(
    apiBaseUrl || DEFAULT_API_BASE_URL,
    'LEXMOUNT_BASE_URL'
  );
  const normalizedConnectBaseUrl = resolveConnectBaseUrl(
    normalizedApiBaseUrl,
    connectBaseUrl
  );
  const verifier = pkceVerifier();
  const state = randomBytes(32).toString('base64url');
  const { server, callback } = createCallbackServer(state);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to start the local authorization callback');
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const connectUrl = new URL('/connect/codex', `${normalizedConnectBaseUrl}/`);
  connectUrl.searchParams.set('source', 'create-lexmount-app');
  connectUrl.searchParams.set('intent', 'scaffold-browser-example');
  connectUrl.searchParams.set('response', 'code');
  connectUrl.searchParams.set('expires_in', '7d');
  connectUrl.searchParams.set('scope', CONNECT_SCOPE.join(' '));
  connectUrl.searchParams.set('client_name', 'create-lexmount-app');
  connectUrl.searchParams.set('redirect_uri', redirectUri);
  connectUrl.searchParams.set('state', state);
  connectUrl.searchParams.set('code_challenge', pkceChallenge(verifier));
  connectUrl.searchParams.set('code_challenge_method', 'S256');

  const timeout = setTimeout(() => {
    server.close();
  }, timeoutMs);

  try {
    const opened = await openUrl(connectUrl.toString());
    if (!opened) onManualUrl(connectUrl.toString());

    let callbackTimeout;
    const timeoutPromise = new Promise((_, reject) => {
      callbackTimeout = setTimeout(
        () => reject(new Error('Timed out waiting for Lexmount authorization')),
        timeoutMs
      );
    });
    let code;
    try {
      code = await Promise.race([callback, timeoutPromise]);
    } finally {
      clearTimeout(callbackTimeout);
    }
    const credentials = await exchangeCode({
      connectBaseUrl: normalizedConnectBaseUrl,
      code,
      verifier,
      redirectUri,
      fetchImpl,
    });
    const exchangedBaseUrl = normalizeHttpUrl(
      credentials.apiBaseUrl || normalizedApiBaseUrl,
      'exchanged LEXMOUNT_BASE_URL'
    );
    if (!sameBaseUrl(exchangedBaseUrl, normalizedApiBaseUrl)) {
      throw new Error(
        'Lexmount authorization returned credentials for a different API environment'
      );
    }
    return {
      ...credentials,
      apiBaseUrl: exchangedBaseUrl,
      source: 'Lexmount browser authorization',
    };
  } finally {
    clearTimeout(timeout);
    await new Promise((resolve) => server.close(resolve));
  }
}

function replaceEnvValue(contents, name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single-line value`);
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.replace(/\s*$/, '')}\n${line}\n`;
}

export function writeProjectEnv(destination, credentials) {
  const examplePath = path.join(destination, '.env.example');
  const envPath = path.join(destination, '.env');
  let contents = existsSync(examplePath)
    ? readFileSync(examplePath, 'utf8')
    : '';
  contents = replaceEnvValue(contents, 'LEXMOUNT_API_KEY', credentials.apiKey);
  contents = replaceEnvValue(
    contents,
    'LEXMOUNT_PROJECT_ID',
    credentials.projectId
  );
  contents = replaceEnvValue(
    contents,
    'LEXMOUNT_BASE_URL',
    credentials.apiBaseUrl || DEFAULT_API_BASE_URL
  );
  writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(envPath, 0o600);
  return envPath;
}
