import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Lexmount } from 'lexmount';
import { chromium } from 'playwright';
import { InputError, resolveTargetUrl } from './input.js';
import {
  failureHint,
  LocalAccessError,
  runLocalNetworkAccess,
} from './lifecycle.js';

config({ path: '.env.local', override: false });
config({ override: false });

async function main(): Promise<void> {
  const controller = new AbortController();
  let receivedSignal: NodeJS.Signals | undefined;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map((name) => {
    const handler = () => {
      receivedSignal = name;
      controller.abort();
    };
    process.on(name, handler);
    return handler;
  });
  try {
    let values;
    try {
      ({ values } = parseArgs({
        options: { url: { type: 'string' } },
        strict: true,
        allowPositionals: false,
      }));
    } catch {
      throw new InputError(
        'Use npm start, or npm start -- --url <intranet-url>.'
      );
    }
    const targetUrl = await resolveTargetUrl(
      values.url ?? process.env.TARGET_URL,
      controller
    );
    controller.signal.throwIfAborted();
    const region = process.env.LEXMOUNT_REGION?.trim();
    const client = new Lexmount({
      region: region || undefined,
      logLevel: 'SILENT',
      timeout: 15_000,
    });
    await runLocalNetworkAccess({
      client,
      targetUrl,
      signal: controller.signal,
      connect: (url) => chromium.connectOverCDP(url, { timeout: 30_000 }),
      log: (message) => console.log(message),
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      // lifecycle.ts only throws curated messages; unknown initialization errors stay redacted.
      console.error(
        error instanceof InputError || error instanceof LocalAccessError
          ? error.message
          : `Local network access failed. ${failureHint(error)}`
      );
      process.exitCode = 1;
    }
  } finally {
    signals.forEach((name, index) => process.off(name, handlers[index]));
    if (controller.signal.aborted)
      process.exitCode =
        receivedSignal === 'SIGTERM'
          ? 143
          : receivedSignal === 'SIGHUP'
            ? 129
            : 130;
  }
}

await main();
