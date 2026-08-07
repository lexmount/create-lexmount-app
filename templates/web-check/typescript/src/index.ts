import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser } from 'playwright';
import { loadCheckPlan } from './input.js';
import { persistEvidenceAndClose } from './lifecycle.js';
import {
  createReport,
  finishExecution,
  markRuntimeError,
  replayConsoleUrl,
  writeJsonReport,
} from './report.js';
import { executeChecks, getOrCreateNewestPage, safeErrorMessage } from './runner.js';

loadEnv({ path: '.env.local', override: false });
loadEnv({ override: false });

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

main().catch((error: unknown) => {
  console.error(`Web check failed before a report could be completed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const inputPath = path.resolve(
    values.input ?? process.env.CHECKS_PATH ?? path.join(projectRoot, 'inputs', 'checks.json')
  );
  const outputPath = path.resolve(
    values.output ??
      process.env.REPORT_PATH ??
      path.join(projectRoot, 'artifacts', 'web-check-report.json')
  );
  const plan = await loadCheckPlan(inputPath);
  if (values['timeout-ms'] !== undefined || process.env.STEP_TIMEOUT_MS !== undefined) {
    const raw = values['timeout-ms'] ?? process.env.STEP_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 300_000) {
      throw new Error('--timeout-ms / STEP_TIMEOUT_MS must be an integer from 1000 through 300000.');
    }
    plan.timeout_ms = parsed;
  }

  const report = createReport(plan, path.relative(process.cwd(), inputPath));
  const region = process.env.LEXMOUNT_REGION?.trim();
  report.session.region = region || null;
  const client = new Lexmount(region ? { region } : {});
  let session: SessionInfo | undefined;
  let browser: Browser | undefined;

  try {
    session = await client.sessions.create({
      browserMode: 'normal',
      recording: { persistent: true },
    });
    report.session.id = session.id;
    report.session.region = session.regionId || region || null;
    report.session.inspect_url = session.inspectUrl;
    report.session.replay_console_url = replayConsoleUrl(session.id);
    report.session.closure.status = 'pending';

    console.error(`[session] Created ${session.id} with persistent Recording enabled.`);
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await getOrCreateNewestPage(context);
    finishExecution(report, await executeChecks(page, plan));
  } catch (error: unknown) {
    markRuntimeError(report, error);
  }

  let lifecycleFailed = false;
  if (session) {
    const lifecycle = await persistEvidenceAndClose({
      report,
      writeReport: () => writeJsonReport(outputPath, report),
      closeBrowser: async () => {
        if (browser) await browser.close();
      },
      closeSession: () => session!.close(),
    });
    lifecycleFailed =
      !lifecycle.pre_close_report_written ||
      !lifecycle.final_report_written ||
      lifecycle.session_close_error !== null;
    if (lifecycle.browser_close_error) {
      console.error(`Browser disconnect warning: ${lifecycle.browser_close_error}`);
    }
    if (lifecycle.final_report_error) {
      console.error(`Final report write failed: ${lifecycle.final_report_error}`);
    }
  } else {
    report.evidence.phase = 'final';
    await writeJsonReport(outputPath, report);
  }
  client.close();

  console.log(JSON.stringify(report, null, 2));
  console.error(`Saved machine-readable report to ${path.relative(process.cwd(), outputPath)}`);
  if (report.session.id && report.session.replay_console_url) {
    console.error(
      `Replay: open ${report.session.replay_console_url} and find Session ${report.session.id}.`
    );
  }

  if (lifecycleFailed || report.status === 'error') {
    process.exitCode = 1;
  } else if (report.status === 'failed') {
    process.exitCode = 2;
  }
}
