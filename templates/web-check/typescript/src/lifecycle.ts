import { safeErrorMessage } from './runner.js';
import type { WebCheckReport } from './report.js';

type LifecycleOptions = {
  report: WebCheckReport;
  writeReport: () => Promise<void>;
  closeBrowser: () => Promise<void>;
  closeSession: () => Promise<void>;
  now?: () => Date;
};

export type LifecycleResult = {
  pre_close_report_written: boolean;
  final_report_written: boolean;
  browser_close_error: string | null;
  session_close_error: string | null;
  final_report_error: string | null;
};

export async function persistEvidenceAndClose({
  report,
  writeReport,
  closeBrowser,
  closeSession,
  now = () => new Date(),
}: LifecycleOptions): Promise<LifecycleResult> {
  let preCloseWritten = false;
  let browserCloseError: string | null = null;
  let sessionCloseError: string | null = null;
  let finalReportError: string | null = null;

  report.evidence.phase = 'pre_close';
  report.evidence.report_written_before_session_close = true;
  try {
    await writeReport();
    preCloseWritten = true;
  } catch (error: unknown) {
    report.evidence.report_written_before_session_close = false;
    report.status = 'error';
    report.error = `Could not write report before closing Session: ${safeErrorMessage(error)}`;
  }

  try {
    await closeBrowser();
  } catch (error: unknown) {
    browserCloseError = safeErrorMessage(error);
  }

  report.session.closure.status = 'pending';
  try {
    await closeSession();
    report.session.closure = {
      status: 'closed',
      at: now().toISOString(),
      error: null,
    };
  } catch (error: unknown) {
    sessionCloseError = safeErrorMessage(error);
    report.session.closure = {
      status: 'failed',
      at: now().toISOString(),
      error: sessionCloseError,
    };
    report.status = 'error';
    report.error = report.error
      ? `${report.error} Session close failed: ${sessionCloseError}`
      : `Session close failed: ${sessionCloseError}`;
  }

  report.evidence.phase = 'final';
  try {
    await writeReport();
  } catch (error: unknown) {
    finalReportError = safeErrorMessage(error);
  }

  return {
    pre_close_report_written: preCloseWritten,
    final_report_written: finalReportError === null,
    browser_close_error: browserCloseError,
    session_close_error: sessionCloseError,
    final_report_error: finalReportError,
  };
}
