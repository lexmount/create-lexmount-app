import path from 'node:path';

export const DEFAULT_DOWNLOAD_LOCATOR = '#download-csv';
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_DOWNLOAD_POLL_INTERVAL_MS = 1_000;

export type RawDownloadSettings = {
  controlledDemo?: boolean;
  targetUrl?: string;
  downloadLocator?: string;
  outputDir?: string;
  timeoutMs?: string;
  pollIntervalMs?: string;
};

export type DownloadSettings = {
  targetUrl: string | null;
  downloadLocator: string;
  outputDir: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export function resolveDownloadSettings(
  raw: RawDownloadSettings,
  cwd = process.cwd()
): DownloadSettings {
  const targetUrl = raw.controlledDemo
    ? null
    : optionalHttpUrl(raw.targetUrl, 'TARGET_URL / --url');
  const downloadLocator = optionalNonEmpty(
    raw.downloadLocator,
    'DOWNLOAD_LOCATOR / --locator'
  ) ?? DEFAULT_DOWNLOAD_LOCATOR;
  const outputDir = path.resolve(
    cwd,
    optionalNonEmpty(raw.outputDir, 'OUTPUT_DIR / --output') ??
      path.join('artifacts', 'downloads')
  );
  const timeoutMs = boundedInteger(
    raw.timeoutMs,
    'DOWNLOAD_TIMEOUT_MS / --timeout-ms',
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
    1_000,
    10 * 60_000
  );
  const pollIntervalMs = boundedInteger(
    raw.pollIntervalMs,
    'DOWNLOAD_POLL_INTERVAL_MS / --poll-interval-ms',
    DEFAULT_DOWNLOAD_POLL_INTERVAL_MS,
    100,
    30_000
  );

  if (pollIntervalMs >= timeoutMs) {
    throw new Error('DOWNLOAD_POLL_INTERVAL_MS must be smaller than DOWNLOAD_TIMEOUT_MS.');
  }

  return {
    targetUrl,
    downloadLocator,
    outputDir,
    timeoutMs,
    pollIntervalMs,
  };
}

function optionalNonEmpty(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} cannot be empty.`);
  return normalized;
}

function optionalHttpUrl(value: string | undefined, name: string): string | null {
  const normalized = optionalNonEmpty(value, name);
  if (normalized === undefined) return null;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  return url.toString();
}

function boundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
