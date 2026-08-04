import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount } from 'lexmount';
import { chromium, type Browser } from 'playwright';

config({ override: false });

type ScreenshotResult = {
  title: string;
  final_url: string;
  screenshot: string;
};

function requiredInput(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      `${name} is required. Pass it on the command line or configure it in .env.`
    );
  }
  return normalized;
}

function validateTargetUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Target URL must use http or https.');
  }
  return url.toString();
}

async function captureScreenshot(): Promise<ScreenshotResult> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const targetUrl = validateTargetUrl(
    requiredInput(values.url ?? process.env.TARGET_URL, '--url / TARGET_URL')
  );
  const artifactsDirectory = path.resolve(
    process.cwd(),
    process.env.ARTIFACTS_DIR ?? 'artifacts'
  );
  const screenshotPath = path.join(artifactsDirectory, 'screenshot.png');
  await mkdir(artifactsDirectory, { recursive: true });

  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});
  const session = await client.sessions.create({
    browserMode: 'normal',
  });
  console.log(`Inspect URL: ${session.inspectUrl}`);
  let browser: Browser | undefined;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const title = await page.title();
    const finalUrl = page.url();

    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    return {
      title,
      final_url: finalUrl,
      screenshot: path.relative(process.cwd(), screenshotPath),
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await session.close().catch(() => undefined);
    client.close();
  }
}

captureScreenshot()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Screenshot failed: ${message}`);
    process.exitCode = 1;
  });
