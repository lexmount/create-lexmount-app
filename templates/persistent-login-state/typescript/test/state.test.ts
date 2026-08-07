import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExpectedDashboardUrl,
  DEFAULT_LOGIN_TIMEOUT_SECONDS,
  isExpectedDashboardUrl,
  LOGIN_ACCOUNT_SELECTOR,
  LOGIN_PASSWORD_SELECTOR,
  LOGIN_SUBMIT_SELECTOR,
  parseStoredContextState,
  resolveLoginTimeoutSeconds,
  validateTargetUrl,
} from '../src/state.js';

const validState = {
  schema_version: 1,
  created_by: 'persistent-login-state',
  context_id: 'ctx_test',
  target_url: 'https://tdesign.tencent.com/starter/vue-next/dashboard/base',
  origin: 'https://tdesign.tencent.com',
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

test('login controls use form-scoped selectors that do not depend on locale or demo values', () => {
  assert.equal(LOGIN_ACCOUNT_SELECTOR, 'form.login-password input[type="text"]');
  assert.equal(LOGIN_PASSWORD_SELECTOR, 'form.login-password input[type="password"]');
  assert.equal(LOGIN_SUBMIT_SELECTOR, 'form.login-password button[type="submit"]');
  assert.doesNotMatch(
    `${LOGIN_ACCOUNT_SELECTOR} ${LOGIN_PASSWORD_SELECTOR} ${LOGIN_SUBMIT_SELECTOR}`,
    /admin|请输入|登录/
  );
});

test('resolveLoginTimeoutSeconds supplies and validates the supported range', () => {
  assert.equal(resolveLoginTimeoutSeconds(undefined), DEFAULT_LOGIN_TIMEOUT_SECONDS);
  assert.equal(resolveLoginTimeoutSeconds('120'), 120);
  assert.throws(() => resolveLoginTimeoutSeconds('9'), /between 10 and 300/);
  assert.throws(() => resolveLoginTimeoutSeconds('1.5'), /whole number/);
});

test('dashboard matching requires the expected origin and exact path', () => {
  assert.equal(
    isExpectedDashboardUrl(validState.target_url, validState.origin),
    true
  );
  assert.equal(
    isExpectedDashboardUrl(
      'https://tdesign.tencent.com/starter/vue-next/login',
      validState.origin
    ),
    false
  );
  assert.equal(
    isExpectedDashboardUrl(validState.target_url, 'https://example.com'),
    false
  );
  assert.throws(
    () =>
      assertExpectedDashboardUrl(
        'https://tdesign.tencent.com/starter/vue-next/login',
        validState.origin
      ),
    /Expected the TDesign dashboard/
  );
});
