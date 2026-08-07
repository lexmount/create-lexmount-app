export const DEFAULT_HANDOFF_TIMEOUT_SECONDS = 600;
export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_TARGET_URL =
  'https://gitee.com/login?redirect_to_url=%2Fdashboard%2Fprojects';
export const DEFAULT_SUCCESS_URL = 'https://gitee.com/dashboard/projects';
export const GITEE_LOGIN_FORM_SELECTOR =
  'form[action="/login"], #user_login, #user_password';
export const SUCCESS_STABILITY_MS = 750;

export type HandoffSettings = {
  timeout_seconds: number;
  poll_interval_ms: number;
  target_url: string;
  success_url: string;
};

export type HandoffTimeline = {
  session_created_at: string;
  paused_at: string;
  human_completed_at: string;
  resumed_at: string;
  completed_at: string;
};

export function resolveHandoffSettings(
  timeoutSeconds: string | undefined,
  pollIntervalMs: string | undefined,
  targetUrl: string | undefined,
  successUrl: string | undefined
): HandoffSettings {
  const normalizedTarget = validatePublicUrl(
    targetUrl ?? DEFAULT_TARGET_URL,
    '--url / TARGET_URL'
  );
  const normalizedSuccess = validatePublicUrl(
    successUrl ?? DEFAULT_SUCCESS_URL,
    '--success-url / SUCCESS_URL'
  );
  if (normalizedTarget.origin !== normalizedSuccess.origin) {
    throw new Error('TARGET_URL and SUCCESS_URL must use the same origin.');
  }

  return {
    timeout_seconds: parseIntegerInRange(
      timeoutSeconds,
      '--timeout-seconds / HANDOFF_TIMEOUT_SECONDS',
      DEFAULT_HANDOFF_TIMEOUT_SECONDS,
      10,
      3_600
    ),
    poll_interval_ms: parseIntegerInRange(
      pollIntervalMs,
      '--poll-interval-ms / POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
      100,
      5_000
    ),
    target_url: normalizedTarget.toString(),
    success_url: normalizedSuccess.toString(),
  };
}

export function isSuccessUrl(currentUrl: string, successUrl: string): boolean {
  const current = validatePublicUrl(currentUrl, 'Current page URL');
  const expected = validatePublicUrl(successUrl, 'SUCCESS_URL');
  return current.origin === expected.origin && current.pathname === expected.pathname;
}

export function isSuccessPageReady(
  currentUrl: string,
  successUrl: string,
  loginFormControlCount: number
): boolean {
  return loginFormControlCount === 0 && isSuccessUrl(currentUrl, successUrl);
}

export function safeUrlPath(value: string): string {
  const url = validatePublicUrl(value, 'Page URL');
  return `${url.origin}${url.pathname}`;
}

export function assertTimelineOrder(timeline: HandoffTimeline): void {
  const entries = Object.entries(timeline) as Array<
    [keyof HandoffTimeline, string]
  >;
  let previous = Number.NEGATIVE_INFINITY;
  for (const [name, value] of entries) {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      throw new Error(`${name} is not a valid timestamp.`);
    }
    if (timestamp < previous) {
      throw new Error(`${name} is earlier than the preceding handoff event.`);
    }
    previous = timestamp;
  }
}

export function durationBetween(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function parseIntegerInRange(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be a whole number.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function validatePublicUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use https.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials.`);
  }
  return url;
}
