import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const cliPath = path.join(repositoryRoot, 'bin', 'create-lexmount-app.js');

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'create-lexmount-app-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('generates the exact web-check TypeScript command into the default directory', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      '--template',
      'web-check',
      '--language',
      'typescript',
      '--no-install',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-web-check');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-web-check');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.match(
      readFileSync(path.join(destination, 'src', 'index.ts'), 'utf8'),
      /recording: \{ persistent: true \}/
    );
    assert.match(
      readFileSync(path.join(destination, '.env.example'), 'utf8'),
      /LEXMOUNT_PROJECT_ID=/
    );
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /artifacts\//
    );
  });
});

test('supports a custom destination and renders a valid package name', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      'My Browser Check',
      '--template=web-check',
      '--language=typescript',
      '--no-install',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const generatedPackage = JSON.parse(
      readFileSync(path.join(cwd, 'My Browser Check', 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'my-browser-check');
  });
});

test('rejects unsupported languages with a useful message', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      '--template',
      'web-check',
      '--language',
      'python',
      '--no-install',
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported language for web-check: python/);
    assert.match(result.stderr, /Supported languages: typescript/);
  });
});

test('refuses to overwrite a non-empty destination', () => {
  withTemporaryDirectory((cwd) => {
    const destination = path.join(cwd, 'existing');
    writeFileSync(destination, 'not a directory');

    const result = runCli(cwd, [
      'existing',
      '--template',
      'web-check',
      '--language',
      'typescript',
      '--no-install',
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /exists and is not a directory/);
  });
});

test('prints help and version without requiring template flags', () => {
  const help = runCli(repositoryRoot, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--template <name>/);

  const version = runCli(repositoryRoot, ['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), '0.1.0');
});
