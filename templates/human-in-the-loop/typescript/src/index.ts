import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser, type Page } from 'playwright';
import {
  assertTimelineOrder,
  durationBetween,
  GITEE_LOGIN_FORM_SELECTOR,
  isSuccessPageReady,
  isSuccessUrl,
  resolveHandoffSettings,
  safeUrlPath,
  SUCCESS_STABILITY_MS,
  type HandoffSettings,
  type HandoffTimeline,
} from './handoff.js';

config({ path: '.env.local', override: false });
config({ override: false });

type SessionPage = {
  session: SessionInfo;
  browser: Browser;
  page: Page;
};

type HandoffResult = {
  template: 'human-in-the-loop';
  session_id: string;
  session_preserved_during_handoff: true;
  human_action: {
    control: 'Complete login in Remote View';
    detected_by: 'stable success URL with login form absent';
  };
  timeline: HandoffTimeline;
  durations_ms: {
    waiting_for_human: number;
    resumed_work: number;
    total: number;
  };
  result: {
    authenticated: true;
    final_path: string;
    remaining_task_completed: true;
  };
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Human-in-the-loop demo failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'timeout-seconds': { type: 'string' },
      'poll-interval-ms': { type: 'string' },
      url: { type: 'string' },
      'success-url': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const settings = resolveHandoffSettings(
    values['timeout-seconds'] ?? process.env.HANDOFF_TIMEOUT_SECONDS,
    values['poll-interval-ms'] ?? process.env.POLL_INTERVAL_MS,
    values.url ?? process.env.TARGET_URL,
    values['success-url'] ?? process.env.SUCCESS_URL
  );
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});

  try {
    const result = await runHandoffDemo(
      client,
      settings
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }
}

async function runHandoffDemo(
  client: Lexmount,
  settings: HandoffSettings
): Promise<HandoffResult> {
  const sessionCreatedAt = new Date().toISOString();
  const sessionPage = await createSessionPage(client);
  const timeoutMs = settings.timeout_seconds * 1_000;

  try {
    await sessionPage.page.goto(settings.target_url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const pausedAt = new Date().toISOString();

    console.error('');
    console.error(`[paused ${pausedAt}] Human action is required.`);
    console.error(`Remote View: ${sessionPage.session.inspectUrl}`);
    console.error(
      `Open the Remote View and complete the login. Expected destination: ${safeUrlPath(settings.success_url)}.`
    );
    console.error('Enter credentials only in Remote View; never put them in .env or command arguments.');
    console.error(
      `The same Session will wait up to ${settings.timeout_seconds} seconds and then resume automatically.`
    );
    console.error('');

    const handoff = await waitForHumanCompletion(
      sessionPage.page,
      settings.success_url,
      timeoutMs,
      settings.poll_interval_ms
    );
    const humanCompletedAt = handoff.completed_at;
    const resumedAt = new Date().toISOString();
    console.error(`[resumed ${resumedAt}] Login detected; continuing automation.`);

    const completedAt = new Date().toISOString();
    console.error(`[completed ${completedAt}] Authenticated page verification finished.`);

    const timeline: HandoffTimeline = {
      session_created_at: sessionCreatedAt,
      paused_at: pausedAt,
      human_completed_at: humanCompletedAt,
      resumed_at: resumedAt,
      completed_at: completedAt,
    };
    assertTimelineOrder(timeline);

    return {
      template: 'human-in-the-loop',
      session_id: sessionPage.session.id,
      session_preserved_during_handoff: true,
      human_action: {
        control: 'Complete login in Remote View',
        detected_by: 'stable success URL with login form absent',
      },
      timeline,
      durations_ms: {
        waiting_for_human: durationBetween(pausedAt, resumedAt),
        resumed_work: durationBetween(resumedAt, completedAt),
        total: durationBetween(sessionCreatedAt, completedAt),
      },
      result: {
        authenticated: true,
        final_path: handoff.final_path,
        remaining_task_completed: true,
      },
    };
  } finally {
    await closeSessionPage(sessionPage);
  }
}

async function createSessionPage(client: Lexmount): Promise<SessionPage> {
  const session = await client.sessions.create({ browserMode: 'normal' });
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { session, browser, page };
  } catch (error) {
    const cleanupErrors = await closeResources(session, browser);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `Session ${session.id} initialization and cleanup both failed.`
      );
    }
    throw error;
  }
}

async function waitForHumanCompletion(
  page: Page,
  successUrl: string,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<{ completed_at: string; final_path: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = page.url();

  while (Date.now() < deadline) {
    lastUrl = page.url();
    if (isSuccessUrl(lastUrl, successUrl)) {
      const remainingForLoadMs = deadline - Date.now();
      if (remainingForLoadMs <= 0) break;
      const loaded = await page
        .waitForLoadState('domcontentloaded', { timeout: remainingForLoadMs })
        .then(() => true, () => false);
      if (!loaded) continue;

      const remainingForFormMs = deadline - Date.now();
      if (remainingForFormMs <= 0) break;
      const loginFormGone = await page
        .locator(GITEE_LOGIN_FORM_SELECTOR)
        .first()
        .waitFor({
          state: 'detached',
          timeout: Math.min(5_000, remainingForFormMs),
        })
        .then(() => true, () => false);
      if (!loginFormGone) continue;

      const remainingForStabilityMs = deadline - Date.now();
      if (remainingForStabilityMs < SUCCESS_STABILITY_MS) break;
      await page.waitForTimeout(SUCCESS_STABILITY_MS);
      lastUrl = page.url();
      const loginFormControlCount = await page
        .locator(GITEE_LOGIN_FORM_SELECTOR)
        .count();
      if (isSuccessPageReady(lastUrl, successUrl, loginFormControlCount)) {
        return {
          completed_at: new Date().toISOString(),
          final_path: safeUrlPath(lastUrl),
        };
      }
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.waitForTimeout(Math.min(pollIntervalMs, remainingMs));
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1_000)} seconds waiting for login. Last page: ${safeUrlPath(lastUrl)}.`
  );
}

async function closeSessionPage(sessionPage: SessionPage): Promise<void> {
  const errors = await closeResources(sessionPage.session, sessionPage.browser);
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Failed to fully close Session ${sessionPage.session.id}.`
    );
  }
}

async function closeResources(
  session: SessionInfo,
  browser: Browser | undefined
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await session.close();
  } catch (error) {
    errors.push(error);
  }
  return errors;
}
