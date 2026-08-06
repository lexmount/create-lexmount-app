import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authorizeWithBrowser,
  discoverCredentials,
  openExternalUrl,
  parseEnvFile,
  resolveConnectBaseUrl,
} from '../bin/auth.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const cliPath = path.join(repositoryRoot, 'bin', 'create-lexmount-app.js');
const packageVersion = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
).version;

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'create-lexmount-app-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(cwd, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const name of [
    'LEXMOUNT_API_KEY',
    'LEXMOUNT_PROJECT_ID',
    'LEXMOUNT_BASE_URL',
    'LEXMOUNT_WEBFETCH_BASE_URL',
    'LEXMOUNT_BROWSER_CREDENTIALS_FILE',
    'LEXMOUNT_WEBFETCH_CREDENTIALS_FILE',
    'XDG_CONFIG_HOME',
  ]) {
    delete env[name];
  }
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });
}

function testCredentials(cwd, overrides = {}) {
  return {
    LEXMOUNT_API_KEY: 'sk_test_not_a_real_secret',
    LEXMOUNT_PROJECT_ID: 'project_test',
    LEXMOUNT_BASE_URL: 'https://api.lexmount.cn',
    XDG_CONFIG_HOME: path.join(cwd, 'empty-config'),
    ...overrides,
  };
}

function createFakeNpm(cwd) {
  const binDirectory = path.join(cwd, 'bin');
  const logPath = path.join(cwd, 'package-manager.log');
  mkdirSync(binDirectory);
  const npmPath = path.join(
    binDirectory,
    process.platform === 'win32' ? 'npm.cmd' : 'npm'
  );
  const contents =
    process.platform === 'win32'
      ? '@echo off\r\n>>"%FAKE_NPM_LOG%" echo %*\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_NPM_LOG"\n';
  writeFileSync(npmPath, contents);
  if (process.platform !== 'win32') chmodSync(npmPath, 0o755);
  return { binDirectory, logPath };
}

test('generates the screenshot TypeScript template and a protected local env', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      '--template',
      'screenshot',
      '--language',
      'typescript',
      '--no-install',
    ], testCredentials(cwd));

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-screenshot');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-screenshot');
    assert.equal(generatedPackage.scripts.screenshot, 'tsx src/index.ts');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /client\.sessions\.create/);
    assert.match(
      generatedSource,
      /new Lexmount\(region \? \{ region \} : \{\}\)/
    );
    assert.match(generatedSource, /page\.goto\(targetUrl/);
    assert.match(generatedSource, /page\.screenshot/);
    const inspectLogIndex = generatedSource.indexOf(
      'console.log(`Inspect URL: ${session.inspectUrl}`)'
    );
    assert.ok(inspectLogIndex >= 0);
    assert.ok(inspectLogIndex < generatedSource.indexOf('chromium.connectOverCDP'));
    assert.ok(inspectLogIndex < generatedSource.indexOf('page.goto(targetUrl'));
    assert.doesNotMatch(
      generatedSource,
      /EXPECTED_TEXT|matched|recording/
    );
    assert.match(
      readFileSync(path.join(destination, '.env.example'), 'utf8'),
      /LEXMOUNT_PROJECT_ID=/
    );
    assert.doesNotMatch(
      readFileSync(path.join(destination, '.env.example'), 'utf8'),
      /^LEXMOUNT_REGION=/m
    );
    assert.match(
      readFileSync(path.join(destination, '.env.example'), 'utf8'),
      /^# LEXMOUNT_REGION=your_catalog_region_id$/m
    );
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /artifacts\//
    );
    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(generatedEnv, /^LEXMOUNT_BASE_URL=https:\/\/api\.lexmount\.cn$/m);
    if (process.platform !== 'win32') {
      assert.equal(statSync(path.join(destination, '.env')).mode & 0o777, 0o600);
    }
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
    assert.match(result.stdout, /API key hidden/);
  });
});

