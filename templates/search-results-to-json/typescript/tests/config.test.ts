import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchConfig } from '../src/config.js';
import { fallbackSummary, normalizeText } from '../src/text.js';

const validConfig = {
  name: 'example-search',
  start_url: 'https://example.com/search',
  default_query: 'Lexmount',
  default_limit: 3,
  timeout_ms: 30_000,
  search: {
    input: { by: 'label', value: 'Search' },
    submit: { by: 'role', role: 'button', name: 'Submit' },
  },
  waits: [
    { type: 'url', value: '/results', match: 'contains' },
    { type: 'visible', locator: { by: 'css', value: '.results' } },
    { type: 'networkidle' },
  ],
  results: {
    item: { by: 'css', value: '.result' },
    title: { by: 'text', value: 'Title' },
    link: { by: 'css', value: 'a' },
  },
};

test('parses role, label, text, css, and wait rules', () => {
  const config = parseSearchConfig(validConfig);
  assert.equal(config.start_url, 'https://example.com/search');
  assert.equal(config.default_limit, 3);
  assert.deepEqual(
    config.waits.map((wait) => wait.type),
    ['url', 'visible', 'networkidle']
  );
  assert.equal(config.search.input.by, 'label');
  assert.equal(config.results.title.by, 'text');
});

test('rejects unsupported locator rules', () => {
  assert.throws(
    () =>
      parseSearchConfig({
        ...validConfig,
        search: {
          ...validConfig.search,
          input: { by: 'xpath', value: '//input' },
        },
      }),
    /config\.search\.input\.by must be role, label, text, or css/
  );
});

test('rejects non-http start URLs', () => {
  assert.throws(
    () => parseSearchConfig({ ...validConfig, start_url: 'file:///tmp/test.html' }),
    /must use http or https/
  );
});

test('normalizes result text and builds a fallback summary', () => {
  assert.equal(normalizeText('  First\n  result  '), 'First result');
  assert.equal(
    fallbackSummary('First result\nA useful summary', 'First result'),
    'A useful summary'
  );
});
