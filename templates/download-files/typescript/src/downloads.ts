import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CONTROLLED_DEMO_FILENAME = 'lexmount-downloads-demo.csv';
export const CONTROLLED_DEMO_CSV = [
  'order_id,customer,total,currency',
  'LM-1001,Ada Lovelace,125.50,USD',
  'LM-1002,Grace Hopper,89.00,USD',
  'LM-1003,Linus Torvalds,210.75,USD',
  '',
].join('\r\n');

export type DownloadInfo = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  sha256: string | null;
  status: string;
  createdAt: string;
};

export type DownloadListResult = {
  downloads: DownloadInfo[];
  summary: {
    count: number;
    totalSize: number;
  };
};

export type DownloadsResource = {
  list(sessionId: string): Promise<DownloadListResult>;
  get(sessionId: string, downloadId: string): Promise<Buffer>;
  archive(sessionId: string): Promise<Buffer>;
};

export type DownloadSource = {
  mode: 'controlled_demo' | 'target_url';
  requested_url: string | null;
  final_url: string;
  locator: string;
};

export type BrowserDownloadObservation = {
  guid: string;
  suggested_filename: string;
  source_url: string;
  received_bytes: number;
  total_bytes: number;
};

export type SavedArtifacts = {
  output_dir: string;
  manifest_path: string;
  archive_path: string;
  file_paths: string[];
  manifest: DownloadManifest;
};

export type DownloadManifest = {
  schema_version: 1;
  template: 'download-files';
  generated_at: string;
  session_id: string;
  source: DownloadSource;
  browser_download: BrowserDownloadObservation;
  summary: {
    download_count: number;
    total_size_bytes: number;
  };
  files: Array<{
    id: string;
    filename: string;
    local_filename: string;
    local_path: string;
    size_bytes: number;
    content_type: string | null;
    sha256: string;
    downloaded_at: string;
    saved_at: string;
  }>;
  archive: {
    local_path: string;
    size_bytes: number;
    sha256: string;
  };
};