test('generates the WebFetch webpage-to-json TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      [
        '--template',
        'webpage-to-json',
        '--language',
        'typescript',
        '--no-install',
      ],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-webpage-to-json');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-webpage-to-json');
    assert.equal(generatedPackage.scripts.extract, 'tsx src/index.ts');
    assert.equal(generatedPackage.dependencies.dotenv, '^16.5.0');
    assert.equal(generatedPackage.dependencies.lexmount, undefined);
    assert.equal(generatedPackage.dependencies.playwright, undefined);
    assert.equal(generatedPackage.allowScripts.esbuild, true);

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /\/v1\/extract/);
    assert.match(generatedSource, /'X-API-Key': apiKey/);
    assert.match(generatedSource, /'X-Project-Id': projectId/);
    assert.match(generatedSource, /main_text: result\.main_text/);
    assert.match(generatedSource, /links: result\.links/);
    assert.match(generatedSource, /images: result\.images/);
    assert.doesNotMatch(generatedSource, /sessions\.create|connectOverCDP|playwright/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /^\.env$/m
    );
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('generates the search-results-to-json TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      [
        '--template',
        'search-results-to-json',
        '--language',
        'typescript',
        '--no-install',
      ],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-search-results-to-json');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-search-results-to-json');
    assert.equal(generatedPackage.scripts.search, 'tsx src/index.ts');
    assert.equal(generatedPackage.scripts.test, 'tsx --test tests/config.test.ts');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.equal(generatedPackage.dependencies.playwright, '^1.52.0');
    assert.equal(generatedPackage.allowScripts.esbuild, true);

    const generatedConfig = JSON.parse(
      readFileSync(path.join(destination, 'config', 'baidu.json'), 'utf8')
    );
    assert.equal(generatedConfig.search.input.by, 'role');
    assert.equal(generatedConfig.search.submit.role, 'button');
    assert.equal(generatedConfig.results.item.by, 'css');

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /client\.sessions\.create/);
    assert.match(generatedSource, /chromium\.connectOverCDP/);
    assert.match(generatedSource, /session\?\.close/);
    assert.match(generatedSource, /session_id/);
    assert.match(generatedSource, /elapsed_ms/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /^artifacts\/$/m
    );
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('generates the web-check TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      ['--template', 'web-check', '--language', 'typescript', '--no-install'],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-web-check');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-web-check');
    assert.equal(generatedPackage.scripts['check:web'], 'tsx src/index.ts');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.equal(generatedPackage.dependencies.playwright, '^1.52.0');
    assert.equal(generatedPackage.allowScripts.esbuild, true);

    const generatedChecks = JSON.parse(
      readFileSync(path.join(destination, 'inputs', 'checks.json'), 'utf8')
    );
    assert.equal(generatedChecks.checks.length, 7);
    assert.equal(generatedChecks.checks[3].action, 'fill');

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /recording: \{ persistent: true \}/);
    assert.match(generatedSource, /chromium\.connectOverCDP/);
    assert.match(generatedSource, /persistEvidenceAndClose/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /^artifacts\/\*\.json$/m
    );
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('generates the persistent-login-state TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      [
        '--template',
        'persistent-login-state',
        '--language',
        'typescript',
        '--no-install',
      ],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-persistent-login-state');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-persistent-login-state');
    assert.equal(generatedPackage.scripts.demo, 'tsx src/index.ts demo');
    assert.equal(generatedPackage.scripts.cleanup, 'tsx src/index.ts cleanup');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.equal(generatedPackage.dependencies.playwright, '^1.52.0');

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /client\.contexts\.create/);
    assert.match(generatedSource, /context: \{ id: contextId, mode \}/);
    assert.match(generatedSource, /cookie_persisted/);
    assert.match(generatedSource, /local_storage_persisted/);
    assert.match(generatedSource, /client\.contexts\.delete/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /^\.lexmount\/$/m
    );
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('generates the parallel-browser-sessions TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      [
        '--template',
        'parallel-browser-sessions',
        '--language',
        'typescript',
        '--no-install',
      ],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-parallel-browser-sessions');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-parallel-browser-sessions');
    assert.equal(generatedPackage.scripts.browse, 'tsx src/index.ts');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.equal(generatedPackage.dependencies.playwright, '^1.52.0');

    const generatedInput = JSON.parse(
      readFileSync(path.join(destination, 'inputs', 'urls.json'), 'utf8')
    );
    assert.equal(generatedInput.urls.length, 3);

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /allSettledWithConcurrency/);
    assert.match(generatedSource, /client\.sessions\.create/);
    assert.match(generatedSource, /client\.sessions\.delete/);
    assert.match(generatedSource, /successful_results|aggregateResults/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.match(
      readFileSync(path.join(destination, '.gitignore'), 'utf8'),
      /^artifacts\/$/m
    );
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('generates the human-in-the-loop TypeScript template', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(
      cwd,
      ['--template', 'human-in-the-loop', '--language', 'typescript', '--no-install'],
      testCredentials(cwd)
    );

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-human-in-the-loop');
    const generatedPackage = JSON.parse(
      readFileSync(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(generatedPackage.name, 'lexmount-human-in-the-loop');
    assert.equal(generatedPackage.scripts.handoff, 'tsx src/index.ts');
    assert.equal(generatedPackage.dependencies.lexmount, '^0.5.15');
    assert.equal(generatedPackage.dependencies.playwright, '^1.52.0');

    const generatedSource = readFileSync(
      path.join(destination, 'src', 'index.ts'),
      'utf8'
    );
    assert.match(generatedSource, /Remote View:/);
    assert.match(generatedSource, /waitForHumanApproval/);
    assert.match(generatedSource, /session_preserved_during_handoff/);
    assert.match(generatedSource, /session\.close/);

    const generatedPage = readFileSync(
      path.join(destination, 'src', 'handoff.ts'),
      'utf8'
    );
    assert.match(generatedPage, /批准并继续/);
    assert.match(generatedPage, /body\[data-handoff-state="approved"\]/);

    const generatedEnv = readFileSync(path.join(destination, '.env'), 'utf8');
    assert.match(generatedEnv, /^LEXMOUNT_PROJECT_ID=project_test$/m);
    assert.match(generatedEnv, /^LEXMOUNT_API_KEY=sk_test_not_a_real_secret$/m);
    assert.doesNotMatch(result.stdout, /sk_test_not_a_real_secret/);
  });
});

