import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  CONTROLLED_DEMO_CSV,
  CONTROLLED_DEMO_FILENAME,
  allocateLocalFilenames,
  assertDownloadMetadata,
  buildControlledDownloadPage,
  createRunDirectoryName,
  sanitizeDownloadFilename,
  saveDownloadArtifacts,
  sha256Hex,
  waitForNewDownloads,
  type DownloadInfo,
} from '../src/downloads.js';

const CSV_BUFFER = Buffer.from(CONTROLLED_DEMO_CSV, 'utf8');

function downloadInfo(overrides: Partial<DownloadInfo> = {}): DownloadInfo {
  return {
    id: 'download-1',
    filename: CONTROLLED_DEMO_FILENAME,
    contentType: 'text/csv',
    size: CSV_BUFFER.length,
    sha256: sha256Hex(CSV_BUFFER),
    status: 'available',
    createdAt: '2026-08-06T10:00:00.000Z',
    ...overrides,
  };
}

describe('controlled demo', () => {
  it('embeds a downloadable CSV without an external host', () => {
    const html = buildControlledDownloadPage();
    assert.match(html, /id="download-csv"/);
    assert.match(html, new RegExp(`download="${CONTROLLED_DEMO_FILENAME}"`));
    const encoded = Buffer.from(CONTROLLED_DEMO_CSV, 'utf8').toString('base64');
    assert.ok(html.includes(encoded));
  });

  it('creates filesystem-safe run directory names', () => {
    assert.equal(
      createRunDirectoryName(new Date('2026-08-06T10:11:12.345Z')),
      '2026-08-06T10-11-12-345Z'
    );
  });
});

describe('download filenames', () => {
  it('drops path traversal components and Windows-invalid characters', () => {
    assert.equal(sanitizeDownloadFilename('../bad<name>.csv', 'fallback'), 'bad_name_.csv');
    assert.equal(sanitizeDownloadFilename('..\\nested\\report.csv', 'fallback'), 'report.csv');
  });

  it('protects Windows reserved device names', () => {
    assert.equal(sanitizeDownloadFilename('CON.csv', 'fallback'), '_CON.csv');
  });

  it('allocates unique local names case-insensitively', () => {
    const names = allocateLocalFilenames([
      downloadInfo({ filename: 'report.csv' }),
      downloadInfo({ id: 'download-2', filename: 'REPORT.csv' }),
      downloadInfo({ id: 'download-3', filename: 'report.csv' }),
    ]);
    assert.deepEqual(names, ['report.csv', 'REPORT-2.csv', 'report-3.csv']);
  });
});

describe('metadata verification', () => {
  it('accepts matching size and SHA-256', () => {
    assert.doesNotThrow(() =>
      assertDownloadMetadata(downloadInfo(), CSV_BUFFER.length, sha256Hex(CSV_BUFFER))
    );
  });

  it('rejects a size mismatch', () => {
    assert.throws(
      () => assertDownloadMetadata(downloadInfo(), CSV_BUFFER.length + 1, sha256Hex(CSV_BUFFER)),
      /API reported/
    );
  });

  it('rejects a digest mismatch', () => {
    assert.throws(
      () => assertDownloadMetadata(downloadInfo(), CSV_BUFFER.length, '0'.repeat(64)),
      /SHA-256 verification/
    );
  });
});

describe('Downloads API polling', () => {
  it('returns only new completed downloads', async () => {
    let call = 0;
    const result = await waitForNewDownloads(
      {
        async list() {
          call += 1;
          const downloads =
            call === 1
              ? [downloadInfo({ id: 'old' })]
              : [downloadInfo({ id: 'old' }), downloadInfo({ id: 'new' })];
          return { downloads, summary: { count: downloads.length, totalSize: 0 } };
        },
      },
      'session-1',
      new Set(['old']),
      1_000,
      10,
      async () => undefined
    );
    assert.deepEqual(result.downloads.map((item) => item.id), ['new']);
  });

  it('ignores new downloads that are not available yet', async () => {
    let call = 0;
    const result = await waitForNewDownloads(
      {
        async list() {
          call += 1;
          const item = downloadInfo({ status: call === 1 ? 'processing' : 'available' });
          return { downloads: [item], summary: { count: 1, totalSize: item.size } };
        },
      },
      'session-1',
      new Set(),
      1_000,
      10,
      async () => undefined
    );
    assert.equal(result.downloads[0].status, 'available');
  });
});

describe('artifact persistence', () => {
  it('saves files, a ZIP archive, and a JSON manifest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lexmount-download-files-'));
    try {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
      const saved = await saveDownloadArtifacts({
        resource: {
          async get() {
            return CSV_BUFFER;
          },
          async archive() {
            return zip;
          },
        },
        sessionId: 'session-1',
        downloads: [downloadInfo()],
        outputDir: root,
        source: {
          mode: 'controlled_demo',
          requested_url: null,
          final_url: 'about:blank',
          locator: '#download-csv',
        },
        browserDownload: {
          guid: 'guid-1',
          suggested_filename: CONTROLLED_DEMO_FILENAME,
          source_url: 'data:text/csv;base64,...',
          received_bytes: CSV_BUFFER.length,
          total_bytes: CSV_BUFFER.length,
        },
        generatedAt: '2026-08-06T10:00:01.000Z',
      });

      assert.deepEqual(await readFile(saved.file_paths[0]), CSV_BUFFER);
      assert.deepEqual(await readFile(saved.archive_path), zip);
      const manifest = JSON.parse(await readFile(saved.manifest_path, 'utf8'));
      assert.equal(manifest.template, 'download-files');
      assert.equal(manifest.files[0].sha256, sha256Hex(CSV_BUFFER));
      assert.equal(manifest.files[0].downloaded_at, '2026-08-06T10:00:00.000Z');
      assert.equal(manifest.archive.sha256, sha256Hex(zip));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a non-ZIP archive response', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lexmount-download-files-'));
    try {
      await assert.rejects(
        saveDownloadArtifacts({
          resource: {
            async get() {
              return CSV_BUFFER;
            },
            async archive() {
              return Buffer.from('not a zip');
            },
          },
          sessionId: 'session-1',
          downloads: [downloadInfo()],
          outputDir: root,
          source: {
            mode: 'controlled_demo',
            requested_url: null,
            final_url: 'about:blank',
            locator: '#download-csv',
          },
          browserDownload: {
            guid: 'guid-1',
            suggested_filename: CONTROLLED_DEMO_FILENAME,
            source_url: 'data:text/csv;base64,...',
            received_bytes: CSV_BUFFER.length,
            total_bytes: CSV_BUFFER.length,
          },
        }),
        /ZIP file signature/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
