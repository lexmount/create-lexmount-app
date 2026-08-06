import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckPlan } from './input.js';
import { safeErrorMessage, type StepReport } from './runner.js';

export type RunStatus = 'running' | 'passed' | 'failed' | 'error';

export type WebCheckReport = {
  template: 'web-check';
  name: string;
  input: {
    path: string;
    url: string;
    check_count: number;
    timeout_ms: number;
  };
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  steps: StepReport[];
  error: string | null;
  session: {
    id: string | null;
    region: string | null;
    inspect_url: string | null;
    recording: { persistent: true };
    replay_console_url: string | null;
    closure: {
      status: 'not_created' | 'pending' | 'closed' | 'failed';
      at: string | null;
      error: string | null;
    };
  };
  evidence: {
    phase: 'running' | 'pre_close' | 'final';
    report_written_before_session_close: boolean;
  };
};

export function createReport(
  plan: CheckPlan,
  inputPath: string,
  startedAt = new Date()
): WebCheckReport {
  return {
    template: 'web-check',
    name: plan.name,
    input: {
      path: inputPath,
      url: plan.url,
      check_count: plan.checks.length,
      timeout_ms: plan.timeout_ms,
    },
    status: 'running',
    started_at: startedAt.toISOString(),
    completed_at: null,
    duration_ms: null,
    summary: { total: plan.checks.length, passed: 0, failed: 0, skipped: 0 },
    steps: [],
    error: null,
    session: {
      id: null,
      region: null,
      inspect_url: null,
      recording: { persistent: true },
      replay_console_url: null,
      closure: { status: 'not_created', at: null, error: null },
    },
    evidence: {
      phase: 'running',
      report_written_before_session_close: false,
    },
  };
}

export function finishExecution(
  report: WebCheckReport,
  steps: StepReport[],
  completedAt = new Date()
): void {
  report.steps = steps;
  report.completed_at = completedAt.toISOString();
  report.duration_ms = Math.max(
    0,
    completedAt.getTime() - new Date(report.started_at).getTime()
  );
  report.summary = summarizeSteps(steps, report.input.check_count);
  report.status = report.summary.failed > 0 ? 'failed' : 'passed';
}

export function markRuntimeError(
  report: WebCheckReport,
  error: unknown,
  completedAt = new Date()
): void {
  report.status = 'error';
  report.error = safeErrorMessage(error);
  report.completed_at = completedAt.toISOString();
  report.duration_ms = Math.max(
    0,
    completedAt.getTime() - new Date(report.started_at).getTime()
  );
  report.summary = summarizeSteps(report.steps, report.input.check_count);
}

export function replayConsoleUrl(sessionId: string): string {
  const home = (process.env.LEXMOUNT_HOME_URL ?? 'https://browser.lexmount.cn').replace(
    /\/+$/,
    ''
  );
  return `${home}/settings/sessions/${encodeURIComponent(sessionId)}`;
}

export async function writeJsonReport(
  outputPath: string,
  report: WebCheckReport
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

function summarizeSteps(steps: StepReport[], total: number) {
  return {
    total,
    passed: steps.filter((step) => step.result === 'passed').length,
    failed: steps.filter((step) => step.result === 'failed').length,
    skipped: steps.filter((step) => step.result === 'skipped').length,
  };
}
