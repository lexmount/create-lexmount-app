import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  assertPersistedState,
  DEMO_COOKIE_NAME,
  DEMO_COOKIE_TTL_SECONDS,
  DEMO_COOKIE_VALUE,
  DEMO_STORAGE_KEY,
  DEMO_STORAGE_VALUE,
  STATE_CREATED_BY,
  STATE_SCHEMA_VERSION,
  validateTargetUrl,
  type PersistedStateObservation,
  type StoredContextState,
} from './state.js';
import {
  assertStateFileMissing,
  readContextState,
  removeContextState,
  resolveStateFile,
  writeContextState,
} from './state-file.js';

config({ path: '.env.local', override: false });
config({ override: false });

type Command = 'setup' | 'verify' | 'demo' | 'cleanup';

type SetupResult = {
  command: 'setup';
  context_id: string;
  session_id: string;
  target_url: string;
  state_file: string;
  cookie_established: true;
  local_storage_established: true;
};

type VerifyResult = {
  command: 'verify';
  context_id: string;
  session_id: string;
  target_url: string;
  context_mode: 'readWrite';
  cookie_persisted: boolean;
  local_storage_persisted: boolean;
  verified: true;
};

type SessionPage = {
  session: SessionInfo;
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Persistent login state demo failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      url: { type: 'string' },
      'state-file': { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });
  const command = parseCommand(positionals[0]);
  if (positionals.length > 1) {
    throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(' ')}`);
  }

  const stateFile = resolveStateFile(values['state-file'] ?? process.env.STATE_FILE);
  const targetUrl = values.url ?? process.env.TARGET_URL;
  const region = process.env.LEXMOUNT_REGION?.trim();
  const client = new Lexmount(region ? { region } : {});
  try {
    if (command === 'setup') {
      console.log(
        JSON.stringify(await setupPersistentState(client, stateFile, targetUrl), null, 2)
      );
    } else if (command === 'verify') {
      console.log(JSON.stringify(await verifyPersistentState(client, stateFile), null, 2));
    } else if (command === 'demo') {
      const setup = await setupPersistentState(client, stateFile, targetUrl);
      const verify = await verifyPersistentState(client, stateFile);
      console.log(JSON.stringify({ command: 'demo', setup, verify }, null, 2));
    } else {
      console.log(JSON.stringify(await cleanupPersistentState(client, stateFile), null, 2));
    }
  } finally {
    client.close();
  }
}

function parseCommand(value: string | undefined): Command {
  const command = value ?? 'demo';
  if (command === 'setup' || command === 'verify' || command === 'demo' || command === 'cleanup') {
    return command;
  }
  throw new Error(`Unknown command ${JSON.stringify(command)}. Use setup, verify, demo, or cleanup.`);
}

async function setupPersistentState(
  client: Lexmount,
  targetStateFile: string,
  targetUrl: string | undefined
): Promise<SetupResult> {
  await assertStateFileMissing(targetStateFile);
  const requestedUrl = validateTargetUrl(
    targetUrl ?? 'https://example.com'
  );
  const persistentContext = await client.contexts.create({
    description: 'Persistent login state TypeScript template',
    metadata: {
      template: STATE_CREATED_BY,
      site: requestedUrl.hostname,
    },
  });

  let stateWritten = false;
  try {
    const sessionPage = await createSessionPage(client, persistentContext.id, 'readWrite');
    const { session } = sessionPage;
    try {
      await sessionPage.page.goto(requestedUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const finalUrl = validateTargetUrl(sessionPage.page.url());
      await establishDemoState(sessionPage.context, sessionPage.page, finalUrl.origin);
      const observation = await observeDemoState(
        sessionPage.context,
        sessionPage.page,
        finalUrl.origin
      );
      assertPersistedState(observation);

      const storedState: StoredContextState = {
        schema_version: STATE_SCHEMA_VERSION,
        created_by: STATE_CREATED_BY,
        context_id: persistentContext.id,
        target_url: finalUrl.toString(),
        origin: finalUrl.origin,
        created_at: new Date().toISOString(),
      };
      await closeSessionPage(sessionPage);
      await waitForContextAvailable(client, persistentContext.id);
      await writeContextState(targetStateFile, storedState);
      stateWritten = true;

      return {
        command: 'setup',
        context_id: persistentContext.id,
        session_id: session.id,
        target_url: storedState.target_url,
        state_file: targetStateFile,
        cookie_established: true,
        local_storage_established: true,
      };
    } finally {
      await closeSessionPage(sessionPage);
    }
  } finally {
    if (!stateWritten) {
      await deleteNewContextAfterFailure(client, persistentContext.id);
    }
  }
}

async function verifyPersistentState(
  client: Lexmount,
  targetStateFile: string
): Promise<VerifyResult> {
  const storedState = await readContextState(targetStateFile);
  const contextInfo = await client.contexts.get(storedState.context_id);
  if (!contextInfo.isAvailable()) {
    throw new Error(
      `Context ${storedState.context_id} is ${contextInfo.status}; close the session using it before verification.`
    );
  }

  // The public API currently rejects readOnly contexts. This second Session is
  // still verification-only, but uses the supported readWrite access mode.
  const sessionPage = await createSessionPage(client, storedState.context_id, 'readWrite');
  try {
    await sessionPage.page.goto(storedState.target_url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const finalUrl = validateTargetUrl(sessionPage.page.url());
    if (finalUrl.origin !== storedState.origin) {
      throw new Error(
        `Target origin changed from ${storedState.origin} to ${finalUrl.origin}; browser state is origin-scoped.`
      );
    }

    const observation = await observeDemoState(
      sessionPage.context,
      sessionPage.page,
      storedState.origin
    );
    assertPersistedState(observation);
    return {
      command: 'verify',
      context_id: storedState.context_id,
      session_id: sessionPage.session.id,
      target_url: finalUrl.toString(),
      context_mode: 'readWrite',
      cookie_persisted: observation.cookie === DEMO_COOKIE_VALUE,
      local_storage_persisted: observation.local_storage === DEMO_STORAGE_VALUE,
      verified: true,
    };
  } finally {
    await closeSessionPage(sessionPage);
    await waitForContextAvailable(client, storedState.context_id);
  }
}

async function cleanupPersistentState(client: Lexmount, targetStateFile: string) {
  const storedState = await readContextState(targetStateFile);
  const contextInfo = await client.contexts.get(storedState.context_id);
  if (!contextInfo.isAvailable()) {
    throw new Error(
      `Refusing to delete context ${storedState.context_id} while its status is ${contextInfo.status}.`
    );
  }
  if (
    contextInfo.metadata.template !== STATE_CREATED_BY &&
    contextInfo.description !== 'Persistent login state TypeScript template'
  ) {
    throw new Error(
      `Refusing to delete context ${storedState.context_id}: ownership metadata does not match this project.`
    );
  }

  await client.contexts.delete(storedState.context_id);
  await removeContextState(targetStateFile);
  return {
    command: 'cleanup' as const,
    context_id: storedState.context_id,
    context_deleted: true,
    state_file_deleted: true,
  };
}

async function createSessionPage(
  client: Lexmount,
  contextId: string,
  mode: 'readWrite' | 'readOnly'
): Promise<SessionPage> {
  const session = await client.sessions.create({
    browserMode: 'normal',
    context: { id: contextId, mode },
  });
  console.log(`${mode} session inspect URL: ${session.inspectUrl}`);
  if (session.contextId !== contextId) {
    await session.close();
    throw new Error(
      `Session ${session.id} mounted context ${String(session.contextId)} instead of ${contextId}.`
    );
  }

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
  } catch (error) {
    await session.close();
    throw error;
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { session, browser, context, page };
}

async function closeSessionPage(sessionPage: SessionPage): Promise<void> {
  await sessionPage.browser.close().catch(() => undefined);
  await sessionPage.session.close();
}

async function establishDemoState(
  context: BrowserContext,
  page: Page,
  origin: string
): Promise<void> {
  await context.addCookies([
    {
      name: DEMO_COOKIE_NAME,
      value: DEMO_COOKIE_VALUE,
      url: origin,
      sameSite: 'Lax',
      secure: origin.startsWith('https:'),
      expires: Math.floor(Date.now() / 1_000) + DEMO_COOKIE_TTL_SECONDS,
    },
  ]);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: DEMO_STORAGE_KEY, value: DEMO_STORAGE_VALUE }
  );
}

async function observeDemoState(
  context: BrowserContext,
  page: Page,
  origin: string
): Promise<PersistedStateObservation> {
  const cookies = await context.cookies(origin);
  const cookie = cookies.find((candidate) => candidate.name === DEMO_COOKIE_NAME);
  const localStorageValue = await page.evaluate(
    (key) => localStorage.getItem(key),
    DEMO_STORAGE_KEY
  );
  return {
    cookie: cookie?.value ?? null,
    local_storage: localStorageValue,
  };
}

async function waitForContextAvailable(
  client: Lexmount,
  contextId: string,
  timeoutMs = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const context = await client.contexts.get(contextId);
    if (context.isAvailable()) {
      return;
    }
    if (!context.isLocked()) {
      throw new Error(`Context ${contextId} has unexpected status ${context.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Context ${contextId} did not become available within ${timeoutMs} ms.`);
}

async function deleteNewContextAfterFailure(client: Lexmount, contextId: string): Promise<void> {
  try {
    await waitForContextAvailable(client, contextId, 15_000);
    await client.contexts.delete(contextId);
  } catch (cleanupError: unknown) {
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    console.error(`Automatic cleanup of context ${contextId} failed: ${message}`);
  }
}
