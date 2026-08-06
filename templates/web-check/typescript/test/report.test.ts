import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCheckPlan } from '../src/input.js';
import { persistEvidenceAndClose } from '../src/lifecycle.js';
import {
  createReport,
  finishExecution,
  markRuntimeError,
  replayConsoleUrl,
  writeJsonReport,
} from '../src/report.js';

function reportFixture() {
  const plan = parseCheckPlan({
    url: 'https://example.com',
    checks: [{ action: 'goto' }],
  });
  return createReport(plan, 'inputs/checks.json', new Date('2026-01-01T00:00:00.000Z'));
}

test('summarizes passed, failed, and skipped steps', () => {
  const report = reportFixture();
  report.input.check_count = 3;
  finishExecution(
    report,
    [
      {
        index: 0,
        action: 'goto',
        started_at: '2026-01-01T00:00:00.000Z',
        ended_at: '2026-01-01T00:00:00.010Z',
        duration_ms: 10,
        result: 'passed',
        error: null,
        details: {},
      },
      {
        index: 1,
        action: 'expectTitle',
        started_at: '2026-01-01T00:00:00.010Z',
        ended_at: '2026-01-01T00:00:00.020Z',
        duration_ms: 10,
        result: 'failed',
        error: 'wrong title',
        details: {},
      },
      {
        index: 2,
        action: 'click',
        started_at: null,
        ended_at: null,
        duration_ms: null,
        result: 'skipped',
        error: 'previous failure',
        details: {},
      },
    ],
    new Date('2026-01-01T00:00:01.000Z')
  );
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.summary, { total: 3, passed: 1, failed: 1, skipped: 1 });
});

test('marks runtime errors without losing report metadata', () => {
  const report = reportFixture();
  markRuntimeError(report, new Error('CDP unavailable'), new Date('2026-01-01T00:00:02.000Z'));
  assert.equal(report.status, 'error');
  assert.equal(report.error, 'CDP unavailable');
  assert.equal(report.duration_ms, 2_000);
});

test('writes report before closing Session and then writes final state', async () => {
  const report = reportFixture();
  report.session.id = 'session-123';
  report.session.closure.status = 'pending';
  const events: string[] = [];
  const result = await persistEvidenceAndClose({
    report,
    writeReport: async () => {
      events.push(`write:${report.evidence.phase}:${report.session.closure.status}`);
    },
    closeBrowser: async () => {
      events.push('browser-close');
    },
    closeSession: async () => {
      events.push('session-close');
    },
    now: () => new Date('2026-01-01T00:00:03.000Z'),
  });
  assert.deepEqual(events, [
    'write:pre_close:pending',
    'browser-close',
    'session-close',
    'write:final:closed',
  ]);
  assert.equal(result.pre_close_report_written, true);
  assert.equal(report.evidence.report_written_before_session_close, true);
});

test('still closes Session if the pre-close report write fails', async () => {
  const report = reportFixture();
  report.session.closure.status = 'pending';
  let writes = 0;
  let closed = false;
  const result = await persistEvidenceAndClose({
    report,
    writeReport: async () => {
      writes += 1;
      if (writes === 1) throw new Error('disk full');
    },
    closeBrowser: async () => undefined,
    closeSession: async () => {
      closed = true;
    },
  });
  assert.equal(closed, true);
  assert.equal(result.pre_close_report_written, false);
  assert.equal(result.final_report_written, true);
  assert.equal(report.status, 'error');
  assert.match(report.error ?? '', /disk full/);
});

test('records Session close failures in the final report', async () => {
  const report = reportFixture();
  report.session.closure.status = 'pending';
  await persistEvidenceAndClose({
    report,
    writeReport: async () => undefined,
    closeBrowser: async () => undefined,
    closeSession: async () => {
      throw new Error('close rejected');
    },
  });
  assert.equal(report.session.closure.status, 'failed');
  assert.equal(report.status, 'error');
  assert.match(report.error ?? '', /close rejected/);
});

test('builds the documented Session replay console URL', () => {
  assert.equal(
    replayConsoleUrl('session/with space'),
    'https://browser.lexmount.cn/settings/sessions/session%2Fwith%20space'
  );
});

test('writes valid JSON atomically', async () => {
  const report = reportFixture();
  const outputPath = path.join(tmpdir(), `web-check-report-${process.pid}.json`);
  await writeJsonReport(outputPath, report);
  const parsed = JSON.parse(await readFile(outputPath, 'utf8')) as { template: string };
  assert.equal(parsed.template, 'web-check');
});
