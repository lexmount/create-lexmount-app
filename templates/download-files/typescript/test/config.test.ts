import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import {
  DEFAULT_DOWNLOAD_LOCATOR,
  DEFAULT_DOWNLOAD_POLL_INTERVAL_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  resolveDownloadSettings,
} from '../src/config.js';

describe('resolveDownloadSettings', () => {
  it('uses the controlled demo defaults', () => {
    const settings = resolveDownloadSettings({}, 'C:\\demo');
    assert.equal(settings.targetUrl, null);
    assert.equal(settings.downloadLocator, DEFAULT_DOWNLOAD_LOCATOR);
    assert.equal(settings.timeoutMs, DEFAULT_DOWNLOAD_TIMEOUT_MS);
    assert.equal(settings.pollIntervalMs, DEFAULT_DOWNLOAD_POLL_INTERVAL_MS);
    assert.equal(settings.outputDir, path.resolve('C:\\demo', 'artifacts', 'downloads'));
  });

  it('normalizes a custom URL and trims custom values', () => {
    const settings = resolveDownloadSettings(
      {
        targetUrl: ' https://example.com/reports ',
        downloadLocator: ' a[download] ',
        outputDir: ' output ',
        timeoutMs: '90000',
        pollIntervalMs: '250',
      },
      'C:\\demo'
    );
    assert.equal(settings.targetUrl, 'https://example.com/reports');
    assert.equal(settings.downloadLocator, 'a[download]');
    assert.equal(settings.outputDir, path.resolve('C:\\demo', 'output'));
    assert.equal(settings.timeoutMs, 90_000);
    assert.equal(settings.pollIntervalMs, 250);
  });

  it('lets the explicit demo mode ignore a configured target URL', () => {
    const settings = resolveDownloadSettings({
      controlledDemo: true,
      targetUrl: 'https://example.com/reports',
    });
    assert.equal(settings.targetUrl, null);
    assert.equal(settings.downloadLocator, DEFAULT_DOWNLOAD_LOCATOR);
  });

  it('rejects non-http target URLs', () => {
    assert.throws(
      () => resolveDownloadSettings({ targetUrl: 'file:///tmp/report.csv' }),
      /must use http or https/
    );
  });

  it('rejects an empty explicit locator', () => {
    assert.throws(
      () => resolveDownloadSettings({ downloadLocator: '   ' }),
      /cannot be empty/
    );
  });

  it('rejects an out-of-range timeout', () => {
    assert.throws(
      () => resolveDownloadSettings({ timeoutMs: '999' }),
      /must be an integer between/
    );
  });

  it('rejects a poll interval that cannot run before the timeout', () => {
    assert.throws(
      () => resolveDownloadSettings({ timeoutMs: '1000', pollIntervalMs: '1000' }),
      /must be smaller/
    );
  });
});
