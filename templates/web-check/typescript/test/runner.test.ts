import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckPlan } from '../src/input.js';
import {
  executeChecks,
  getOrCreateNewestPage,
  type PageDriver,
} from '../src/runner.js';

type FakeState = {
  url: string;
  title: string;
  texts: Map<string, string>;
  clicked: string[];
  filled: Array<{ selector: string; value: string }>;
};

function fakePage(state: FakeState): PageDriver {
  return {
    async goto(url: string) {
      state.url = url;
      return { status: () => 200 } as never;
    },
    locator(selector: string) {
      return {
        async click() {
          state.clicked.push(selector);
        },
        async fill(value: string) {
          state.filled.push({ selector, value });
        },
        async innerText() {
          return state.texts.get(selector) ?? '';
        },
      } as never;
    },
    async title() {
      return state.title;
    },
    url() {
      return state.url;
    },
  };
}

function basePlan(checks: CheckPlan['checks']): CheckPlan {
  return {
    name: 'test',
    url: 'https://example.com/',
    timeout_ms: 1_000,
    checks,
  };
}

test('selects the newest existing page for Recording', async () => {
  const oldest = { id: 'oldest' };
  const newest = { id: 'newest' };
  const selected = await getOrCreateNewestPage({
    pages: () => [oldest, newest],
    newPage: async () => ({ id: 'created' }),
  });
  assert.equal(selected, newest);
});

test('creates a page when the remote context is empty', async () => {
  const created = { id: 'created' };
  const selected = await getOrCreateNewestPage({
    pages: () => [],
    newPage: async () => created,
  });
  assert.equal(selected, created);
});

test('executes all supported steps and records passed timings', async () => {
  const state: FakeState = {
    url: 'about:blank',
    title: 'Example Domain',
    texts: new Map([['h1', 'Example Domain']]),
    clicked: [],
    filled: [],
  };
  let tick = 0;
  const reports = await executeChecks(
    fakePage(state),
    basePlan([
      { action: 'goto' },
      { action: 'click', selector: 'a' },
      { action: 'fill', selector: '#email', value: 'secret@example.com' },
      { action: 'expectTitle', value: 'Example', match: 'contains' },
      { action: 'expectText', selector: 'h1', value: 'Example Domain', match: 'equals' },
      { action: 'expectUrl', value: 'https://example.com/', match: 'equals' },
    ]),
    () => new Date(1_000 + tick++ * 10)
  );

  assert.equal(reports.length, 6);
  assert.ok(reports.every((step) => step.result === 'passed'));
  assert.ok(reports.every((step) => step.duration_ms === 10));
  assert.deepEqual(state.clicked, ['a']);
  assert.deepEqual(state.filled, [{ selector: '#email', value: 'secret@example.com' }]);
});

test('redacts fill values from machine-readable details', async () => {
  const state: FakeState = {
    url: 'about:blank',
    title: '',
    texts: new Map(),
    clicked: [],
    filled: [],
  };
  const [report] = await executeChecks(
    fakePage(state),
    basePlan([{ action: 'fill', selector: '#password', value: 'top-secret' }])
  );
  assert.equal(report.details.value_redacted, true);
  assert.equal(report.details.value_length, 10);
  assert.doesNotMatch(JSON.stringify(report), /top-secret/);
});

test('records an assertion error and marks later steps skipped', async () => {
  const state: FakeState = {
    url: 'about:blank',
    title: 'Actual title',
    texts: new Map(),
    clicked: [],
    filled: [],
  };
  const reports = await executeChecks(
    fakePage(state),
    basePlan([
      { action: 'expectTitle', value: 'Expected title', match: 'equals' },
      { action: 'click', selector: '#never' },
    ])
  );
  assert.equal(reports[0].result, 'failed');
  assert.match(reports[0].error ?? '', /Expected title/);
  assert.equal(reports[1].result, 'skipped');
  assert.equal(reports[1].started_at, null);
  assert.deepEqual(state.clicked, []);
});

test('supports contains matching for URLs and text', async () => {
  const state: FakeState = {
    url: 'https://example.com/complete?id=42',
    title: '',
    texts: new Map([['body', 'Order complete: 42']]),
    clicked: [],
    filled: [],
  };
  const reports = await executeChecks(
    fakePage(state),
    basePlan([
      { action: 'expectText', selector: 'body', value: 'complete', match: 'contains' },
      { action: 'expectUrl', value: '/complete', match: 'contains' },
    ])
  );
  assert.ok(reports.every((step) => step.result === 'passed'));
});
