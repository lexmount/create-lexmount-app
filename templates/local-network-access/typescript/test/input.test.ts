import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InputError,
  resolveTargetUrl,
  validateTargetUrl,
} from '../src/input.js';

test('accepts company DNS names and private network URLs', () => {
  for (const url of [
    'https://code.company.example/',
    'http://10.8.0.12:8080/',
    'https://192.168.10.8/',
    'http://[fd00::2]/',
  ]) {
    assert.equal(validateTargetUrl(url), url);
  }
  assert.equal(
    validateTargetUrl(' https://intranet.example '),
    'https://intranet.example/'
  );
});

test('rejects loopback, unspecified and canonicalized loopback forms', () => {
  for (const host of [
    'localhost',
    'LOCALHOST.',
    'app.localhost',
    'app.localhost.',
    '127.0.0.1',
    '127.0.1.1',
    '127.255.255.255',
    '127.1',
    '2130706433',
    '0x7f000001',
    '0177.0.0.1',
    '[::1]',
    '[0:0:0:0:0:0:0:1]',
    '[::ffff:127.0.0.1]',
    '0.0.0.0',
    '[::]',
    '[::ffff:0.0.0.0]',
  ]) {
    assert.throws(
      () => validateTargetUrl(`http://${host}/`),
      /not supported/,
      host
    );
  }
});

test('rejects missing URLs, unsupported protocols and embedded credentials without echoing input', () => {
  for (const url of [
    '',
    'internal-only',
    'file:///etc/passwd',
    'ftp://intranet.example',
    'https://user:private-secret@intranet.example/',
  ]) {
    assert.throws(
      () => validateTargetUrl(url),
      (error) => {
        assert.ok(error instanceof InputError);
        assert.doesNotMatch(error.message, /private-secret|etc\/passwd/);
        return true;
      }
    );
  }
});

test('explicit URL works without a terminal; missing URL fails before starting resources', async () => {
  const controller = new AbortController();
  assert.equal(
    await resolveTargetUrl('https://intranet.example/', controller),
    'https://intranet.example/'
  );
  if (!process.stdin.isTTY) {
    await assert.rejects(
      resolveTargetUrl(undefined, controller),
      /interactive terminal/
    );
  }
});
