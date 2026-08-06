import path from 'node:path';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from 'playwright';
import { resolveDownloadSettings, type DownloadSettings } from './config.js';
import {
  buildControlledDownloadPage,
  createRunDirectoryName,
  saveDownloadArtifacts,
  waitForNewDownloads,
  type BrowserDownloadObservation,
  type DownloadSource,
} from './downloads.js';

loadEnv({ path: '.env.local', override: false });
loadEnv({ override: false });

const REMOTE_DOWNLOAD_PATH = '/config/Downloads';

type SessionPage = {
  session: SessionInfo;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
};

type CdpDownloadWillBegin = {
  guid: string;
  url: string;
  suggestedFilename: string;
};

type CdpDownloadProgress = {
  guid: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'inProgress' | 'completed' | 'canceled';
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Download files demo failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      demo: { type: 'boolean' },
      url: { type: 'string' },
      locator: { type: 'string' },
      output: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const settings = resolveDownloadSettings({
    controlledDemo: values.demo,
    targetUrl: values.url ?? process.env.TARGET_URL,
    downloadLocator: values.locator ?? process.env.DOWNLOAD_LOCATOR,
    outputDir: values.output ?? process.env.OUTPUT_DIR,
    timeoutMs: values['timeout-ms'] ?? process.env.DOWNLOAD_TIMEOUT_MS,
    pollIntervalMs:
      values['poll-interval-ms'] ?? process.env.DOWNLOAD_POLL_INTERVAL_MS,
  });
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});
  let sessionPage: SessionPage | undefined;

  try {
    sessionPage = await createDownloadSessionPage(client);
    console.error(`[created] session=${sessionPage.session.id}`);
    console.error(`[inspect] ${sessionPage.session.inspectUrl}`);

    const existing = await client.sessions.downloads.list(sessionPage.session.id);
    const existingIds = new Set(existing.downloads.map((download) => download.id));
    const source = await preparePage(sessionPage.page, settings);
    const locator = sessionPage.page.locator(settings.downloadLocator).first();
    await assertDownloadTarget(locator, settings.downloadLocator, settings.timeoutMs);

    console.error(`[click] locator=${JSON.stringify(settings.downloadLocator)}`);
    const browserDownload = await triggerAndWaitForBrowserDownload(
      sessionPage.cdp,
      () => locator.click(),
      settings.timeoutMs
    );
    console.error(
      `[remote-complete] file=${JSON.stringify(browserDownload.suggested_filename)} bytes=${browserDownload.received_bytes}`
    );

    const listed = await waitForNewDownloads(
      client.sessions.downloads,
      sessionPage.session.id,
      existingIds,
      settings.timeoutMs,
      settings.pollIntervalMs
    );
    const runOutputDir = path.join(settings.outputDir, createRunDirectoryName());
    const saved = await saveDownloadArtifacts({
      resource: client.sessions.downloads,
      sessionId: sessionPage.session.id,
      downloads: listed.downloads,
      outputDir: runOutputDir,
      source,
      browserDownload,
    });

    console.log(
      JSON.stringify(
        {
          template: 'download-files',
          session_id: sessionPage.session.id,
          inspect_url: sessionPage.session.inspectUrl,
          source,
          downloads: {
            count: saved.manifest.summary.download_count,
            total_size_bytes: saved.manifest.summary.total_size_bytes,
          },
          artifacts: {
            output_dir: saved.output_dir,
            files: saved.file_paths,
            archive: saved.archive_path,
            manifest: saved.manifest_path,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (sessionPage) await closeSessionPage(sessionPage);
    client.close();
  }
}

async function createDownloadSessionPage(client: Lexmount): Promise<SessionPage> {
  const session = await client.sessions.create({
    browserMode: 'normal',
    downloads: { enabled: true },
  });
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    // A remote Session can start with service-owned or transitional targets.
    // Use a fresh page so the task never depends on the first target's state.
    const page = await context.newPage();
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: REMOTE_DOWNLOAD_PATH,
      eventsEnabled: true,
    });
    return { session, browser, context, page, cdp };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await session.close().catch(() => undefined);
    throw error;
  }
}

async function preparePage(page: Page, settings: DownloadSettings): Promise<DownloadSource> {
  if (settings.targetUrl) {
    await page.goto(settings.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: settings.timeoutMs,
    });
    return {
      mode: 'target_url',
      requested_url: settings.targetUrl,
      final_url: page.url(),
      locator: settings.downloadLocator,
    };
  }

  await page.setContent(buildControlledDownloadPage(), {
    waitUntil: 'domcontentloaded',
    timeout: settings.timeoutMs,
  });
  return {
    mode: 'controlled_demo',
    requested_url: null,
    final_url: page.url(),
    locator: settings.downloadLocator,
  };
}

async function assertDownloadTarget(
  locator: Locator,
  locatorText: string,
  timeoutMs: number
): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw new Error(`No visible download target matched ${JSON.stringify(locatorText)}.`);
  }
  if (!(await locator.isEnabled())) {
    throw new Error(`Download target ${JSON.stringify(locatorText)} is disabled.`);
  }
}

async function triggerAndWaitForBrowserDownload(
  cdp: CDPSession,
  trigger: () => Promise<unknown>,
  timeoutMs: number
): Promise<BrowserDownloadObservation> {
  let started: CdpDownloadWillBegin | undefined;
  let settled = false;
  let resolveCompletion!: (value: BrowserDownloadObservation) => void;
  let rejectCompletion!: (error: Error) => void;

  const completion = new Promise<BrowserDownloadObservation>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const cleanup = (): void => {
    cdp.off('Browser.downloadWillBegin', onWillBegin);
    cdp.off('Browser.downloadProgress', onProgress);
    clearTimeout(timer);
  };
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const onWillBegin = (event: CdpDownloadWillBegin): void => {
    if (!started) started = event;
  };
  const onProgress = (event: CdpDownloadProgress): void => {
    if (!started || event.guid !== started.guid || event.state === 'inProgress') return;
    if (event.state === 'canceled') {
      finish(() => rejectCompletion(new Error('The remote browser canceled the download.')));
      return;
    }
    finish(() =>
      resolveCompletion({
        guid: started!.guid,
        suggested_filename: started!.suggestedFilename,
        source_url: started!.url,
        received_bytes: event.receivedBytes,
        total_bytes: event.totalBytes,
      })
    );
  };
  const timer = setTimeout(() => {
    finish(() =>
      rejectCompletion(
        new Error(`The remote browser did not complete a download within ${timeoutMs} ms.`)
      )
    );
  }, timeoutMs);

  cdp.on('Browser.downloadWillBegin', onWillBegin);
  cdp.on('Browser.downloadProgress', onProgress);

  try {
    await trigger();
  } catch (error) {
    finish(() =>
      rejectCompletion(error instanceof Error ? error : new Error(String(error)))
    );
  }
  return completion;
}

async function closeSessionPage(sessionPage: SessionPage): Promise<void> {
  await sessionPage.cdp.detach().catch(() => undefined);
  await sessionPage.browser.close().catch((error: unknown) => {
    console.error(`Browser cleanup warning: ${errorMessage(error)}`);
  });
  await sessionPage.session.close().catch((error: unknown) => {
    console.error(`Session cleanup warning: ${errorMessage(error)}`);
  });
  console.error(`[closed] session=${sessionPage.session.id}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
