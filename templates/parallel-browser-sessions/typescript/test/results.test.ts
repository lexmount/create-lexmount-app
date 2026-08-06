import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateResults,
  safeErrorMessage,
  UrlTaskError,
  type SessionReport,
  type UrlFailure,
  type UrlSuccess,
} from '../src/results.js';

const closedSession: SessionReport = {
  session_id: 'session-success',
  inspect_url: 'https://inspect.example/session-success',
  creation: { status: 'created', at: '2026-08-06T00:00:00.100Z' },
  completion: { status: 'completed', at: '2026-08-06T00:00:01.000Z' },
  closure: { status: 'closed', at: '2026-08-06T00:00:01.100Z' },
};

test('aggregates successes, failures, and lifecycle counts', () => {
  const success: UrlSuccess = {
    input_index: 0,
    requested_url: 'https://example.com/',
    elapsed_ms: 1_000,
    session: closedSession,
    page: {
      status: 200,
      title: 'Example',
      h1: 'Example Domain',
      final_url: 'https://example.com/',
      page_elapsed_ms: 400,
    },
  };
  const failedSession: SessionReport = {
    session_id: 'session-failure',
    inspect_url: 'https://inspect.example/session-failure',
    creation: { status: 'created', at: '2026-08-06T00:00:00.200Z' },
    completion: {
      status: 'failed',
      at: '2026-08-06T00:00:00.800Z',
      error: 'navigation failed',
    },
    closure: { status: 'closed', at: '2026-08-06T00:00:00.900Z' },
  };
  const failure: UrlFailure = {
    input_index: 1,
    requested_url: 'https://failed.example/',
    elapsed_ms: 700,
    error: 'navigation failed',
    session: failedSession,
  };

  const output = aggregateResults(
    [
      { status: 'fulfilled', value: success },
      { status: 'rejected', reason: new UrlTaskError(failure) },
    ],
    {
      urls: [success.requested_url, failure.requested_url],
      concurrency: 2,
      startedAt: '2026-08-06T00:00:00.000Z',
      completedAt: '2026-08-06T00:00:02.000Z',
    }
  );

  assert.equal(output.summary.requested, 2);
  assert.equal(output.summary.succeeded, 1);
  assert.equal(output.summary.failed, 1);
  assert.equal(output.summary.sessions.created, 2);
  assert.equal(output.summary.sessions.completed, 1);
  assert.equal(output.summary.sessions.task_failed, 1);
  assert.equal(output.summary.sessions.closed, 2);
  assert.equal(output.summary.elapsed_ms, 2_000);
});

test('redacts configured credentials and token query values from errors', () => {
  const previous = process.env.LEXMOUNT_API_KEY;
  process.env.LEXMOUNT_API_KEY = 'secret-api-key';
  try {
    assert.equal(
      safeErrorMessage(
        new Error('failed secret-api-key at https://x.test/?token=secret-token')
      ),
      'failed *** at https://x.test/?token=***'
    );
  } finally {
    if (previous === undefined) delete process.env.LEXMOUNT_API_KEY;
    else process.env.LEXMOUNT_API_KEY = previous;
  }
});
