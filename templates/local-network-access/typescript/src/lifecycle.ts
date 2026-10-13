import { setTimeout as delay } from 'node:timers/promises';
import {
  APIError,
  AuthenticationError,
  NetworkError,
  SessionNotFoundError,
  TimeoutError,
  type LocalTunnel,
  type SessionCreateOptions,
  type SessionInfo,
} from 'lexmount';
import type { Browser } from 'playwright';

type Tunnel = Pick<LocalTunnel, 'id' | 'regionId' | 'close'> & {
  on(event: 'disconnect' | 'ready', listener: () => void): unknown;
  off(event: 'disconnect' | 'ready', listener: () => void): unknown;
};
type Session = Pick<SessionInfo, 'id' | 'regionId' | 'connectUrl'>;
type Page = {
  goto(
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number }
  ): Promise<unknown>;
};
export type BrowserConnection = {
  contexts(): Array<{ pages(): Page[]; newPage(): Promise<Page> }>;
  close(): Promise<void>;
};
export type LocalAccessClient = {
  tunnels: { open(): Promise<Tunnel> };
  sessions: {
    create(options: SessionCreateOptions): Promise<Session>;
    get(id: string): Promise<{ status: string }>;
  };
  close(): void;
};
type Options = {
  client: LocalAccessClient;
  targetUrl: string;
  signal: AbortSignal;
  connect: (url: string) => Promise<BrowserConnection | Browser>;
  log: (message: string) => void;
  pollIntervalMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export class LocalAccessError extends Error {}

// Never include raw SDK/Playwright errors: they can contain URLs and credentials.
export function failureHint(error: unknown): string {
  if (
    error instanceof AuthenticationError ||
    (error instanceof APIError && error.statusCode === 401)
  ) {
    return 'Authorization is no longer valid. Reauthorize with Lexmount.';
  }
  if (error instanceof APIError && error.statusCode === 403) {
    return 'Check the project permission for local/custom proxies and the selected region.';
  }
  if (error instanceof APIError && error.statusCode === 503) {
    return 'Local proxy is unavailable in this region. Check its availability in the console.';
  }
  if (error instanceof APIError && error.statusCode === 429) {
    return 'Check the project quota and concurrent session limit in the console.';
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return 'Check your network/VPN connection and regional service availability.';
  }
  return 'Check the cloud console and your local network/VPN connection.';
}

export async function runLocalNetworkAccess({
  client,
  targetUrl,
  signal,
  connect,
  log,
  pollIntervalMs = 5_000,
  wait = async (ms, abortSignal) => {
    await delay(ms, undefined, { signal: abortSignal });
  },
}: Options): Promise<void> {
  let tunnel: Tunnel | undefined;
  let session: Session | undefined;
  let browser: BrowserConnection | undefined;
  let sessionEnded = false;
  let stopping = false;
  let stage = 'establish the local tunnel';
  let disconnectBrowser: Promise<void> | undefined;
  const detach = () => {
    if (!browser) return Promise.resolve();
    // For connectOverCDP, close() disconnects this client, leaving the remote browser running.
    disconnectBrowser ??= browser.close();
    return disconnectBrowser;
  };
  const onAbort = () => {
    void detach().catch(() => {});
  };
  const onDisconnect = () => {
    if (!stopping && !signal.aborted)
      log(
        'Local tunnel disconnected. The SDK is reconnecting; keep this terminal and VPN open.'
      );
  };
  const onReady = () => {
    if (!stopping && !signal.aborted)
      log(
        'Local tunnel reconnected. Retry any failed page navigation in the cloud console.'
      );
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    signal.throwIfAborted();
    tunnel = await client.tunnels.open();
    tunnel.on('disconnect', onDisconnect);
    tunnel.on('ready', onReady);
    signal.throwIfAborted();
    stage = 'create the cloud browser session';
    session = await client.sessions.create({
      browserMode: 'normal',
      proxy: { type: 'local', tunnelId: tunnel.id },
      pollTimeoutMs: 120_000,
    });
    signal.throwIfAborted();
    if (session.regionId && session.regionId !== tunnel.regionId) {
      throw new LocalAccessError(
        'The session and tunnel are in different regions. Stop the session in the console and select one enabled region.'
      );
    }

    stage = 'open the target in the cloud browser';
    try {
      browser = await connect(session.connectUrl);
      signal.throwIfAborted();
      const context = browser.contexts()[0];
      if (!context) throw new Error('No default browser context');
      const page = context.pages()[0] ?? (await context.newPage());
      signal.throwIfAborted();
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      log(
        'The initial page could not be opened. The session is kept for you to inspect or navigate in the cloud console.'
      );
    }
    // Do not retain an automation connection while the user operates the browser.
    await detach();
    signal.throwIfAborted();
    log(
      'Session available in the cloud console. Keep this terminal and any required VPN running. Stop the session in the console when finished.'
    );

    let monitoringFailed = false;
    let failures = 0;
    stage = 'monitor the cloud browser session';
    while (!signal.aborted) {
      try {
        const current = await client.sessions.get(session.id);
        if (current.status === 'closed') {
          sessionEnded = true;
          break;
        }
        if (monitoringFailed) log('Session status connection restored.');
        monitoringFailed = false;
        failures = 0;
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          sessionEnded = true;
          break;
        }
        if (signal.aborted) break;
        if (!monitoringFailed)
          log(
            `Unable to check session status; keeping the tunnel open and retrying. ${failureHint(error)}`
          );
        monitoringFailed = true;
        failures = Math.min(failures + 1, 3);
      }
      await wait(Math.min(pollIntervalMs * 2 ** failures, 30_000), signal);
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error instanceof LocalAccessError
        ? error
        : new LocalAccessError(`Could not ${stage}. ${failureHint(error)}`);
    }
  } finally {
    stopping = true;
    signal.removeEventListener('abort', onAbort);
    tunnel?.off('disconnect', onDisconnect);
    tunnel?.off('ready', onReady);
    let cleanupFailed = false;
    try {
      await detach();
    } catch {
      cleanupFailed = true;
      log('Could not confirm the automation connection was disconnected.');
    }
    try {
      await tunnel?.close();
    } catch {
      cleanupFailed = true;
      log(
        'The local connection has stopped, but tunnel revocation could not be confirmed.'
      );
    } finally {
      client.close();
    }
    if (sessionEnded) {
      log('Cloud session ended. Local tunnel stopped.');
    } else if (session) {
      log(
        'Local tunnel stopped. The cloud session was NOT stopped and may still be billed. Stop it in the cloud console.'
      );
    }
    if (cleanupFailed && !signal.aborted)
      throw new LocalAccessError(
        'Local cleanup could not be fully confirmed. Check the cloud console.'
      );
  }
}
