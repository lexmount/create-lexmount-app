import type { Page } from 'playwright';
import type { CheckPlan, MatchMode, WebCheck } from './input.js';

export type StepResult = 'passed' | 'failed' | 'skipped';

export type StepReport = {
  index: number;
  action: WebCheck['action'];
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  result: StepResult;
  error: string | null;
  details: Record<string, unknown>;
};

export type PageDriver = Pick<Page, 'goto' | 'locator' | 'title' | 'url'>;

export async function getOrCreateNewestPage<T>(context: {
  pages(): T[];
  newPage(): Promise<T>;
}): Promise<T> {
  const pages = context.pages();
  return pages.at(-1) ?? context.newPage();
}

export async function executeChecks(
  page: PageDriver,
  plan: CheckPlan,
  now: () => Date = () => new Date()
): Promise<StepReport[]> {
  const reports: StepReport[] = [];

  for (let index = 0; index < plan.checks.length; index += 1) {
    const check = plan.checks[index];
    const started = now();
    try {
      const details = await executeCheck(page, check, plan.url, plan.timeout_ms);
      const ended = now();
      reports.push({
        index,
        action: check.action,
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        duration_ms: Math.max(0, ended.getTime() - started.getTime()),
        result: 'passed',
        error: null,
        details,
      });
    } catch (error: unknown) {
      const ended = now();
      const message = safeErrorMessage(error);
      reports.push({
        index,
        action: check.action,
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        duration_ms: Math.max(0, ended.getTime() - started.getTime()),
        result: 'failed',
        error: message,
        details: sanitizedCheckDetails(check),
      });
      for (let skipped = index + 1; skipped < plan.checks.length; skipped += 1) {
        const skippedCheck = plan.checks[skipped];
        reports.push({
          index: skipped,
          action: skippedCheck.action,
          started_at: null,
          ended_at: null,
          duration_ms: null,
          result: 'skipped',
          error: `Skipped because checks[${index}] failed: ${message}`,
          details: sanitizedCheckDetails(skippedCheck),
        });
      }
      break;
    }
  }

  return reports;
}

async function executeCheck(
  page: PageDriver,
  check: WebCheck,
  defaultUrl: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  switch (check.action) {
    case 'goto': {
      const requestedUrl = check.url ?? defaultUrl;
      const response = await page.goto(requestedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      return {
        requested_url: requestedUrl,
        final_url: page.url(),
        response_status: response?.status() ?? null,
      };
    }
    case 'click':
      await page.locator(check.selector).click({ timeout: timeoutMs });
      return { selector: check.selector };
    case 'fill':
      await page.locator(check.selector).fill(check.value, { timeout: timeoutMs });
      return {
        selector: check.selector,
        value_redacted: true,
        value_length: check.value.length,
      };
    case 'expectTitle': {
      const actual = await page.title();
      assertMatch('title', actual, check.value, check.match);
      return { expected: check.value, actual, match: check.match };
    }
    case 'expectText': {
      const actual = await page.locator(check.selector).innerText({ timeout: timeoutMs });
      assertMatch(`text at ${check.selector}`, actual, check.value, check.match);
      return {
        selector: check.selector,
        expected: check.value,
        actual_excerpt: excerpt(actual),
        match: check.match,
      };
    }
    case 'expectUrl': {
      const actual = page.url();
      assertMatch('URL', actual, check.value, check.match);
      return { expected: check.value, actual, match: check.match };
    }
  }
}

function assertMatch(
  label: string,
  actual: string,
  expected: string,
  mode: MatchMode
): void {
  const matched = mode === 'equals' ? actual === expected : actual.includes(expected);
  if (!matched) {
    throw new Error(
      `Expected ${label} to ${mode === 'equals' ? 'equal' : 'contain'} ${JSON.stringify(expected)}, but received ${JSON.stringify(excerpt(actual))}.`
    );
  }
}

function sanitizedCheckDetails(check: WebCheck): Record<string, unknown> {
  switch (check.action) {
    case 'goto':
      return check.url ? { requested_url: check.url } : {};
    case 'click':
      return { selector: check.selector };
    case 'fill':
      return {
        selector: check.selector,
        value_redacted: true,
        value_length: check.value.length,
      };
    case 'expectTitle':
    case 'expectUrl':
      return { expected: check.value, match: check.match };
    case 'expectText':
      return {
        selector: check.selector,
        expected: check.value,
        match: check.match,
      };
  }
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 500)}…`;
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
