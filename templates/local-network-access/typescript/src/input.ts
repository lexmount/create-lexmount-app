import { isIP } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export class InputError extends Error {}

export function validateTargetUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InputError('Enter a complete HTTP(S) intranet or VPN URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InputError('The target must use http:// or https://.');
  }
  if (url.username || url.password) {
    throw new InputError(
      'Do not put login credentials in the URL. Sign in through the cloud console.'
    );
  }
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const loopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (isIP(host) === 4 && host.startsWith('127.')) ||
    host === '::1' ||
    /^::ffff:7f[\da-f]{2}:/i.test(host);
  if (loopback || ['0.0.0.0', '::', '::ffff:0:0'].includes(host)) {
    throw new InputError(
      'Localhost, loopback and unspecified addresses are not supported. Use a company intranet or VPN site.'
    );
  }
  return url.toString();
}

export async function resolveTargetUrl(
  value: string | undefined,
  controller: AbortController
): Promise<string> {
  if (value !== undefined) return validateTargetUrl(value);
  if (!stdin.isTTY) {
    throw new InputError(
      'Run in an interactive terminal, or pass --url with an intranet/VPN URL.'
    );
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  prompt.on('SIGINT', () => controller.abort());
  const onInputClosed = () => controller.abort();
  prompt.once('close', onInputClosed);
  try {
    while (!controller.signal.aborted) {
      const answer = await prompt.question('Company intranet or VPN URL: ', {
        signal: controller.signal,
      });
      try {
        return validateTargetUrl(answer);
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        console.error(error.message);
      }
    }
    controller.signal.throwIfAborted();
    throw new InputError('No URL entered.');
  } finally {
    prompt.off('close', onInputClosed);
    prompt.close();
  }
}
