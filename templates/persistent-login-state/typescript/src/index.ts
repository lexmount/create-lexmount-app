import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount, type SessionInfo } from 'lexmount';
import { chromium, type Browser, type Page } from 'playwright';
import {
  assertExpectedDashboardUrl,
  DEFAULT_LOGIN_URL,
  isExpectedDashboardUrl,
  LOGIN_ACCOUNT_SELECTOR,
  LOGIN_PASSWORD_SELECTOR,
  LOGIN_SUBMIT_SELECTOR,
  LOGIN_SUCCESS_SELECTOR,
  resolveLoginTimeoutSeconds,
  STATE_CREATED_BY,
  STATE_SCHEMA_VERSION,
  validateTargetUrl,
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
  login_completed: true;
  dashboard_visible: true;
};

type VerifyResult = {
  command: 'verify';
  context_id: string;
  session_id: string;
  target_url: string;
  context_mode: 'readWrite';
  login_state_reused: true;
  dashboard_visible: true;
  verified: true;
};

type SessionPage = {
  session: SessionInfo;
  browser: Browser;
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
      const loginTimeoutMs =
        resolveLoginTimeoutSeconds(process.env.LOGIN_TIMEOUT_SECONDS) * 1_000;
      console.log(
        JSON.stringify(
          await setupPersistentState(
            client,
            stateFile,
            targetUrl,
            loginTimeoutMs
          ),
          null,
          2
        )
      );
    } else if (command === 'verify') {
      console.log(JSON.stringify(await verifyPersistentState(client, stateFile), null, 2));
    } else if (command === 'demo') {
      const loginTimeoutMs =
        resolveLoginTimeoutSeconds(process.env.LOGIN_TIMEOUT_SECONDS) * 1_000;
      const setup = await setupPersistentState(
        client,
        stateFile,
        targetUrl,
        loginTimeoutMs
      );
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
  targetUrl: string | undefined,
  loginTimeoutMs: number
): Promise<SetupResult> {
  await assertStateFileMissing(targetStateFile);
  const requestedUrl = validateTargetUrl(targetUrl ?? DEFAULT_LOGIN_URL);
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
    let sessionClosed = false;
    const { session } = sessionPage;
    try {
      await sessionPage.page.goto(requestedUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await loginToTDesign(
        sessionPage.page,
        requestedUrl.origin,
        loginTimeoutMs
      );
      const finalUrl = assertExpectedDashboardUrl(
        sessionPage.page.url(),
        requestedUrl.origin
      );

      const storedState: StoredContextState = {
        schema_version: STATE_SCHEMA_VERSION,
        created_by: STATE_CREATED_BY,
        context_id: persistentContext.id,
        target_url: finalUrl.toString(),
        origin: finalUrl.origin,
        created_at: new Date().toISOString(),
      };
      await closeSessionPage(sessionPage);
      sessionClosed = true;
      await waitForContextAvailable(client, persistentContext.id);
      await writeContextState(targetStateFile, storedState);
      stateWritten = true;

      return {
        command: 'setup',
        context_id: persistentContext.id,
        session_id: session.id,
        target_url: storedState.target_url,
        state_file: targetStateFile,
        login_completed: true,
        dashboard_visible: true,
      };
    } finally {
      if (!sessionClosed) {
        await closeSessionPage(sessionPage);
      }
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
    await assertDashboardVisible(sessionPage.page, storedState.origin, 60_000);
    const finalUrl = assertExpectedDashboardUrl(
      sessionPage.page.url(),
      storedState.origin
    );
    if (finalUrl.origin !== storedState.origin) {
      throw new Error(
        `Target origin changed from ${storedState.origin} to ${finalUrl.origin}; browser state is origin-scoped.`
      );
    }

    return {
      command: 'verify',
      context_id: storedState.context_id,
      session_id: sessionPage.session.id,
      target_url: finalUrl.toString(),
      context_mode: 'readWrite',
      login_state_reused: true,
      dashboard_visible: true,
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
  let browser: Browser | undefined;
  try {
    if (session.contextId !== contextId) {
      throw new Error(
        `Session ${session.id} mounted context ${String(session.contextId)} instead of ${contextId}.`
      );
    }
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return { session, browser, page };
  } catch (error) {
    const cleanupErrors = await closeResources(session, browser);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `Session ${session.id} initialization and cleanup both failed.`
      );
    }
    throw error;
  }
}

async function closeSessionPage(sessionPage: SessionPage): Promise<void> {
  const errors = await closeResources(sessionPage.session, sessionPage.browser);
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Failed to fully close Session ${sessionPage.session.id}.`
    );
  }
}

async function loginToTDesign(
  page: Page,
  expectedOrigin: string,
  timeoutMs: number
): Promise<void> {
  const accountField = page.locator(LOGIN_ACCOUNT_SELECTOR);
  const passwordField = page.locator(LOGIN_PASSWORD_SELECTOR);
  await accountField.waitFor({ state: 'visible', timeout: timeoutMs });
  await passwordField.waitFor({ state: 'visible', timeout: timeoutMs });

  if (!(await accountField.inputValue()).trim() || !(await passwordField.inputValue())) {
    throw new Error(
      'The public TDesign demo fields are no longer prefilled. This template intentionally does not accept account credentials; update the demo contract before continuing.'
    );
  }

  await page.locator(LOGIN_SUBMIT_SELECTOR).click({
    timeout: timeoutMs,
  });
  await page.waitForURL(
    (url) => isExpectedDashboardUrl(url, expectedOrigin),
    { timeout: timeoutMs }
  );
  await assertDashboardVisible(page, expectedOrigin, timeoutMs);
}

async function assertDashboardVisible(
  page: Page,
  expectedOrigin: string,
  timeoutMs: number
): Promise<void> {
  try {
    await page.locator(LOGIN_SUCCESS_SELECTOR).first().waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
  } catch {
    const currentUrl = validateTargetUrl(page.url());
    throw new Error(
      `TDesign login state was not available at ${currentUrl.origin}${currentUrl.pathname}.`
    );
  }
  assertExpectedDashboardUrl(page.url(), expectedOrigin);
}

async function closeResources(
  session: SessionInfo,
  browser: Browser | undefined
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await session.close();
  } catch (error) {
    errors.push(error);
  }
  return errors;
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
