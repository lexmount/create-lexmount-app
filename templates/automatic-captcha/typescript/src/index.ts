import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { type Browser, type Page, chromium } from 'playwright';

config({ path: '.env.local', override: false });
config({ override: false });

const demos = {
  form: {
    url: 'https://recaptcha-demo.appspot.com/recaptcha-v2-checkbox.php',
    submit: 'button[type="submit"]',
  },
  google: {
    url: 'https://www.google.com/recaptcha/api2/demo',
    submit: '#recaptcha-demo-submit',
  },
} as const;

type Demo = keyof typeof demos;
type TaskResult = {
  demo: Demo;
  url: string;
  status: 'running' | 'passed' | 'failed';
  stage: string;
  captcha_wait_ms?: number;
  fields_preserved?: boolean;
  success_text?: string;
  error?: string;
};

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    process.env.LEXMOUNT_API_KEY,
    process.env.LEXMOUNT_PROJECT_ID,
  ]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  // Playwright errors can include the authenticated CDP connection URL.
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/g, '[url]');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      demo: { type: 'string', default: 'form' },
      'timeout-seconds': { type: 'string', default: '180' },
      'official-proxy': { type: 'boolean', default: false },
      'output-dir': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    values.demo !== 'form' &&
    values.demo !== 'google' &&
    values.demo !== 'all'
  ) {
    throw new Error('--demo must be form, google, or all.');
  }
  const timeoutSeconds = Number(values['timeout-seconds']);
  if (
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 3600
  ) {
    throw new Error('--timeout-seconds must be an integer between 1 and 3600.');
  }
  for (const name of ['LEXMOUNT_API_KEY', 'LEXMOUNT_PROJECT_ID'] as const) {
    if (!process.env[name]?.trim() || process.env[name]?.startsWith('your_')) {
      throw new Error(`Set ${name} in .env before running the example.`);
    }
  }

  const selected: Demo[] =
    values.demo === 'all' ? ['form', 'google'] : [values.demo];
  const directory = path.resolve(
    values['output-dir'] ??
      path.join('artifacts', new Date().toISOString().replace(/[:.]/g, '-'))
  );
  await mkdir(directory, { recursive: true });
  const client = new Lexmount({
    region: process.env.LEXMOUNT_REGION?.trim() || undefined,
    timeout: 30_000,
    logLevel: 'SILENT',
  });
  const report = {
    template: 'automatic-captcha',
    started_at: new Date().toISOString(),
    api_host: new URL(client.baseUrl).host,
    enable_captcha: true,
    official_proxy: values['official-proxy'],
    session_id: undefined as string | undefined,
    status: 'failed' as 'passed' | 'failed',
    cleanup: 'no-session-returned',
    results: [] as TaskResult[],
    errors: [] as string[],
  };
  let session: SessionInfo | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    // Closing the page releases an active CAPTCHA wait, then finally deletes the Session.
    void page?.close().catch(() => undefined);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    console.error(
      'This example requires an eligible project with available CAPTCHA allowance.'
    );
    console.error(
      'Creating a Chromium Session with automatic CAPTCHA processing enabled...'
    );
    session = await client.sessions.create({
      browserMode: 'normal',
      enableCaptcha: true,
      officialProxy: values['official-proxy'],
      downloads: { enabled: false },
      recording: { persistent: false },
      windowSize: '1280,800',
      pollTimeoutMs: 120_000,
    });
    report.session_id = session.id;
    console.error(`Session created: ${session.id}`);
    if (interrupted) throw new Error('Run interrupted.');
    browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: 30_000,
    });
    const context = browser.contexts()[0];
    if (!context)
      throw new Error('The Session did not expose a browser context.');
    page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(30_000);
    await page.bringToFront();

    for (const demo of selected) {
      if (interrupted) throw new Error('Run interrupted.');
      const task: TaskResult = {
        demo,
        url: demos[demo].url,
        status: 'running',
        stage: 'open-page',
      };
      report.results.push(task);
      try {
        await runDemo(page, demo, timeoutSeconds * 1000, directory, task);
        task.status = 'passed';
      } catch (error) {
        task.status = 'failed';
        task.error = interrupted ? 'Run interrupted.' : safeError(error);
        await page
          .screenshot({
            path: path.join(directory, `${demo}-failed.png`),
            timeout: 5000,
          })
          .catch(() => undefined);
        throw error;
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.errors.push(interrupted ? 'Run interrupted.' : safeError(error));
  } finally {
    await browser
      ?.close()
      .catch((error) =>
        report.errors.push(`CDP disconnect: ${safeError(error)}`)
      );
    if (session) {
      try {
        // Use delete directly: Session.close() suppresses server errors in SDK 0.6.1.
        await client.sessions.delete({ sessionId: session.id });
        report.cleanup = 'session-deleted';
      } catch (error) {
        report.cleanup = 'delete-failed';
        report.errors.push(
          `Session cleanup failed: ${safeError(error)}. Stop the Session in the console.`
        );
      }
    }
    client.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (report.errors.length > 0) report.status = 'failed';
    await writeFile(
      path.join(directory, 'result.json'),
      `${JSON.stringify(report, null, 2)}\n`
    );
  }
  console.log(JSON.stringify(report, null, 2));
  console.error(`Artifacts: ${directory}`);
  if (report.status !== 'passed') process.exitCode = interrupted ? 130 : 1;
}

