import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_CHECK_COUNT,
  parseCheckPlan,
} from '../src/input.js';

test('parses and normalizes every supported action', () => {
  const plan = parseCheckPlan({
    name: 'checkout',
    url: 'https://example.com',
    timeout_ms: 12_000,
    checks: [
      { action: 'goto' },
      { action: 'goto', url: 'https://example.org/path' },
      { action: 'click', selector: '#continue' },
      { action: 'fill', selector: '#email', value: '' },
      { action: 'expectTitle', value: 'Example', match: 'equals' },
      { action: 'expectText', value: 'Ready' },
      { action: 'expectUrl', value: '/complete', match: 'contains' },
    ],
  });

  assert.equal(plan.url, 'https://example.com/');
  assert.equal(plan.timeout_ms, 12_000);
  assert.deepEqual(plan.checks[5], {
    action: 'expectText',
    selector: 'body',
    value: 'Ready',
    match: 'contains',
  });
});

test('uses documented defaults', () => {
  const plan = parseCheckPlan({ url: 'https://example.com', checks: [{ action: 'goto' }] });
  assert.equal(plan.name, 'web-check');
  assert.equal(plan.timeout_ms, DEFAULT_STEP_TIMEOUT_MS);
});

test('rejects unsupported actions', () => {
  assert.throws(
    () => parseCheckPlan({ url: 'https://example.com', checks: [{ action: 'eval' }] }),
    /must be one of/
  );
});

test('rejects non-http URLs', () => {
  assert.throws(
    () => parseCheckPlan({ url: 'file:///secret', checks: [{ action: 'goto' }] }),
    /must use http or https/
  );
});

test('rejects empty and oversized check arrays', () => {
  assert.throws(() => parseCheckPlan({ url: 'https://example.com', checks: [] }), /non-empty/);
  assert.throws(
    () =>
      parseCheckPlan({
        url: 'https://example.com',
        checks: Array.from({ length: MAX_CHECK_COUNT + 1 }, () => ({ action: 'goto' })),
      }),
    /cannot contain more/
  );
});

test('rejects invalid timeouts and unknown fields', () => {
  assert.throws(
    () =>
      parseCheckPlan({
        url: 'https://example.com',
        timeout_ms: 999,
        checks: [{ action: 'goto' }],
      }),
    /from 1000/
  );
  assert.throws(
    () => parseCheckPlan({ url: 'https://example.com', checks: [{ action: 'goto', script: 'x' }] }),
    /unsupported field/
  );
});

test('rejects missing action-specific fields', () => {
  assert.throws(
    () => parseCheckPlan({ url: 'https://example.com', checks: [{ action: 'click' }] }),
    /selector must be a string/
  );
  assert.throws(
    () => parseCheckPlan({ url: 'https://example.com', checks: [{ action: 'fill', selector: 'input' }] }),
    /value must be a string/
  );
});
