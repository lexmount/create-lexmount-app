import { readFile } from 'node:fs/promises';

export type RoleLocatorRule = {
  by: 'role';
  role: string;
  name?: string;
  exact?: boolean;
};

export type NamedLocatorRule = {
  by: 'label' | 'text';
  value: string;
  exact?: boolean;
};

export type CssLocatorRule = {
  by: 'css';
  value: string;
};

export type LocatorRule =
  | RoleLocatorRule
  | NamedLocatorRule
  | CssLocatorRule;

export type WaitRule =
  | {
      type: 'url';
      value: string;
      match: 'contains' | 'exact';
    }
  | {
      type: 'visible';
      locator: LocatorRule;
    }
  | {
      type: 'networkidle';
    };

export type SearchConfig = {
  name: string;
  start_url: string;
  default_query?: string;
  default_limit: number;
  timeout_ms: number;
  search: {
    input: LocatorRule;
    submit: LocatorRule;
  };
  waits: WaitRule[];
  results: {
    item: LocatorRule;
    title: LocatorRule;
    link: LocatorRule;
    summary?: LocatorRule;
  };
};

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be a JSON object.`);
  }
  return value as JsonObject;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return stringAt(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function integerInRange(
  value: unknown,
  path: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

export function parseLocatorRule(value: unknown, path: string): LocatorRule {
  const object = objectAt(value, path);
  const by = stringAt(object.by, `${path}.by`);

  if (by === 'role') {
    return {
      by,
      role: stringAt(object.role, `${path}.role`),
      name: optionalString(object.name, `${path}.name`),
      exact: optionalBoolean(object.exact, `${path}.exact`),
    };
  }

  if (by === 'label' || by === 'text') {
    return {
      by,
      value: stringAt(object.value, `${path}.value`),
      exact: optionalBoolean(object.exact, `${path}.exact`),
    };
  }

  if (by === 'css') {
    return {
      by,
      value: stringAt(object.value, `${path}.value`),
    };
  }

  throw new Error(`${path}.by must be role, label, text, or css.`);
}

function parseWaitRule(value: unknown, path: string): WaitRule {
  const object = objectAt(value, path);
  const type = stringAt(object.type, `${path}.type`);

  if (type === 'url') {
    const match = object.match ?? 'contains';
    if (match !== 'contains' && match !== 'exact') {
      throw new Error(`${path}.match must be contains or exact.`);
    }
    return {
      type,
      value: stringAt(object.value, `${path}.value`),
      match,
    };
  }

  if (type === 'visible') {
    return {
      type,
      locator: parseLocatorRule(object.locator, `${path}.locator`),
    };
  }

  if (type === 'networkidle') {
    return { type };
  }

  throw new Error(`${path}.type must be url, visible, or networkidle.`);
}

export function parseSearchConfig(value: unknown): SearchConfig {
  const object = objectAt(value, 'config');
  const startUrl = stringAt(object.start_url, 'config.start_url');
  const parsedUrl = new URL(startUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('config.start_url must use http or https.');
  }

  const search = objectAt(object.search, 'config.search');
  const results = objectAt(object.results, 'config.results');
  if (!Array.isArray(object.waits)) {
    throw new Error('config.waits must be an array.');
  }

  return {
    name: stringAt(object.name, 'config.name'),
    start_url: parsedUrl.toString(),
    default_query: optionalString(object.default_query, 'config.default_query'),
    default_limit: integerInRange(
      object.default_limit,
      'config.default_limit',
      5,
      1,
      50
    ),
    timeout_ms: integerInRange(
      object.timeout_ms,
      'config.timeout_ms',
      60_000,
      1_000,
      120_000
    ),
    search: {
      input: parseLocatorRule(search.input, 'config.search.input'),
      submit: parseLocatorRule(search.submit, 'config.search.submit'),
    },
    waits: object.waits.map((wait, index) =>
      parseWaitRule(wait, `config.waits[${index}]`)
    ),
    results: {
      item: parseLocatorRule(results.item, 'config.results.item'),
      title: parseLocatorRule(results.title, 'config.results.title'),
      link: parseLocatorRule(results.link, 'config.results.link'),
      summary:
        results.summary === undefined
          ? undefined
          : parseLocatorRule(results.summary, 'config.results.summary'),
    },
  };
}

export async function loadSearchConfig(configPath: string): Promise<SearchConfig> {
  const contents = await readFile(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${configPath}: ${message}`);
  }
  return parseSearchConfig(parsed);
}
