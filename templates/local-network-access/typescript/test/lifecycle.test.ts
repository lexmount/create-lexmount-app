import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  APIError,
  SessionNotFoundError,
  type SessionCreateOptions,
} from 'lexmount';
import {
  runLocalNetworkAccess,
  type BrowserConnection,
  type LocalAccessClient,
} from '../src/lifecycle.js';

function fixture() {
  const calls: string[] = [];
  const logs: string[] = [];
  const controller = new AbortController();
  class Tunnel extends EventEmitter {
    id = 'private-tunnel-id';
    regionId = 'test-region';
    ready = true;
    async close() {
      calls.push('tunnel.close');
      this.ready = false;
    }
  }
  const tunnel = new Tunnel();
  const session = {
    id: 'private-session-id',
    regionId: 'test-region',
    connectUrl: 'wss://example.invalid/?api_key=private-secret',
    async close() {
      calls.push('session.close');
    },
  };
  const statuses: Array<string | Error> = ['active', 'closed'];
  let createOptions: SessionCreateOptions | undefined;
  const client: LocalAccessClient = {
    tunnels: {
      async open() {
        calls.push('tunnel.open');
        return tunnel;
      },
    },
    sessions: {
      async create(options) {
        calls.push('session.create');
        createOptions = options;
        return session;
      },
      async get(id) {
        assert.equal(id, session.id);
        calls.push('session.get');
        const current = statuses.shift();
        if (current instanceof Error) throw current;
        return { status: current ?? 'closed' };
      },
    },
    close() {
      calls.push('client.close');
    },
  };
  const page = {
    async goto(url: string) {
      assert.equal(url, 'https://intranet.example/');
      calls.push('page.goto');
    },
  };
  const browser: BrowserConnection = {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    async close() {
      calls.push('browser.disconnect');
    },
  };
  const options = {
    client,
    targetUrl: 'https://intranet.example/',
    signal: controller.signal,
    async connect(url: string) {
      assert.equal(url, session.connectUrl);
      calls.push('browser.connect');
      return browser;
    },
    log: (message: string) => {
      logs.push(message);
    },
    wait: async (_ms: number, _signal: AbortSignal) => {},
  };
  return {
    calls,
    logs,
    controller,
    client,
    session,
    tunnel,
    statuses,
    browser,
    page,
    options,
    getCreateOptions: () => createOptions,
  };
}

test('keeps the active session/tunnel until the console stops it; only disconnects automation', async () => {
  const f = fixture();
  let resume!: () => void;
  let paused!: () => void;
  const reachedWait = new Promise<void>((resolve) => {
    paused = resolve;
  });
  f.options.wait = async () => {
    paused();
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
  };
  const running = runLocalNetworkAccess(f.options);
  await reachedWait;
  assert.equal(f.tunnel.ready, true);
  assert.ok(f.calls.includes('browser.disconnect'));
  assert.ok(!f.calls.includes('tunnel.close'));
  assert.ok(!f.calls.includes('session.close'));
  assert.deepEqual(f.getCreateOptions(), {
    browserMode: 'normal',
    proxy: { type: 'local', tunnelId: f.tunnel.id },
    pollTimeoutMs: 120_000,
  });
  resume();
  await running;
  assert.deepEqual(f.calls.slice(-2), ['tunnel.close', 'client.close']);
  assert.ok(!f.calls.includes('session.close'));
  assert.equal(
    f.calls.filter((call) => call === 'browser.disconnect').length,
    1
  );
  assert.match(f.logs.join('\n'), /Cloud session ended/);
  assert.doesNotMatch(
    f.logs.join('\n'),
    /private-|Inspect|screenshot|intranet\.example/
  );
});

test('a confirmed session-not-found response ends the connector', async () => {
  const f = fixture();
  f.statuses.splice(0, 2, new SessionNotFoundError('private-session-id'));
  await runLocalNetworkAccess(f.options);
  assert.match(f.logs.join('\n'), /Cloud session ended/);
  assert.ok(!f.calls.includes('session.close'));
});

test('status errors and transitional/unknown states keep the tunnel open', async () => {
  const f = fixture();
  f.statuses.splice(
    0,
    2,
    new APIError('private-secret', { statusCode: 503 }),
    new APIError('private-secret', { statusCode: 401 }),
    'closing',
    'unknown-status',
    'active',
    'closed'
  );
  const waits: number[] = [];
  f.options.wait = async (ms) => {
    waits.push(ms);
    assert.equal(f.tunnel.ready, true);
  };
  await runLocalNetworkAccess(f.options);
  assert.deepEqual(waits, [10_000, 20_000, 5_000, 5_000, 5_000]);
  assert.equal(
    f.logs.filter((line) => line.includes('Unable to check')).length,
    1
  );
  assert.match(f.logs.join('\n'), /status connection restored/);
  assert.doesNotMatch(f.logs.join('\n'), /private-secret/);
});

