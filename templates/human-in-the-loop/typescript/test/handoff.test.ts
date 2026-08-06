import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVAL_SELECTOR,
  assertTimelineOrder,
  buildDemoPage,
  durationBetween,
  parseApprovalTimestamp,
  resolveHandoffSettings,
} from '../src/handoff.js';

test('resolveHandoffSettings supplies safe defaults', () => {
  assert.deepEqual(resolveHandoffSettings(undefined, undefined), {
    timeout_seconds: 600,
    poll_interval_ms: 500,
  });
});

test('resolveHandoffSettings accepts values inside supported ranges', () => {
  assert.deepEqual(resolveHandoffSettings('120', '750'), {
    timeout_seconds: 120,
    poll_interval_ms: 750,
  });
});

test('resolveHandoffSettings rejects fractions and out-of-range values', () => {
  assert.throws(() => resolveHandoffSettings('1.5', undefined), /whole number/);
  assert.throws(() => resolveHandoffSettings('9', undefined), /between 10 and 3600/);
  assert.throws(() => resolveHandoffSettings(undefined, '5001'), /between 100 and 5000/);
});

test('parseApprovalTimestamp normalizes a valid timestamp', () => {
  assert.equal(
    parseApprovalTimestamp('2026-08-06T12:34:56.789Z'),
    '2026-08-06T12:34:56.789Z'
  );
});

test('parseApprovalTimestamp rejects missing and malformed markers', () => {
  assert.throws(() => parseApprovalTimestamp(null), /valid timestamp/);
  assert.throws(() => parseApprovalTimestamp('not-a-date'), /valid timestamp/);
});

test('assertTimelineOrder accepts equal or increasing event times', () => {
  assert.doesNotThrow(() =>
    assertTimelineOrder({
      session_created_at: '2026-08-06T00:00:00.000Z',
      paused_at: '2026-08-06T00:00:01.000Z',
      human_completed_at: '2026-08-06T00:00:02.000Z',
      resumed_at: '2026-08-06T00:00:02.000Z',
      completed_at: '2026-08-06T00:00:03.000Z',
    })
  );
});

test('assertTimelineOrder rejects invalid and decreasing event times', () => {
  assert.throws(
    () =>
      assertTimelineOrder({
        session_created_at: '2026-08-06T00:00:00.000Z',
        paused_at: 'invalid',
        human_completed_at: '2026-08-06T00:00:02.000Z',
        resumed_at: '2026-08-06T00:00:02.000Z',
        completed_at: '2026-08-06T00:00:03.000Z',
      }),
    /not a valid timestamp/
  );
  assert.throws(
    () =>
      assertTimelineOrder({
        session_created_at: '2026-08-06T00:00:00.000Z',
        paused_at: '2026-08-06T00:00:03.000Z',
        human_completed_at: '2026-08-06T00:00:02.000Z',
        resumed_at: '2026-08-06T00:00:04.000Z',
        completed_at: '2026-08-06T00:00:05.000Z',
      }),
    /earlier than/
  );
});

test('durationBetween returns milliseconds and never a negative value', () => {
  assert.equal(
    durationBetween(
      '2026-08-06T00:00:01.000Z',
      '2026-08-06T00:00:03.250Z'
    ),
    2_250
  );
  assert.equal(
    durationBetween(
      '2026-08-06T00:00:03.000Z',
      '2026-08-06T00:00:01.000Z'
    ),
    0
  );
});

test('buildDemoPage exposes one accessible approval control and marker contract', () => {
  const html = buildDemoPage();
  assert.match(html, /<button id="approve" type="button">批准并继续<\/button>/);
  assert.match(html, /<a class="skip-link" href="#handoff-main">跳到批准操作<\/a>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-handoff-state="waiting"/);
  assert.match(html, /dataset\.handoffState = 'approved'/);
  assert.match(html, /addEventListener\('keydown'/);
  assert.match(html, /event\.key !== 'Enter'/);
  assert.equal(APPROVAL_SELECTOR, 'body[data-handoff-state="approved"]');
});