test('supports a custom destination and renders a valid package name', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      'My Browser Check',
      '--template=screenshot',
      '--language=typescript',
      '--no-install',
    ], testCredentials(cwd));

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
      'screenshot',
      '--language',
      'python',
      '--no-install',
    ], testCredentials(cwd));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported language for screenshot: python/);
    assert.match(result.stderr, /Supported languages: typescript/);
  });
});

test('rejects an unknown template name', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      '--template',
      'unknown-template',
      '--language',
      'typescript',
      '--no-install',
    ], testCredentials(cwd));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported template: unknown-template/);
    assert.match(
      result.stderr,
      /Supported templates: screenshot, webpage-to-json, search-results-to-json, web-check, persistent-login-state, parallel-browser-sessions, human-in-the-loop/
    );
  });
});

test('refuses to overwrite a non-empty destination', () => {
  withTemporaryDirectory((cwd) => {
    const destination = path.join(cwd, 'existing');
    writeFileSync(destination, 'not a directory');

    const result = runCli(cwd, [
      'existing',
      '--template',
      'screenshot',
      '--language',
      'typescript',
      '--no-install',
    ], testCredentials(cwd));

    assert.equal(result.status, 1);
    assert.match(result.stderr, /exists and is not a directory/);
  });
});

test('--no-auth supports offline generation without creating .env', () => {
  withTemporaryDirectory((cwd) => {
    const result = runCli(cwd, [
      '--template',
      'screenshot',
      '--language',
      'typescript',
      '--no-install',
      '--no-auth',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(cwd, 'lexmount-screenshot');
    assert.equal(existsSync(path.join(destination, '.env')), false);
    assert.match(result.stdout, /cp \.env\.example \.env/);
  });
});

test('installs and immediately runs the generated screenshot example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'screenshot', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFileSync(logPath, 'utf8').trim().split(/\r?\n/),
      [
        'install',
        'run screenshot -- --url https://example.com',
      ]
    );
    assert.match(result.stdout, /Running screenshot example/);
    assert.doesNotMatch(result.stdout, /Next steps:/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated WebFetch example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'webpage-to-json', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(logPath, 'utf8').trim().split(/\r?\n/), [
      'install',
      'run extract -- --url https://example.com',
    ]);
    assert.match(result.stdout, /Running WebFetch extraction example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated search results example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'search-results-to-json', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
    assert.equal(commands[0], 'install');
    assert.match(
      commands[1],
      /^run search -- --query "?Lexmount browser"? --limit 3$/
    );
    assert.match(result.stdout, /Running search results extraction example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated web check example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'web-check', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(logPath, 'utf8').trim().split(/\r?\n/), [
      'install',
      'run check:web --',
    ]);
    assert.match(result.stdout, /Running recorded web check example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated persistent login state example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'persistent-login-state', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(logPath, 'utf8').trim().split(/\r?\n/), [
      'install',
      'run demo -- --url https://example.com',
    ]);
    assert.match(result.stdout, /Running persistent login state example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated parallel browser sessions example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'parallel-browser-sessions', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(logPath, 'utf8').trim().split(/\r?\n/), [
      'install',
      'run browse --',
    ]);
    assert.match(result.stdout, /Running parallel browser sessions example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('installs and immediately runs the generated human handoff example', () => {
  withTemporaryDirectory((cwd) => {
    const { binDirectory, logPath } = createFakeNpm(cwd);

    const result = runCli(
      cwd,
      ['--template', 'human-in-the-loop', '--language', 'typescript'],
      testCredentials(cwd, {
        FAKE_NPM_LOG: logPath,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        npm_config_user_agent: 'npm/10.0.0 node/v22.0.0',
      })
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(logPath, 'utf8').trim().split(/\r?\n/), [
      'install',
      'run handoff --',
    ]);
    assert.match(result.stdout, /Running human handoff example/);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });
});

test('prints help and version without requiring template flags', () => {
  const help = runCli(repositoryRoot, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--template <name>/);
  assert.match(help.stdout, /webpage-to-json/);
  assert.match(help.stdout, /search-results-to-json/);
  assert.match(help.stdout, /web-check/);
  assert.match(help.stdout, /persistent-login-state/);
  assert.match(help.stdout, /parallel-browser-sessions/);
  assert.match(help.stdout, /human-in-the-loop/);

  const version = runCli(repositoryRoot, ['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageVersion);
});

test('parses exported and quoted dotenv credentials', () => {
  assert.deepEqual(
    parseEnvFile(
      'export LEXMOUNT_API_KEY="secret"\nLEXMOUNT_PROJECT_ID=project-1\n'
    ),
    {
      LEXMOUNT_API_KEY: 'secret',
      LEXMOUNT_PROJECT_ID: 'project-1',
    }
  );
});

test('discovers matching browser-cli credentials without exposing values', () => {
  withTemporaryDirectory((cwd) => {
    const configRoot = path.join(cwd, 'config');
    const credentialsDirectory = path.join(
      configRoot,
      'lexmount',
      'browser-cli'
    );
    mkdirSync(credentialsDirectory, { recursive: true });
    writeFileSync(
      path.join(credentialsDirectory, 'credentials.json'),
      JSON.stringify({
        kind: 'api_key',
        api_key: 'file-secret',
        project_id: 'file-project',
        api_base_url: 'https://api.lexmount.com',
      })
    );

    const discovered = discoverCredentials({
      cwd,
      env: { XDG_CONFIG_HOME: configRoot },
      homeDirectory: cwd,
    });
    assert.equal(discovered.credentials.source, 'browser-cli credentials');
    assert.equal(discovered.credentials.projectId, 'file-project');
    assert.equal(discovered.apiBaseUrl, 'https://api.lexmount.com');
  });
});

test('discovers webfetch-cli credentials', () => {
  withTemporaryDirectory((cwd) => {
    const configRoot = path.join(cwd, 'config');
    const browserCredentialsDirectory = path.join(
      configRoot,
      'lexmount',
      'browser-cli'
    );
    const credentialsDirectory = path.join(
      configRoot,
      'lexmount',
      'webfetch-cli'
    );
    mkdirSync(browserCredentialsDirectory, { recursive: true });
    mkdirSync(credentialsDirectory, { recursive: true });
    writeFileSync(
      path.join(browserCredentialsDirectory, 'credentials.json'),
      JSON.stringify({
        kind: 'api_key',
        api_key: 'browser-secret',
        project_id: 'browser-project',
        api_base_url: 'https://api.lexmount.cn',
      })
    );
    writeFileSync(
      path.join(credentialsDirectory, 'credentials.json'),
      JSON.stringify({
        api_key: 'webfetch-secret',
        project_id: 'webfetch-project',
        api_base_url: 'https://api.lexmount.com',
      })
    );

    const discovered = discoverCredentials({
      cwd,
      env: { XDG_CONFIG_HOME: configRoot },
      homeDirectory: cwd,
      preferredCli: 'webfetch-cli',
    });
    assert.equal(discovered.credentials.source, 'webfetch-cli credentials');
    assert.equal(discovered.credentials.projectId, 'webfetch-project');
    assert.equal(discovered.apiBaseUrl, 'https://api.lexmount.com');
  });
});

test('maps office and qcloud-hk API hosts to their authorization consoles', () => {
  assert.equal(
    resolveConnectBaseUrl('https://apitest.local.lexmount.net'),
    'https://test.local.lexmount.net'
  );
  assert.equal(
    resolveConnectBaseUrl('https://api.lexmount.com'),
    'https://browser.lexmount.com'
  );
  assert.equal(
    resolveConnectBaseUrl('https://api.lexmount.cn'),
    'https://browser.lexmount.cn'
  );
});

test('browser opener returns after spawn without waiting for the opener to exit', async () => {
  const child = new EventEmitter();
  let unrefCalled = false;
  child.unref = () => {
    unrefCalled = true;
  };

  const opened = openExternalUrl('https://browser.lexmount.cn/connect/codex', {
    platform: 'linux',
    spawnImpl: (command, args, options) => {
      assert.equal(command, 'xdg-open');
      assert.deepEqual(args, [
        'https://browser.lexmount.cn/connect/codex',
      ]);
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });

  assert.equal(await opened, true);
  assert.equal(unrefCalled, true);
});

test('completes loopback PKCE authorization and exchanges credentials', async () => {
  let exchangeBody;
  let callbackConnectionHeader;
  const callbackAgent = new http.Agent({ keepAlive: true });
  const progress = [];
  const exchangeServer = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      exchangeBody = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          credential: {
            api_key: 'authorized-secret',
            project_id: 'authorized-project',
            api_base_url: exchangeBaseUrl,
          },
        })
      );
    });
  });
  await new Promise((resolve) => exchangeServer.listen(0, '127.0.0.1', resolve));
  const address = exchangeServer.address();
  assert.ok(address && typeof address !== 'string');
  const exchangeBaseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const authorizationStartedAt = Date.now();
    const credentials = await authorizeWithBrowser({
      apiBaseUrl: exchangeBaseUrl,
      connectBaseUrl: exchangeBaseUrl,
      intent: 'scaffold-webfetch-example',
      scopes: ['browser:read'],
      timeoutMs: 2_000,
      openUrl: async (url) => {
        const connectUrl = new URL(url);
        assert.equal(connectUrl.searchParams.get('intent'), 'scaffold-webfetch-example');
        assert.equal(connectUrl.searchParams.get('scope'), 'browser:read');
        const callbackUrl = new URL(connectUrl.searchParams.get('redirect_uri'));
        callbackUrl.searchParams.set('code', 'one-time-code');
        callbackUrl.searchParams.set('state', connectUrl.searchParams.get('state'));
        await new Promise((resolve, reject) => {
          const request = http.get(
            callbackUrl,
            { agent: callbackAgent },
            (response) => {
              callbackConnectionHeader = response.headers.connection;
              response.resume();
              response.once('end', resolve);
            }
          );
          request.once('error', reject);
        });
        return true;
      },
      onProgress: (message) => progress.push(message),
    });
    const authorizationDurationMs = Date.now() - authorizationStartedAt;

    assert.equal(credentials.projectId, 'authorized-project');
    assert.equal(credentials.apiKey, 'authorized-secret');
    assert.equal(credentials.apiBaseUrl, exchangeBaseUrl);
    assert.equal(exchangeBody.code, 'one-time-code');
    assert.match(exchangeBody.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.match(exchangeBody.redirect_uri, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(callbackConnectionHeader, 'close');
    assert.ok(
      authorizationDurationMs < 1_000,
      `authorization took ${authorizationDurationMs}ms`
    );
    assert.deepEqual(progress, [
      'Authorization callback received. Exchanging credentials...',
      'Lexmount credentials received. Preparing project...',
    ]);
  } finally {
    callbackAgent.destroy();
    exchangeServer.closeIdleConnections?.();
    exchangeServer.closeAllConnections?.();
    await new Promise((resolve) => exchangeServer.close(resolve));
  }
});
