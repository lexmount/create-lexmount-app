import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseStoredContextState,
  type StoredContextState,
} from './state.js';

export const DEFAULT_STATE_FILE = '.lexmount/persistent-login-state.json';

export function resolveStateFile(value: string | undefined): string {
  return path.resolve(process.cwd(), value?.trim() || DEFAULT_STATE_FILE);
}

export async function readContextState(stateFile: string): Promise<StoredContextState> {
  let source: string;
  try {
    source = await readFile(stateFile, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `State file not found: ${stateFile}. Run the setup command first.`
      );
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`State file is not valid JSON: ${stateFile}`);
  }
  return parseStoredContextState(parsed);
}

export async function assertStateFileMissing(stateFile: string): Promise<void> {
  try {
    await readFile(stateFile, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw new Error(
    `State file already exists: ${stateFile}. Verify or clean up the existing context before creating another one.`
  );
}

export async function writeContextState(
  stateFile: string,
  state: StoredContextState
): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryFile, stateFile);
}

export async function removeContextState(stateFile: string): Promise<void> {
  await unlink(stateFile);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
