import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  parseConcurrency,
  parseNavigationTimeout,
  parseUrlInput,
} from '../src/config.js';

test('uses the documented concurrency default', () => {
  assert.equal(parseConcurrency(undefined), DEFAULT_CONCURRENCY);
  assert.equal(parseConcurrency(''), DEFAULT_CONCURRENCY);
});

test('accepts a bounded integer concurrency', () => {
  assert.equal(parseConcurrency('1'), 1);
  assert.equal(parseConcurrency('20'), 20);
});

test('rejects invalid concurrency values', () => {
  for (const value of ['0', '1.5', 'twice', '21']) {
    assert.throws(() => parseConcurrency(value), /CONCURRENCY must be an integer/);
  }
});

test('uses the documented navigation timeout default', () => {
  assert.equal(parseNavigationTimeout(undefined), DEFAULT_NAVIGATION_TIMEOUT_MS);
});

test('accepts a bounded navigation timeout', () => {
  assert.equal(parseNavigationTimeout('1000'), 1_000);
  assert.equal(parseNavigationTimeout('300000'), 300_000);
});

test('rejects invalid navigation timeout values', () => {
  for (const value of ['999', '1.5', 'never', '300001']) {
    assert.throws(
      () => parseNavigationTimeout(value),
      /NAVIGATION_TIMEOUT_MS must be an integer/
    );
  }
});

test('normalizes valid HTTP and HTTPS URLs', () => {
  assert.deepEqual(
    parseUrlInput({ urls: ['https://example.com', 'http://example.com/path'] }),
    ['https://example.com/', 'http://example.com/path']
  );
});

test('rejects a missing or empty urls array', () => {
  assert.throws(() => parseUrlInput({}), /urls array/);
  assert.throws(() => parseUrlInput({ urls: [] }), /at least one URL/);
});

test('rejects invalid URL entries and non-HTTP protocols', () => {
  assert.throws(() => parseUrlInput({ urls: ['not a url'] }), /not a valid URL/);
  assert.throws(() => parseUrlInput({ urls: ['file:///tmp/a'] }), /http or https/);
});
