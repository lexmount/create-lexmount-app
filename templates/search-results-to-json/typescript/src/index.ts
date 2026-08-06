import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { Lexmount } from 'lexmount';
import { chromium, type Browser, type Page } from 'playwright';
import {
  loadSearchConfig,
  type SearchConfig,
  type WaitRule,
} from './config.js';
import { locatorFor } from './locators.js';
import { fallbackSummary, normalizeText } from './text.js';

loadEnv({ override: false });

type SearchResult = {
  title: string;
  link: string;
  summary: string | null;
};

type SearchOutput = {
  session_id: string;
  final_url: string;
  query: string;
  requested_limit: number;
  result_count: number;
  elapsed_ms: number;
  results: SearchResult[];
};

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function requiredInput(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('--limit / RESULT_LIMIT must be an integer from 1 to 50.');
  }
  return parsed;
}

function sessionIdFrom(session: unknown): string {
  const record = session as Record<string, unknown>;
  const value = record.id ?? record.sessionId ?? record.session_id;
  if (typeof value !== 'string' || !value) {
    throw new Error('Lexmount did not return a Session ID.');
  }
  return value;
}

async function waitForUrl(
  page: Page,
  rule: Extract<WaitRule, { type: 'url' }>,
  timeout: number
): Promise<void> {
  await page.waitForURL(
    (url) =>
      rule.match === 'exact'
        ? url.toString() === rule.value
        : url.toString().includes(rule.value),
    { timeout }
  );
}

async function applyPostClickWaits(
  page: Page,
  config: SearchConfig
): Promise<void> {
  for (const rule of config.waits) {
    if (rule.type === 'url') continue;
    if (rule.type === 'visible') {
      await locatorFor(page, rule.locator)
        .first()
        .waitFor({ state: 'visible', timeout: config.timeout_ms });
      continue;
    }
    await page.waitForLoadState('networkidle', { timeout: config.timeout_ms });
  }
}

function absoluteUrl(href: string, currentUrl: string): string {
  try {
    return new URL(href, currentUrl).toString();
  } catch {
    return href;
  }
}

async function extractResults(
  page: Page,
  config: SearchConfig,
  limit: number
): Promise<SearchResult[]> {
  const items = locatorFor(page, config.results.item);
  const itemCount = Math.min(await items.count(), 200);
  const results: SearchResult[] = [];

  for (let index = 0; index < itemCount && results.length < limit; index += 1) {
    const item = items.nth(index);
    if (!(await item.isVisible())) continue;

    const titleLocator = locatorFor(item, config.results.title).first();
    const linkLocator = locatorFor(item, config.results.link).first();
    if ((await titleLocator.count()) === 0 || (await linkLocator.count()) === 0) {
      continue;
    }

    const title = normalizeText(await titleLocator.textContent());
    const href = normalizeText(await linkLocator.getAttribute('href'));
    if (!title || !href) continue;

    let summary: string | null = null;
    if (config.results.summary) {
      const summaryLocator = locatorFor(item, config.results.summary).first();
      if ((await summaryLocator.count()) > 0) {
        summary = normalizeText(await summaryLocator.textContent()) || null;
      }
    }
    summary ??= fallbackSummary(await item.innerText(), title);

    results.push({
      title,
      link: absoluteUrl(href, page.url()),
      summary,
    });
  }

  return results;
}

async function runSearch(): Promise<{ output: SearchOutput; outputPath: string }> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'string' },
      output: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const configPath = path.resolve(
    values.config ??
      process.env.SEARCH_CONFIG ??
      path.join(projectRoot, 'config', 'baidu.json')
  );
  const searchConfig = await loadSearchConfig(configPath);
  const query = requiredInput(
    values.query ?? process.env.SEARCH_QUERY ?? searchConfig.default_query,
    '--query / SEARCH_QUERY / config.default_query'
  );
  const limit = parseLimit(
    values.limit ?? process.env.RESULT_LIMIT,
    searchConfig.default_limit
  );
  const outputPath = path.resolve(
    values.output ?? process.env.OUTPUT_PATH ?? 'artifacts/search-results.json'
  );

  const startedAt = Date.now();
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});
  let session:
    | Awaited<ReturnType<typeof client.sessions.create>>
    | undefined;
  let browser: Browser | undefined;

  try {
    session = await client.sessions.create({ browserMode: 'normal' });
    console.error(`Inspect URL: ${session.inspectUrl}`);
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(searchConfig.start_url, {
      waitUntil: 'domcontentloaded',
      timeout: searchConfig.timeout_ms,
    });

    const input = locatorFor(page, searchConfig.search.input).first();
    await input.waitFor({ state: 'visible', timeout: searchConfig.timeout_ms });
    await input.fill(query);

    const urlWaits = searchConfig.waits
      .filter(
        (rule): rule is Extract<WaitRule, { type: 'url' }> =>
          rule.type === 'url'
      )
      .map((rule) => waitForUrl(page, rule, searchConfig.timeout_ms));
    const submit = locatorFor(page, searchConfig.search.submit).first();
    await Promise.all([
      ...urlWaits,
      submit.click({ timeout: searchConfig.timeout_ms }),
    ]);
    await applyPostClickWaits(page, searchConfig);

    const results = await extractResults(page, searchConfig, limit);
    if (results.length === 0) {
      throw new Error(
        `No results matched the locator rules in ${path.basename(configPath)}.`
      );
    }

    const output: SearchOutput = {
      session_id: sessionIdFrom(session),
      final_url: page.url(),
      query,
      requested_limit: limit,
      result_count: results.length,
      elapsed_ms: Date.now() - startedAt,
      results,
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return { output, outputPath };
  } finally {
    await browser?.close().catch((error: unknown) => {
      console.error(`Browser cleanup warning: ${String(error)}`);
    });
    await session?.close().catch((error: unknown) => {
      console.error(`Session cleanup warning: ${String(error)}`);
    });
    client.close();
  }
}

runSearch()
  .then(({ output, outputPath }) => {
    console.log(JSON.stringify(output, null, 2));
    console.error(`Saved results to ${path.relative(process.cwd(), outputPath)}`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Search failed: ${message}`);
    process.exitCode = 1;
  });
