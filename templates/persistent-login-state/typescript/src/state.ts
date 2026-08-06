export const STATE_SCHEMA_VERSION = 1 as const;
export const STATE_CREATED_BY = 'persistent-login-state' as const;
export const DEMO_COOKIE_NAME = 'lexmount_demo_session';
export const DEMO_COOKIE_VALUE = 'authenticated';
export const DEMO_COOKIE_TTL_SECONDS = 24 * 60 * 60;
export const DEMO_STORAGE_KEY = 'lexmount.demo.authenticated';
export const DEMO_STORAGE_VALUE = 'true';

export type StoredContextState = {
  schema_version: typeof STATE_SCHEMA_VERSION;
  created_by: typeof STATE_CREATED_BY;
  context_id: string;
  target_url: string;
  origin: string;
  created_at: string;
};

export type PersistedStateObservation = {
  cookie: string | null;
  local_storage: string | null;
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

export function assertPersistedState(observation: PersistedStateObservation): void {
  const failures: string[] = [];
  if (observation.cookie !== DEMO_COOKIE_VALUE) {
    failures.push(
      `cookie ${DEMO_COOKIE_NAME} expected ${JSON.stringify(DEMO_COOKIE_VALUE)}, got ${JSON.stringify(observation.cookie)}`
    );
  }
  if (observation.local_storage !== DEMO_STORAGE_VALUE) {
    failures.push(
      `localStorage ${DEMO_STORAGE_KEY} expected ${JSON.stringify(DEMO_STORAGE_VALUE)}, got ${JSON.stringify(observation.local_storage)}`
    );
  }
  if (failures.length > 0) {
    throw new Error(`Persistent state verification failed: ${failures.join('; ')}`);
  }
}
