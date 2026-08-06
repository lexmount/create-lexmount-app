import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser } from 'playwright';
import {
  loadUrls,
  parseConcurrency,
  parseNavigationTimeout,
} from './config.js';
import { allSettledWithConcurrency } from './concurrency.js';
import {
  aggregateResults,
  safeErrorMessage,
  UrlTaskError,
  type PageObservation,
  type SessionReport,
  type UrlFailure,
  type UrlSuccess,
} from './results.js';

loadEnv({ path: '.env.local', override: false });
loadEnv({ override: false });

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

main().catch((error: unknown) => {
  console.error(`Parallel browser run failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      concurrency: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const inputPath = path.resolve(
    values.input ??
      process.env.INPUT_PATH ??
      path.join(projectRoot, 'inputs', 'urls.json')
  );
  const outputPath = path.resolve(
    values.output ??
      process.env.OUTPUT_PATH ??
      path.join('artifacts', 'parallel-browser-results.json')
  );
  const concurrency = parseConcurrency(
    values.concurrency ?? process.env.CONCURRENCY
  );
  const timeoutMs = parseNavigationTimeout(
    values['timeout-ms'] ?? process.env.NAVIGATION_TIMEOUT_MS
  );
  const urls = await loadUrls(inputPath);
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});
  const startedAt = new Date().toISOString();

  try {
    const settled = await allSettledWithConcurrency(
      urls.map(
        (url, inputIndex) => () =>
          inspectOneUrl(client, url, inputIndex, timeoutMs)
      ),
      concurrency
    );
    const output = aggregateResults(settled, {
      urls,
      concurrency,
      startedAt,
      completedAt: new Date().toISOString(),
    });

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
    console.error(`Saved batch report to ${path.relative(process.cwd(), outputPath)}`);
    if (output.summary.failed > 0) process.exitCode = 1;
  } finally {
    client.close();
  }
}

async function inspectOneUrl(
  client: Lexmount,
  requestedUrl: string,
  inputIndex: number,
  timeoutMs: number
): Promise<UrlSuccess> {
  const started = Date.now();
  const report = initialSessionReport();
  let session: SessionInfo | undefined;
  let browser: Browser | undefined;
  let pageObservation: PageObservation | undefined;
  let taskError: string | undefined;
  let closeError: string | undefined;

  try {
    session = await client.sessions.create({ browserMode: 'normal' });
    report.session_id = session.id;
    report.inspect_url = session.inspectUrl;
    report.creation = { status: 'created', at: new Date().toISOString() };
    console.error(
      `[created] #${inputIndex + 1} session=${session.id} url=${requestedUrl}`
    );
    console.error(`[inspect] #${inputIndex + 1} ${session.inspectUrl}`);

    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const pageStarted = Date.now();
    const response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const h1 = page.locator('h1').first();
    const [title, h1Count] = await Promise.all([page.title(), h1.count()]);
    pageObservation = {
      status: response?.status() ?? null,
      title: normalizeText(title),
      h1: h1Count > 0 ? normalizeText(await h1.textContent()) || null : null,
      final_url: page.url(),
      page_elapsed_ms: Date.now() - pageStarted,
    };
    if (pageObservation.status !== null && pageObservation.status >= 400) {
      throw new Error(`Page returned HTTP ${pageObservation.status}.`);
    }
    report.completion = { status: 'completed', at: new Date().toISOString() };
    console.error(
      `[completed] #${inputIndex + 1} session=${session.id} status=${String(pageObservation.status)}`
    );
  } catch (error: unknown) {
    taskError = safeErrorMessage(error);
    if (session) {
      report.completion = {
        status: 'failed',
        at: new Date().toISOString(),
        error: taskError,
      };
    } else {
      report.creation = {
        status: 'failed',
        at: new Date().toISOString(),
        error: taskError,
      };
      report.completion = { status: 'skipped', at: null };
      report.closure = { status: 'not_required', at: null };
    }
  } finally {
    await browser?.close().catch((error: unknown) => {
      console.error(
        `[browser-warning] #${inputIndex + 1} ${safeErrorMessage(error)}`
      );
    });
    if (session) {
      try {
        await client.sessions.delete({ sessionId: session.id });
        report.closure = { status: 'closed', at: new Date().toISOString() };
        console.error(`[closed] #${inputIndex + 1} session=${session.id}`);
      } catch (error: unknown) {
        closeError = safeErrorMessage(error);
        report.closure = {
          status: 'failed',
          at: new Date().toISOString(),
          error: closeError,
        };
        console.error(
          `[close-failed] #${inputIndex + 1} session=${session.id}: ${closeError}`
        );
      }
    }
  }

  const elapsedMs = Date.now() - started;
  if (taskError || closeError || !pageObservation) {
    const errors = [taskError, closeError && `Session close failed: ${closeError}`]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    const failure: UrlFailure = {
      input_index: inputIndex,
      requested_url: requestedUrl,
      elapsed_ms: elapsedMs,
      error: errors || 'The page task did not produce a result.',
      session: report,
      ...(pageObservation ? { page: pageObservation } : {}),
    };
    throw new UrlTaskError(failure);
  }

  return {
    input_index: inputIndex,
    requested_url: requestedUrl,
    elapsed_ms: elapsedMs,
    session: report,
    page: pageObservation,
  };
}

function initialSessionReport(): SessionReport {
  return {
    session_id: null,
    inspect_url: null,
    creation: { status: 'pending', at: null },
    completion: { status: 'pending', at: null },
    closure: { status: 'pending', at: null },
  };
}

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
