export type LifecycleStatus = {
  creation: {
    status: 'pending' | 'created' | 'failed';
    at: string | null;
    error?: string;
  };
  completion: {
    status: 'pending' | 'completed' | 'failed' | 'skipped';
    at: string | null;
    error?: string;
  };
  closure: {
    status: 'pending' | 'closed' | 'failed' | 'not_required';
    at: string | null;
    error?: string;
  };
};

export type SessionReport = LifecycleStatus & {
  session_id: string | null;
  inspect_url: string | null;
};

export type PageObservation = {
  status: number | null;
  title: string;
  h1: string | null;
  final_url: string;
  page_elapsed_ms: number;
};

export type UrlSuccess = {
  input_index: number;
  requested_url: string;
  elapsed_ms: number;
  session: SessionReport;
  page: PageObservation;
};

export type UrlFailure = {
  input_index: number;
  requested_url: string;
  elapsed_ms: number;
  error: string;
  session: SessionReport;
  page?: PageObservation;
};

export class UrlTaskError extends Error {
  readonly failure: UrlFailure;

  constructor(failure: UrlFailure) {
    super(failure.error);
    this.name = 'UrlTaskError';
    this.failure = failure;
  }
}

export type BatchOutput = {
  template: 'parallel-browser-sessions';
  summary: {
    started_at: string;
    completed_at: string;
    elapsed_ms: number;
    concurrency: number;
    requested: number;
    succeeded: number;
    failed: number;
    sessions: {
      created: number;
      creation_failed: number;
      completed: number;
      task_failed: number;
      closed: number;
      close_failed: number;
    };
  };
  successful_results: UrlSuccess[];
  failed_results: UrlFailure[];
};

type AggregateOptions = {
  urls: string[];
  concurrency: number;
  startedAt: string;
  completedAt: string;
};

export function aggregateResults(
  settled: PromiseSettledResult<UrlSuccess>[],
  options: AggregateOptions
): BatchOutput {
  const successfulResults: UrlSuccess[] = [];
  const failedResults: UrlFailure[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      successfulResults.push(result.value);
      return;
    }
    if (result.reason instanceof UrlTaskError) {
      failedResults.push(result.reason.failure);
      return;
    }
    const message = safeErrorMessage(result.reason);
    failedResults.push({
      input_index: index,
      requested_url: options.urls[index] ?? '<unknown>',
      elapsed_ms: 0,
      error: message,
      session: {
        session_id: null,
        inspect_url: null,
        creation: { status: 'failed', at: null, error: message },
        completion: { status: 'skipped', at: null },
        closure: { status: 'not_required', at: null },
      },
    });
  });

  successfulResults.sort((left, right) => left.input_index - right.input_index);
  failedResults.sort((left, right) => left.input_index - right.input_index);
  const allSessions = [
    ...successfulResults.map((result) => result.session),
    ...failedResults.map((result) => result.session),
  ];

  return {
    template: 'parallel-browser-sessions',
    summary: {
      started_at: options.startedAt,
      completed_at: options.completedAt,
      elapsed_ms: Math.max(
        0,
        Date.parse(options.completedAt) - Date.parse(options.startedAt)
      ),
      concurrency: options.concurrency,
      requested: options.urls.length,
      succeeded: successfulResults.length,
      failed: failedResults.length,
      sessions: {
        created: countStatus(allSessions, 'creation', 'created'),
        creation_failed: countStatus(allSessions, 'creation', 'failed'),
        completed: countStatus(allSessions, 'completion', 'completed'),
        task_failed: countStatus(allSessions, 'completion', 'failed'),
        closed: countStatus(allSessions, 'closure', 'closed'),
        close_failed: countStatus(allSessions, 'closure', 'failed'),
      },
    },
    successful_results: successfulResults,
    failed_results: failedResults,
  };
}

export function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.LEXMOUNT_API_KEY;
  if (apiKey) message = message.replaceAll(apiKey, '***');
  return message.replace(
    /([?&](?:api_?key|access_token|token|key)=)[^&\s]+/gi,
    '$1***'
  );
}

function countStatus(
  sessions: SessionReport[],
  stage: keyof LifecycleStatus,
  status: string
): number {
  return sessions.filter((session) => session[stage].status === status).length;
}