async function runDemo(
  page: Page,
  demo: Demo,
  timeoutMs: number,
  directory: string,
  task: TaskResult
): Promise<void> {
  console.error(`[${demo}] Opening the demo page.`);
  await page.goto(demos[demo].url, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  const inputA = 'Lexmount CAPTCHA demo';
  const inputB = 'Continue after verification';
  if (demo === 'form') {
    task.stage = 'fill-form';
    await page.locator('[name="ex-a"]').fill(inputA);
    await page.locator('[name="ex-b"]').fill(inputB);
  }
  // Google's other demo has disabled sample fields; only the Appspot form is editable.
  task.stage = 'load-captcha';
  const checkbox = page
    .frameLocator('iframe[title="reCAPTCHA"]')
    .getByRole('checkbox');
  await checkbox.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(directory, `${demo}-before.png`) });

  task.stage = 'activate-captcha';
  // Activate the widget normally. Lexmount handles any image challenge.
  if ((await checkbox.getAttribute('aria-checked')) !== 'true')
    await checkbox.click();
  task.stage = 'wait-captcha';
  const started = Date.now();
  const progress = setInterval(() => {
    console.error(
      `[${demo}] Waiting for CAPTCHA completion (${Math.round((Date.now() - started) / 1000)}s).`
    );
  }, 15_000);
  try {
    console.error(
      `[${demo}] Waiting for Lexmount to complete verification in this Session.`
    );
    await page.waitForFunction(
      () =>
        Boolean(
          document
            .querySelector<HTMLTextAreaElement>('[name="g-recaptcha-response"]')
            ?.value.trim()
        ),
      undefined,
      { timeout: timeoutMs }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `CAPTCHA did not complete within ${timeoutMs / 1000}s. Check project eligibility, remaining CAPTCHA allowance, and service status. A timeout does not prove the service started processing.`
      );
    }
    throw error;
  } finally {
    clearInterval(progress);
    task.captcha_wait_ms = Date.now() - started;
  }

  task.stage = 'verify-form-state';
  if (demo === 'form') {
    task.fields_preserved =
      (await page.locator('[name="ex-a"]').inputValue()) === inputA &&
      (await page.locator('[name="ex-b"]').inputValue()) === inputB;
    if (!task.fields_preserved)
      throw new Error('Form values changed while waiting for verification.');
  }
  task.stage = 'submit-form';
  console.error(
    `[${demo}] Verification response received. Submitting the form.`
  );
  await page.locator(demos[demo].submit).click();
  task.stage = 'confirm-server-acceptance';
  // A token or checked box alone is not success: require the website's response.
  const success = page.getByText(
    demo === 'form' ? /^Success!$/ : /Verification Success/i
  );
  await success.waitFor({ state: 'visible', timeout: 30_000 });
  task.success_text = await success.innerText();
  await page.screenshot({ path: path.join(directory, `${demo}-success.png`) });
  task.stage = 'completed';
  console.error(`[${demo}] The website accepted the form in the same Session.`);
}

main().catch((error: unknown) => {
  console.error(`Automatic CAPTCHA example failed: ${safeError(error)}`);
  process.exitCode = 1;
});