export function buildControlledDownloadPage(): string {
  const csvBase64 = Buffer.from(CONTROLLED_DEMO_CSV, 'utf8').toString('base64');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Lexmount Downloads API demo</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; background: #f4f7fb; color: #172033; }
      main { max-width: 720px; margin: 12vh auto; padding: 40px; background: white; border-radius: 18px; box-shadow: 0 18px 60px rgba(26, 45, 80, .12); }
      h1 { margin-top: 0; }
      p { line-height: 1.6; }
      a { display: inline-block; margin-top: 14px; padding: 12px 18px; border-radius: 10px; background: #1457d9; color: white; text-decoration: none; font-weight: 650; }
    </style>
  </head>
  <body>
    <main>
      <h1>Controlled CSV download</h1>
      <p>This page is generated inside the remote browser so the Downloads API can be tested without an external file host.</p>
      <a id="download-csv" download="${CONTROLLED_DEMO_FILENAME}" href="data:text/csv;charset=utf-8;base64,${csvBase64}">Download demo CSV</a>
    </main>
  </body>
</html>`;
}

export async function waitForNewDownloads(
  resource: Pick<DownloadsResource, 'list'>,
  sessionId: string,
  existingIds: ReadonlySet<string>,
  timeoutMs: number,
  pollIntervalMs: number,
  sleep: (milliseconds: number) => Promise<void> = delay
): Promise<DownloadListResult> {
  const deadline = Date.now() + timeoutMs;
  let latest: DownloadListResult | undefined;

  while (Date.now() < deadline) {
    latest = await resource.list(sessionId);
    const fresh = latest.downloads.filter(
      (download) =>
        !existingIds.has(download.id) &&
        ['available', 'completed'].includes(download.status.toLowerCase())
    );
    if (fresh.length > 0) {
      return {
        downloads: fresh,
        summary: {
          count: fresh.length,
          totalSize: fresh.reduce((total, download) => total + download.size, 0),
        },
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  const statusSummary = latest?.downloads
    .filter((download) => !existingIds.has(download.id))
    .map((download) => `${download.filename || download.id}:${download.status}`)
    .join(', ');
  throw new Error(
    `Downloads API did not expose a completed file within ${timeoutMs} ms` +
      (statusSummary ? ` (latest: ${statusSummary})` : '.')
  );
}

export async function saveDownloadArtifacts(options: {
  resource: Pick<DownloadsResource, 'get' | 'archive'>;
  sessionId: string;
  downloads: DownloadInfo[];
  outputDir: string;
  source: DownloadSource;
  browserDownload: BrowserDownloadObservation;
  generatedAt?: string;
}): Promise<SavedArtifacts> {
  if (options.downloads.length === 0) {
    throw new Error('Cannot save artifacts without at least one download.');
  }

  const filesDir = path.join(options.outputDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const allocatedNames = allocateLocalFilenames(options.downloads);
  const manifestFiles: DownloadManifest['files'] = [];
  const filePaths: string[] = [];

  for (let index = 0; index < options.downloads.length; index += 1) {
    const download = options.downloads[index];
    const contents = await options.resource.get(options.sessionId, download.id);
    const digest = sha256Hex(contents);
    assertDownloadMetadata(download, contents.length, digest);

    const localFilename = allocatedNames[index];
    const localPath = path.join(filesDir, localFilename);
    await writeFile(localPath, contents);
    const savedAt = new Date().toISOString();
    filePaths.push(localPath);
    manifestFiles.push({
      id: download.id,
      filename: download.filename,
      local_filename: localFilename,
      local_path: toPortableRelativePath(options.outputDir, localPath),
      size_bytes: contents.length,
      content_type: download.contentType,
      sha256: digest,
      downloaded_at: download.createdAt,
      saved_at: savedAt,
    });
  }

  const archive = await options.resource.archive(options.sessionId);
  if (!isZipBuffer(archive)) {
    throw new Error('Downloads archive did not contain a ZIP file signature.');
  }
  const archivePath = path.join(options.outputDir, 'downloads.zip');
  await writeFile(archivePath, archive);

  const manifest: DownloadManifest = {
    schema_version: 1,
    template: 'download-files',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    session_id: options.sessionId,
    source: options.source,
    browser_download: options.browserDownload,
    summary: {
      download_count: manifestFiles.length,
      total_size_bytes: manifestFiles.reduce((total, file) => total + file.size_bytes, 0),
    },
    files: manifestFiles,
    archive: {
      local_path: toPortableRelativePath(options.outputDir, archivePath),
      size_bytes: archive.length,
      sha256: sha256Hex(archive),
    },
  };
  const manifestPath = path.join(options.outputDir, 'download-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    output_dir: options.outputDir,
    manifest_path: manifestPath,
    archive_path: archivePath,
    file_paths: filePaths,
    manifest,
  };
}

export function createRunDirectoryName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function sha256Hex(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

export function sanitizeDownloadFilename(filename: string, fallback: string): string {
  const normalizedSeparators = filename.replace(/\\/g, '/');
  let candidate = path.posix.basename(normalizedSeparators).trim();
  candidate = candidate
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!candidate) candidate = fallback;

  const stem = candidate.split('.')[0]?.toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
    candidate = `_${candidate}`;
  }
  return candidate.slice(0, 180) || fallback;
}

export function allocateLocalFilenames(downloads: DownloadInfo[]): string[] {
  const used = new Set<string>();
  return downloads.map((download, index) => {
    const base = sanitizeDownloadFilename(download.filename, `download-${index + 1}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      const extension = path.extname(base);
      const stem = base.slice(0, base.length - extension.length);
      candidate = `${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function assertDownloadMetadata(
  download: DownloadInfo,
  actualSize: number,
  actualSha256: string
): void {
  if (download.size !== actualSize) {
    throw new Error(
      `Downloaded file ${JSON.stringify(download.filename)} has ${actualSize} bytes; the API reported ${download.size}.`
    );
  }
  if (download.sha256 && download.sha256.toLowerCase() !== actualSha256.toLowerCase()) {
    throw new Error(
      `Downloaded file ${JSON.stringify(download.filename)} failed SHA-256 verification.`
    );
  }
}

function isZipBuffer(contents: Uint8Array): boolean {
  if (contents.length < 4) return false;
  return (
    contents[0] === 0x50 &&
    contents[1] === 0x4b &&
    ((contents[2] === 0x03 && contents[3] === 0x04) ||
      (contents[2] === 0x05 && contents[3] === 0x06) ||
      (contents[2] === 0x07 && contents[3] === 0x08))
  );
}

function toPortableRelativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
