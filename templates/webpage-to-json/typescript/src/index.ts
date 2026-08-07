import { parseArgs } from 'node:util';
import { config } from 'dotenv';

config({ override: false });

const DEFAULT_API_BASE_URL = 'https://api.lexmount.cn';
const DEFAULT_TARGET_URL = 'https://cn.vuejs.org/guide/introduction';
const REQUEST_TIMEOUT_MS = 60_000;

type JsonObject = Record<string, unknown>;

type StructuredPage = {
  request_id: unknown;
  url: unknown;
  final_url: unknown;
  status_code: unknown;
  title: unknown;
  description: unknown;
  main_text: unknown;
  author: unknown;
  publish_time: unknown;
  language: unknown;
  links: unknown;
  images: unknown;
  engine: unknown;
  dom_id: unknown;
  server_elapsed_ms: unknown;
};

function requiredInput(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required. Configure it in .env.`);
  }
  return normalized;
}

function validateHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  return url.toString();
}

function normalizeApiBaseUrl(value: string): string {
  return validateHttpUrl(value, 'LEXMOUNT_BASE_URL').replace(/\/+$/, '');
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function formatApiError(value: unknown): string {
  if (typeof value === 'string') return value;
  const error = asObject(value);
  if (error) {
    for (const key of ['message', 'detail', 'code']) {
      if (typeof error[key] === 'string') return error[key];
    }
  }
  return 'Unknown WebFetch error';
}

async function postWebFetch(
  endpoint: string,
  apiKey: string,
  projectId: string,
  targetUrl: string
): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint}/v1/extract`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Project-Id': projectId,
      },
      body: JSON.stringify({ extract: { url: targetUrl } }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error(`WebFetch returned non-JSON data (HTTP ${response.status}).`);
    }

    const responseObject = asObject(payload);
    if (!responseObject) {
      throw new Error('WebFetch returned an unexpected JSON response.');
    }
    if (!response.ok || responseObject.error) {
      const requestId = responseObject.request_id;
      const suffix = requestId ? ` Request ID: ${String(requestId)}.` : '';
      throw new Error(
        `WebFetch request failed (HTTP ${response.status}): ${formatApiError(
          responseObject.error
        )}.${suffix}`
      );
    }
    return responseObject;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`WebFetch request timed out after ${REQUEST_TIMEOUT_MS} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractPage(): Promise<StructuredPage> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const targetUrl = validateHttpUrl(
    values.url ?? process.env.TARGET_URL ?? DEFAULT_TARGET_URL,
    '--url / TARGET_URL'
  );
  const apiKey = requiredInput(process.env.LEXMOUNT_API_KEY, 'LEXMOUNT_API_KEY');
  const projectId = requiredInput(
    process.env.LEXMOUNT_PROJECT_ID,
    'LEXMOUNT_PROJECT_ID'
  );
  const apiBaseUrl = normalizeApiBaseUrl(
    process.env.LEXMOUNT_WEBFETCH_BASE_URL ??
      process.env.LEXMOUNT_BASE_URL ??
      DEFAULT_API_BASE_URL
  );

  const payload = await postWebFetch(apiBaseUrl, apiKey, projectId, targetUrl);
  const result = asObject(payload.result);
  if (!result) {
    throw new Error('WebFetch response did not contain a structured result.');
  }
  const metadata = asObject(payload.metadata) ?? {};

  return {
    request_id: payload.request_id ?? null,
    url: result.url ?? targetUrl,
    final_url: result.final_url ?? result.url ?? targetUrl,
    status_code: result.status_code ?? null,
    title: result.title ?? null,
    description: result.description ?? null,
    main_text: result.main_text ?? '',
    author: result.author ?? null,
    publish_time: result.publish_time ?? null,
    language: result.language ?? null,
    links: result.links ?? [],
    images: result.images ?? [],
    engine: result.engine ?? result.engine_name ?? null,
    dom_id: result.dom_id ?? metadata.dom_id ?? null,
    server_elapsed_ms: metadata.server_elapsed_ms ?? null,
  };
}

extractPage()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`WebFetch extraction failed: ${message}`);
    process.exitCode = 1;
  });
