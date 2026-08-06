import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPersistedState,
  DEMO_COOKIE_VALUE,
  DEMO_STORAGE_VALUE,
  parseStoredContextState,
  validateTargetUrl,
} from '../src/state.js';

const validState = {
  schema_version: 1,
  created_by: 'persistent-login-state',
  context_id: 'ctx_test',
  target_url: 'https://example.com/',
  origin: 'https://example.com',
  created_at: '2026-08-06T00:00:00.000Z',
};

test('validateTargetUrl accepts HTTP and HTTPS URLs', () => {
  assert.equal(validateTargetUrl('https://example.com').toString(), 'https://example.com/');
  assert.equal(validateTargetUrl('http://example.com/path').pathname, '/path');
});

test('validateTargetUrl rejects non-web protocols and embedded credentials', () => {
  assert.throws(() => validateTargetUrl('file:///tmp/test'), /http or https/);
  assert.throws(() => validateTargetUrl('https://user:secret@example.com'), /must not contain credentials/);
});

test('parseStoredContextState accepts a valid owned state file', () => {
  assert.deepEqual(parseStoredContextState(validState), validState);
});

test('parseStoredContextState rejects mismatched ownership and origins', () => {
  assert.throws(
    () => parseStoredContextState({ ...validState, created_by: 'another-project' }),
    /not created by this project/
  );
  assert.throws(
    () => parseStoredContextState({ ...validState, origin: 'https://other.example' }),
    /do not match/
  );
});

test('assertPersistedState accepts both expected browser-state markers', () => {
  assert.doesNotThrow(() =>
    assertPersistedState({
      cookie: DEMO_COOKIE_VALUE,
      local_storage: DEMO_STORAGE_VALUE,
    })
  );
});

test('assertPersistedState reports missing cookie and local storage together', () => {
  assert.throws(
    () => assertPersistedState({ cookie: null, local_storage: null }),
    /cookie .*localStorage/
  );
});
