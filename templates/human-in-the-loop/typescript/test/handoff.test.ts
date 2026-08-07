import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTimelineOrder,
  DEFAULT_SUCCESS_URL,
  DEFAULT_TARGET_URL,
  durationBetween,
  GITEE_LOGIN_FORM_SELECTOR,
  isSuccessPageReady,
  isSuccessUrl,
  resolveHandoffSettings,
  safeUrlPath,
  SUCCESS_STABILITY_MS,
} from '../src/handoff.js';

test('resolveHandoffSettings supplies safe defaults', () => {
  assert.deepEqual(resolveHandoffSettings(undefined, undefined, undefined, undefined), {
    timeout_seconds: 600,
    poll_interval_ms: 500,
    target_url: DEFAULT_TARGET_URL,
    success_url: DEFAULT_SUCCESS_URL,
  });
});

test('resolveHandoffSettings accepts values inside supported ranges', () => {
  assert.deepEqual(resolveHandoffSettings('120', '750', DEFAULT_TARGET_URL, DEFAULT_SUCCESS_URL), {
    timeout_seconds: 120,
    poll_interval_ms: 750,
    target_url: DEFAULT_TARGET_URL,
    success_url: DEFAULT_SUCCESS_URL,
  });
});

test('resolveHandoffSettings rejects fractions and out-of-range values', () => {
  assert.throws(
    () => resolveHandoffSettings('1.5', undefined, undefined, undefined),
    /whole number/
  );
  assert.throws(
    () => resolveHandoffSettings('9', undefined, undefined, undefined),
    /between 10 and 3600/
  );
  assert.throws(
    () => resolveHandoffSettings(undefined, '5001', undefined, undefined),
    /between 100 and 5000/
  );
});

test('resolveHandoffSettings rejects unsafe and cross-origin completion URLs', () => {
  assert.throws(
    () => resolveHandoffSettings(undefined, undefined, 'file:///tmp/login', undefined),
    /must use https/
  );
  assert.throws(
    () =>
      resolveHandoffSettings(
        undefined,
        undefined,
        'http://gitee.com/login',
        DEFAULT_SUCCESS_URL
      ),
    /must use https/
  );
  assert.throws(
    () =>
      resolveHandoffSettings(
        undefined,
        undefined,
        'https://user:secret@gitee.com/login',
        DEFAULT_SUCCESS_URL
      ),
    /must not contain credentials/
  );
  assert.throws(
    () =>
      resolveHandoffSettings(
        undefined,
        undefined,
        DEFAULT_TARGET_URL,
        'https://example.com/dashboard/projects'
      ),
    /same origin/
  );
});

test('success matching ignores query and hash but requires the exact path', () => {
  assert.equal(
    isSuccessUrl('https://gitee.com/dashboard/projects?from=login#top', DEFAULT_SUCCESS_URL),
    true
  );
  assert.equal(isSuccessUrl('https://gitee.com/', DEFAULT_SUCCESS_URL), false);
  assert.equal(
    isSuccessUrl('https://example.com/dashboard/projects', DEFAULT_SUCCESS_URL),
    false
  );
  assert.equal(
    safeUrlPath('https://gitee.com/dashboard/projects?token=hidden#top'),
    'https://gitee.com/dashboard/projects'
  );
});

test('completion requires a stable success page with the login form absent', () => {
  assert.equal(SUCCESS_STABILITY_MS, 750);
  assert.match(GITEE_LOGIN_FORM_SELECTOR, /#user_login/);
  assert.doesNotMatch(GITEE_LOGIN_FORM_SELECTOR, /[一-鿿]/);
  assert.equal(
    isSuccessPageReady(DEFAULT_SUCCESS_URL, DEFAULT_SUCCESS_URL, 0),
    true
  );
  assert.equal(
    isSuccessPageReady(DEFAULT_SUCCESS_URL, DEFAULT_SUCCESS_URL, 1),
    false
  );
  assert.equal(
    isSuccessPageReady('https://gitee.com/login', DEFAULT_SUCCESS_URL, 0),
    false
  );
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
