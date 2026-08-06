import { readFile } from 'node:fs/promises';

export const DEFAULT_STEP_TIMEOUT_MS = 30_000;
export const MAX_CHECK_COUNT = 100;

export type MatchMode = 'equals' | 'contains';

export type GotoCheck = {
  action: 'goto';
  url?: string;
};

export type ClickCheck = {
  action: 'click';
  selector: string;
};

export type FillCheck = {
  action: 'fill';
  selector: string;
  value: string;
};

export type ExpectTitleCheck = {
  action: 'expectTitle';
  value: string;
  match: MatchMode;
};

export type ExpectTextCheck = {
  action: 'expectText';
  selector: string;
  value: string;
  match: MatchMode;
};

export type ExpectUrlCheck = {
  action: 'expectUrl';
  value: string;
  match: MatchMode;
};

export type WebCheck =
  | GotoCheck
  | ClickCheck
  | FillCheck
  | ExpectTitleCheck
  | ExpectTextCheck
  | ExpectUrlCheck;

export type CheckPlan = {
  name: string;
  url: string;
  timeout_ms: number;
  checks: WebCheck[];
};

export async function loadCheckPlan(inputPath: string): Promise<CheckPlan> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read checks JSON at ${inputPath}: ${message}`);
  }
  return parseCheckPlan(parsed);
}

export function parseCheckPlan(value: unknown): CheckPlan {
  const input = plainObject(value, 'The checks file');
  rejectUnknownKeys(input, ['name', 'url', 'timeout_ms', 'checks'], 'checks file');

  const url = httpUrl(requiredString(input.url, 'url'), 'url');
  const name = optionalString(input.name, 'name') ?? 'web-check';
  const timeoutMs = optionalInteger(input.timeout_ms, 'timeout_ms') ?? DEFAULT_STEP_TIMEOUT_MS;
  if (timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error('timeout_ms must be an integer from 1000 through 300000.');
  }
  if (!Array.isArray(input.checks) || input.checks.length === 0) {
    throw new Error('checks must be a non-empty array.');
  }
  if (input.checks.length > MAX_CHECK_COUNT) {
    throw new Error(`checks cannot contain more than ${MAX_CHECK_COUNT} items.`);
  }

  return {
    name,
    url,
    timeout_ms: timeoutMs,
    checks: input.checks.map((check, index) => parseCheck(check, index)),
  };
}

function parseCheck(value: unknown, index: number): WebCheck {
  const label = `checks[${index}]`;
  const check = plainObject(value, label);
  const action = requiredString(check.action, `${label}.action`);

  switch (action) {
    case 'goto': {
      rejectUnknownKeys(check, ['action', 'url'], label);
      const url = optionalString(check.url, `${label}.url`);
      return url ? { action, url: httpUrl(url, `${label}.url`) } : { action };
    }
    case 'click':
      rejectUnknownKeys(check, ['action', 'selector'], label);
      return { action, selector: requiredString(check.selector, `${label}.selector`) };
    case 'fill':
      rejectUnknownKeys(check, ['action', 'selector', 'value'], label);
      return {
        action,
        selector: requiredString(check.selector, `${label}.selector`),
        value: stringValue(check.value, `${label}.value`),
      };
    case 'expectTitle':
      rejectUnknownKeys(check, ['action', 'value', 'match'], label);
      return {
        action,
        value: requiredString(check.value, `${label}.value`),
        match: matchMode(check.match, label),
      };
    case 'expectText':
      rejectUnknownKeys(check, ['action', 'selector', 'value', 'match'], label);
      return {
        action,
        selector: optionalString(check.selector, `${label}.selector`) ?? 'body',
        value: requiredString(check.value, `${label}.value`),
        match: matchMode(check.match, label),
      };
    case 'expectUrl':
      rejectUnknownKeys(check, ['action', 'value', 'match'], label);
      return {
        action,
        value: requiredString(check.value, `${label}.value`),
        match: matchMode(check.match, label),
      };
    default:
      throw new Error(
        `${label}.action must be one of goto, click, fill, expectTitle, expectText, or expectUrl.`
      );
  }
}

function matchMode(value: unknown, label: string): MatchMode {
  if (value === undefined) return 'contains';
  if (value === 'equals' || value === 'contains') return value;
  throw new Error(`${label}.match must be "equals" or "contains".`);
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unknown.join(', ')}.`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  const normalized = stringValue(value, label).trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  return value as number;
}

function httpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http or https.`);
  }
  return url.toString();
}