for (const failure of ['navigation', 'connection', 'missing-context']) {
  test(`${failure} failure leaves the session available for console use`, async () => {
    const f = fixture();
    if (failure === 'navigation')
      f.page.goto = async () => {
        throw new Error('private-secret');
      };
    if (failure === 'connection')
      f.options.connect = async () => {
        throw new Error('private-secret');
      };
    if (failure === 'missing-context') f.browser.contexts = () => [];
    f.options.wait = async () => {
      assert.equal(f.tunnel.ready, true);
    };
    await runLocalNetworkAccess(f.options);
    assert.match(f.logs.join('\n'), /initial page could not be opened/);
    assert.ok(f.calls.includes('session.get'));
    assert.ok(!f.calls.includes('session.close'));
    assert.doesNotMatch(f.logs.join('\n'), /private-secret/);
  });
}

test('local interruption revokes the tunnel and preserves the cloud session', async () => {
  const f = fixture();
  f.options.wait = async () => {
    f.controller.abort();
    f.controller.signal.throwIfAborted();
  };
  await runLocalNetworkAccess(f.options);
  assert.match(f.logs.join('\n'), /cloud session was NOT stopped/);
  assert.ok(!f.calls.includes('session.close'));
  assert.deepEqual(f.calls.slice(-2), ['tunnel.close', 'client.close']);
});

test('pre-start cancellation allocates nothing', async () => {
  const f = fixture();
  f.controller.abort();
  await runLocalNetworkAccess(f.options);
  assert.deepEqual(f.calls, ['client.close']);
});

test('cancellation while creating a session preserves it and closes the tunnel', async () => {
  const f = fixture();
  const create = f.client.sessions.create;
  f.client.sessions.create = async (options) => {
    f.controller.abort();
    return create(options);
  };
  await runLocalNetworkAccess(f.options);
  assert.ok(!f.calls.includes('browser.connect'));
  assert.ok(!f.calls.includes('session.close'));
  assert.match(f.logs.join('\n'), /NOT stopped/);
  assert.deepEqual(f.calls.slice(-2), ['tunnel.close', 'client.close']);
});

test('cancellation during navigation disconnects automation to unblock the pending call', async () => {
  const f = fixture();
  let rejectNavigation!: (error: Error) => void;
  f.page.goto = async () => {
    queueMicrotask(() => f.controller.abort());
    return new Promise<void>((_resolve, reject) => {
      rejectNavigation = reject;
    });
  };
  f.browser.close = async () => {
    f.calls.push('browser.disconnect');
    rejectNavigation(new Error('private-secret'));
  };
  await runLocalNetworkAccess(f.options);
  assert.equal(
    f.calls.filter((call) => call === 'browser.disconnect').length,
    1
  );
  assert.ok(!f.calls.includes('session.close'));
  assert.doesNotMatch(f.logs.join('\n'), /private-secret/);
});

test('tunnel creation failure does not attempt to create a cloud session', async () => {
  const f = fixture();
  f.client.tunnels.open = async () => {
    throw new APIError('private-secret', { statusCode: 503 });
  };
  await assert.rejects(
    runLocalNetworkAccess(f.options),
    /unavailable in this region/
  );
  assert.deepEqual(f.calls, ['client.close']);
});

test('session creation failure closes the tunnel and redacts SDK errors', async () => {
  const f = fixture();
  f.client.sessions.create = async () => {
    throw new APIError('private-secret', { statusCode: 403 });
  };
  await assert.rejects(runLocalNetworkAccess(f.options), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /project permission/);
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
  assert.deepEqual(f.calls.slice(-2), ['tunnel.close', 'client.close']);
});

test('region mismatch stops local forwarding without deleting the created session', async () => {
  const f = fixture();
  f.session.regionId = 'different-region';
  await assert.rejects(runLocalNetworkAccess(f.options), /different regions/);
  assert.ok(!f.calls.includes('browser.connect'));
  assert.ok(!f.calls.includes('session.close'));
  assert.match(f.logs.join('\n'), /NOT stopped/);
});

test('tunnel cleanup failure still closes the SDK and never claims complete cleanup', async () => {
  const f = fixture();
  f.tunnel.close = async () => {
    throw new Error('private-secret');
  };
  await assert.rejects(
    runLocalNetworkAccess(f.options),
    /cleanup could not be fully confirmed/
  );
  assert.equal(f.calls.at(-1), 'client.close');
  assert.match(f.logs.join('\n'), /revocation could not be confirmed/);
  assert.doesNotMatch(f.logs.join('\n'), /private-secret/);
});

test('reconnection is reported without replaying navigation and listeners are removed', async () => {
  const f = fixture();
  f.options.wait = async () => {
    f.tunnel.emit('disconnect');
    f.tunnel.emit('ready');
  };
  await runLocalNetworkAccess(f.options);
  assert.match(f.logs.join('\n'), /reconnecting/);
  assert.match(f.logs.join('\n'), /reconnected/);
  assert.equal(f.calls.filter((call) => call === 'page.goto').length, 1);
  assert.equal(f.tunnel.listenerCount('ready'), 0);
  assert.equal(f.tunnel.listenerCount('disconnect'), 0);
});
