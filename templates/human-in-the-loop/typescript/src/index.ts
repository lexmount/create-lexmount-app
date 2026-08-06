import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  APPROVAL_SELECTOR,
  assertTimelineOrder,
  buildDemoPage,
  durationBetween,
  parseApprovalTimestamp,
  resolveHandoffSettings,
  type HandoffTimeline,
} from './handoff.js';

config({ path: '.env.local', override: false });
config({ override: false });

type SessionPage = {
  session: SessionInfo;
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

type HandoffResult = {
  template: 'human-in-the-loop';
  session_id: string;
  inspect_url: string;
  session_preserved_during_handoff: true;
  human_action: {
    control: '批准并继续';
    detected_by: typeof APPROVAL_SELECTOR;
  };
  timeline: HandoffTimeline;
  durations_ms: {
    waiting_for_human: number;
    resumed_work: number;
    total: number;
  };
  result: {
    approved: true;
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
    },
    strict: true,
    allowPositionals: false,
  });
  const settings = resolveHandoffSettings(
    values['timeout-seconds'] ?? process.env.HANDOFF_TIMEOUT_SECONDS,
    values['poll-interval-ms'] ?? process.env.POLL_INTERVAL_MS
  );
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});

  try {
    const result = await runHandoffDemo(
      client,
      settings.timeout_seconds * 1_000,
      settings.poll_interval_ms
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }
}

async function runHandoffDemo(
  client: Lexmount,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<HandoffResult> {
  const sessionCreatedAt = new Date().toISOString();
  const sessionPage = await createSessionPage(client);

  try {
    await sessionPage.page.setContent(buildDemoPage(), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const pausedAt = new Date().toISOString();

    console.error('');
    console.error(`[paused ${pausedAt}] Human action is required.`);
    console.error(`Remote View: ${sessionPage.session.inspectUrl}`);
    console.error('Open the Remote View and click “批准并继续”.');
    console.error(
      `The same Session will wait up to ${Math.round(timeoutMs / 1_000)} seconds and then resume automatically.`
    );
    console.error('');

    const humanCompletedAt = await waitForHumanApproval(
      sessionPage.page,
      timeoutMs,
      pollIntervalMs
    );
    const resumedAt = new Date().toISOString();
    console.error(`[resumed ${resumedAt}] Approval detected; continuing automation.`);

    await sessionPage.page.locator('#handoff-status').evaluate((element) => {
      element.textContent = '批准已确认，自动化正在执行剩余步骤';
    });
    await sessionPage.page.waitForTimeout(500);
    await sessionPage.page.locator('#handoff-status').evaluate((element) => {
      element.textContent = '全部自动化步骤已完成';
    });
    const completedAt = new Date().toISOString();
    console.error(`[completed ${completedAt}] Remaining automation finished.`);

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
      inspect_url: sessionPage.session.inspectUrl,
      session_preserved_during_handoff: true,
      human_action: {
        control: '批准并继续',
        detected_by: APPROVAL_SELECTOR,
      },
      timeline,
      durations_ms: {
        waiting_for_human: durationBetween(pausedAt, resumedAt),
        resumed_work: durationBetween(resumedAt, completedAt),
        total: durationBetween(sessionCreatedAt, completedAt),
      },
      result: {
        approved: true,
        remaining_task_completed: true,
      },
    };
  } finally {
    await closeSessionPage(sessionPage);
  }
}

async function createSessionPage(client: Lexmount): Promise<SessionPage> {
  const session = await client.sessions.create({ browserMode: 'normal' });
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
  } catch (error) {
    await session.close();
    throw error;
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { session, browser, context, page };
}

async function waitForHumanApproval(
  page: Page,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const approvalMarker = page.locator(APPROVAL_SELECTOR);

  while (Date.now() < deadline) {
    if ((await approvalMarker.count()) > 0) {
      parseApprovalTimestamp(await approvalMarker.getAttribute('data-approved-at'));
      return new Date().toISOString();
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.waitForTimeout(Math.min(pollIntervalMs, remainingMs));
  }

  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1_000)} seconds waiting for “批准并继续”.`
  );
}

async function closeSessionPage(sessionPage: SessionPage): Promise<void> {
  await sessionPage.browser.close().catch((error: unknown) => {
    console.error(`Browser cleanup warning: ${String(error)}`);
  });
  await sessionPage.session.close().catch((error: unknown) => {
    console.error(`Session cleanup warning: ${String(error)}`);
  });
}
