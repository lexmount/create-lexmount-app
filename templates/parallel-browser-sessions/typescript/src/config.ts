import { readFile } from 'node:fs/promises';

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000;
export const MAX_CONCURRENCY = 20;
export const MAX_URLS = 100;

export function parseConcurrency(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_CONCURRENCY;
  return parseBoundedInteger(value, 'CONCURRENCY', 1, MAX_CONCURRENCY);
}

export function parseNavigationTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_NAVIGATION_TIMEOUT_MS;
  }
  return parseBoundedInteger(value, 'NAVIGATION_TIMEOUT_MS', 1_000, 300_000);
}

export function parseUrlInput(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.urls)) {
    throw new Error('Input must be a JSON object with a urls array.');
  }
  if (value.urls.length === 0) {
    throw new Error('Input urls must contain at least one URL.');
  }
  if (value.urls.length > MAX_URLS) {
    throw new Error(`Input urls cannot contain more than ${MAX_URLS} URLs.`);
  }

  return value.urls.map((candidate, index) => {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      throw new Error(`Input urls[${index}] must be a non-empty string.`);
    }
    let url: URL;
    try {
      url = new URL(candidate.trim());
    } catch {
      throw new Error(`Input urls[${index}] is not a valid URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Input urls[${index}] must use http or https.`);
    }
    return url.toString();
  });
}

export async function loadUrls(inputPath: string): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read URL input ${inputPath}: ${message}`);
  }
  return parseUrlInput(parsed);
}

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
