export const STATE_SCHEMA_VERSION = 1 as const;
export const STATE_CREATED_BY = 'persistent-login-state' as const;

export const DEFAULT_LOGIN_URL =
  'https://tdesign.tencent.com/starter/vue-next/login';
export const LOGIN_FORM_SELECTOR = 'form.login-password';
export const LOGIN_ACCOUNT_SELECTOR = `${LOGIN_FORM_SELECTOR} input[type="text"]`;
export const LOGIN_PASSWORD_SELECTOR = `${LOGIN_FORM_SELECTOR} input[type="password"]`;
export const LOGIN_SUBMIT_SELECTOR = `${LOGIN_FORM_SELECTOR} button[type="submit"]`;
export const LOGIN_SUCCESS_PATHNAME = '/starter/vue-next/dashboard/base';
export const LOGIN_SUCCESS_SELECTOR = '.dashboard-item';
export const DEFAULT_LOGIN_TIMEOUT_SECONDS = 60;

export type StoredContextState = {
  schema_version: typeof STATE_SCHEMA_VERSION;
  created_by: typeof STATE_CREATED_BY;
  context_id: string;
  target_url: string;
  origin: string;
  created_at: string;
};

export function validateTargetUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Target URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Target URL must not contain credentials.');
  }
  return url;
}

export function resolveLoginTimeoutSeconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LOGIN_TIMEOUT_SECONDS;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('LOGIN_TIMEOUT_SECONDS must be a whole number.');
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 10 || parsed > 300) {
    throw new Error('LOGIN_TIMEOUT_SECONDS must be between 10 and 300.');
  }
  return parsed;
}

export function isExpectedDashboardUrl(
  value: string | URL,
  expectedOrigin: string
): boolean {
  const url = value instanceof URL ? value : validateTargetUrl(value);
  return url.origin === expectedOrigin && url.pathname === LOGIN_SUCCESS_PATHNAME;
}

export function assertExpectedDashboardUrl(
  value: string | URL,
  expectedOrigin: string
): URL {
  const url = value instanceof URL ? value : validateTargetUrl(value);
  if (!isExpectedDashboardUrl(url, expectedOrigin)) {
    throw new Error(
      `Expected the TDesign dashboard at ${expectedOrigin}${LOGIN_SUCCESS_PATHNAME}, received ${url.origin}${url.pathname}.`
    );
  }
  return url;
}

export function parseStoredContextState(value: unknown): StoredContextState {
  if (!value || typeof value !== 'object') {
    throw new Error('State file must contain a JSON object.');
  }

  const candidate = value as Partial<StoredContextState>;
  if (candidate.schema_version !== STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported state schema version: ${String(candidate.schema_version)}`);
  }
  if (candidate.created_by !== STATE_CREATED_BY) {
    throw new Error('State file was not created by this project.');
  }
  if (typeof candidate.context_id !== 'string' || !candidate.context_id.trim()) {
    throw new Error('State file is missing context_id.');
  }
  if (typeof candidate.target_url !== 'string') {
    throw new Error('State file is missing target_url.');
  }
  if (typeof candidate.origin !== 'string') {
    throw new Error('State file is missing origin.');
  }
  if (typeof candidate.created_at !== 'string' || Number.isNaN(Date.parse(candidate.created_at))) {
    throw new Error('State file has an invalid created_at timestamp.');
  }

  const targetUrl = validateTargetUrl(candidate.target_url);
  const originUrl = validateTargetUrl(candidate.origin);
  if (originUrl.origin !== candidate.origin || originUrl.pathname !== '/') {
    throw new Error('State file origin must be a normalized URL origin.');
  }
  if (targetUrl.origin !== candidate.origin) {
    throw new Error('State file target_url and origin do not match.');
  }

  return {
    schema_version: STATE_SCHEMA_VERSION,
    created_by: STATE_CREATED_BY,
    context_id: candidate.context_id,
    target_url: targetUrl.toString(),
    origin: originUrl.origin,
    created_at: candidate.created_at,
  };
}
