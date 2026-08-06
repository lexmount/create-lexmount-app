#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  authorizeWithBrowser,
  discoverCredentials,
  resolveConnectBaseUrl,
  writeProjectEnv,
} from './auth.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
);

const DEFAULT_EXAMPLE_URL = 'https://example.com';
const templateDefinitions = new Map([
  [
    'screenshot',
    {
      description: 'Navigate to a URL and capture a full-page screenshot.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'screenshot example',
              script: 'screenshot',
              args: ['--url', DEFAULT_EXAMPLE_URL],
            },
          },
        ],
      ]),
    },
  ],
  [
    'webpage-to-json',
    {
      description: 'Extract structured JSON from a public webpage with WebFetch.',
      credentialSource: 'webfetch-cli',
      connectIntent: 'scaffold-webfetch-example',
      connectScopes: ['browser:read'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'WebFetch extraction example',
              script: 'extract',
              args: ['--url', DEFAULT_EXAMPLE_URL],
            },
          },
        ],
      ]),
    },
  ],
  [
    'search-results-to-json',
    {
      description: 'Search a page and save the first N results as structured JSON.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'search results extraction example',
              script: 'search',
              args: ['--query', 'Lexmount browser', '--limit', '3'],
            },
          },
        ],
      ]),
    },
  ],
  [
    'web-check',
    {
      description: 'Run a JSON web checklist and keep a persistent Recording for replay.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'recorded web check example',
              script: 'check:web',
              args: [],
            },
          },
        ],
      ]),
    },
  ],
  [
    'persistent-login-state',
    {
      description: 'Reuse Cookie and Local Storage state across separate browser Sessions.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'persistent login state example',
              script: 'demo',
              args: ['--url', DEFAULT_EXAMPLE_URL],
            },
          },
        ],
      ]),
    },
  ],
  [
    'parallel-browser-sessions',
    {
      description: 'Process a URL batch in isolated browser Sessions with bounded concurrency.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'parallel browser sessions example',
              script: 'browse',
              args: [],
            },
          },
        ],
      ]),
    },
  ],
  [
    'human-in-the-loop',
    {
      description: 'Pause for human approval and resume automation in the same Session.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'human handoff example',
              script: 'handoff',
              args: [],
            },
          },
        ],
      ]),
    },
  ],
  [
    'download-files',
    {
      description: 'Download remote browser files locally with a manifest and ZIP archive.',
      credentialSource: 'browser-cli',
      connectIntent: 'scaffold-browser-example',
      connectScopes: ['browser:sessions', 'browser:actions'],
      languages: new Map([
        [
          'typescript',
          {
            run: {
              label: 'remote file download example',
              script: 'download',
              args: ['--demo'],
            },
          },
        ],
      ]),
    },
  ],
]);
const supportedTemplateNames = [...templateDefinitions.keys()].join(', ');
const supportedLanguages = [
  ...new Set(
    [...templateDefinitions.values()].flatMap((definition) => [
      ...definition.languages.keys(),
    ])
  ),
].join(', ');

const helpText = `create-lexmount-app

Usage:
  create-lexmount-app [directory] --template <name> --language <language>

Options:
  --template <name>       Template to generate (supported: ${supportedTemplateNames})
  --language <language>   Template language (supported: ${supportedLanguages})
  --no-install            Generate files without installing dependencies or running the example
  --no-auth               Skip local credential discovery and browser authorization
  --connect-base-url      Override the Lexmount console used for authorization
  --help, -h              Show this help
  --version, -v           Show the package version

Examples:
  npx create-lexmount-app --template screenshot --language typescript
  npx create-lexmount-app my-screenshot --template screenshot --language typescript
  npx create-lexmount-app --template webpage-to-json --language typescript
  npx create-lexmount-app --template search-results-to-json --language typescript
  npx create-lexmount-app --template web-check --language typescript
  npx create-lexmount-app --template persistent-login-state --language typescript
  npx create-lexmount-app --template parallel-browser-sessions --language typescript
  npx create-lexmount-app --template human-in-the-loop --language typescript
  npx create-lexmount-app --template download-files --language typescript
`;

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {
    directory: undefined,
    auth: true,
    connectBaseUrl: undefined,
    install: true,
    language: undefined,
    template: undefined,
    help: false,
    version: false,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--version' || argument === '-v') {
      options.version = true;
      continue;
    }
    if (argument === '--no-install') {
      options.install = false;
      continue;
    }
    if (argument === '--no-auth') {
      options.auth = false;
      continue;
    }
    if (argument === '--connect-base-url') {
      options.connectBaseUrl = readOptionValue(
        argv,
        index,
        '--connect-base-url'
      );
      index += 1;
      continue;
    }
    if (argument.startsWith('--connect-base-url=')) {
      options.connectBaseUrl = argument.slice('--connect-base-url='.length);
      continue;
    }
    if (argument === '--template') {
      options.template = readOptionValue(argv, index, '--template');
      index += 1;
      continue;
    }
    if (argument.startsWith('--template=')) {
      options.template = argument.slice('--template='.length);
      continue;
    }
    if (argument === '--language') {
      options.language = readOptionValue(argv, index, '--language');
      index += 1;
      continue;
    }
    if (argument.startsWith('--language=')) {
      options.language = argument.slice('--language='.length);
      continue;
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }

    positionals.push(argument);
  }

  if (positionals.length > 1) {
    throw new Error('Only one destination directory may be provided');
  }
  options.directory = positionals[0];
  return options;
}

function validateSelection(template, language) {
  if (!template) {
    throw new Error('--template is required');
  }
  if (!language) {
    throw new Error('--language is required');
  }

  const templateDefinition = templateDefinitions.get(template);
  if (!templateDefinition) {
    throw new Error(
      `Unsupported template: ${template}. Supported templates: ${supportedTemplateNames}`
    );
  }
  const languageDefinition = templateDefinition.languages.get(language);
  if (!languageDefinition) {
    throw new Error(
      `Unsupported language for ${template}: ${language}. Supported languages: ${[
        ...templateDefinition.languages.keys(),
      ].join(', ')}`
    );
  }
  return { templateDefinition, languageDefinition };
}

function toPackageName(directoryName) {
  const normalized = directoryName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');

  return normalized || 'lexmount-app';
}

function assertWritableDestination(destination) {
  if (!existsSync(destination)) {
    return;
  }
  if (!statSync(destination).isDirectory()) {
    throw new Error(`Destination exists and is not a directory: ${destination}`);
  }
  if (readdirSync(destination).length > 0) {
    throw new Error(`Destination directory is not empty: ${destination}`);
  }
}

function outputName(inputName) {
  if (inputName === '_gitignore') {
    return '.gitignore';
  }
  if (inputName === '_env.example') {
    return '.env.example';
  }
  return inputName;
}

function renderTemplateDirectory(source, destination, replacements) {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, outputName(entry.name));

    if (entry.isDirectory()) {
      renderTemplateDirectory(sourcePath, destinationPath, replacements);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported template entry: ${sourcePath}`);
    }

    let contents = readFileSync(sourcePath, 'utf8');
    for (const [token, value] of Object.entries(replacements)) {
      contents = contents.replaceAll(`{{${token}}}`, value);
    }
    writeFileSync(destinationPath, contents);
  }
}

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('pnpm/')) return 'pnpm';
  if (userAgent.startsWith('yarn/')) return 'yarn';
  if (userAgent.startsWith('bun/')) return 'bun';
  return 'npm';
}

function runPackageManager(packageManager, args, options) {
  if (process.platform === 'win32') {
    return spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', packageManager, ...args],
      options
    );
  }

  return spawnSync(packageManager, args, options);
}

function installDependencies(destination) {
  const packageManager = detectPackageManager();
  const args = packageManager === 'yarn' ? [] : ['install'];

  console.log(`\nInstalling dependencies with ${packageManager}...`);
  const result = runPackageManager(packageManager, args, {
    cwd: destination,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Failed to start ${packageManager}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${packageManager} install failed with exit code ${result.status}`);
  }
  return packageManager;
}

function runGeneratedExample(destination, packageManager, run) {
  console.log(`\nRunning ${run.label}...`);
  const result = runPackageManager(
    packageManager,
    ['run', run.script, '--', ...run.args],
    {
      cwd: destination,
      stdio: 'inherit',
    }
  );
  if (result.error) {
    throw new Error(
      `Failed to start the ${run.label} with ${packageManager}: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${run.label} failed with exit code ${result.status}`
    );
  }
}

function printManualRunInstructions(
  destination,
  packageManager,
  installed,
  credentialsConfigured,
  run
) {
  const relativeDestination = path.relative(process.cwd(), destination) || '.';
  const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;

  console.log(`\nThe ${run.label} was not run automatically:`);
  if (relativeDestination !== '.') {
    console.log(`  cd ${relativeDestination}`);
  }
  if (!credentialsConfigured) {
    console.log('  cp .env.example .env');
    console.log('  # Add LEXMOUNT_API_KEY and LEXMOUNT_PROJECT_ID to .env');
  }
  if (!installed) {
    console.log(`  ${packageManager} install`);
  }
  console.log(`  ${runPrefix} ${run.script} -- ${run.args.join(' ')}`);
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(helpText);
    return;
  }
  if (options.version) {
    console.log(packageMetadata.version);
    return;
  }

  const selection = validateSelection(options.template, options.language);

  const directory = options.directory ?? `lexmount-${options.template}`;
  const destination = path.resolve(process.cwd(), directory);
  assertWritableDestination(destination);

  let credentials;
  if (options.auth) {
    const discovered = discoverCredentials({
      preferredCli: selection.templateDefinition.credentialSource,
    });
    credentials = discovered.credentials;
    if (credentials) {
      credentials = {
        ...credentials,
        apiBaseUrl: discovered.apiBaseUrl,
      };
      console.log(`Using Lexmount credentials from ${credentials.source}.`);
    } else {
      const connectBaseUrl = resolveConnectBaseUrl(
        discovered.apiBaseUrl,
        options.connectBaseUrl
      );
      console.log(
        `No complete local Lexmount credentials found. Opening ${connectBaseUrl} for authorization...`
      );
      credentials = await authorizeWithBrowser({
        apiBaseUrl: discovered.apiBaseUrl,
        connectBaseUrl,
        intent: selection.templateDefinition.connectIntent,
        scopes: selection.templateDefinition.connectScopes,
        onProgress: (message) => console.log(message),
        onManualUrl: (url) => {
          console.log('Open this URL in your browser to continue:');
          console.log(url);
        },
      });
      console.log('Lexmount authorization completed.');
    }
  }

  const source = path.join(
    packageRoot,
    'templates',
    options.template,
    options.language
  );
  if (!existsSync(source)) {
    throw new Error(`Packaged template is missing: ${options.template}/${options.language}`);
  }

  const projectName = toPackageName(path.basename(destination));
  renderTemplateDirectory(source, destination, {
    PROJECT_NAME: projectName,
  });
  if (credentials) {
    writeProjectEnv(destination, credentials);
    console.log('Saved Lexmount credentials to the generated .env (API key hidden).');
  }

  const packageManager = detectPackageManager();
  if (options.install) {
    installDependencies(destination);
  }
  console.log(`\nCreated Lexmount app in ${destination}`);
  if (options.install && credentials) {
    runGeneratedExample(
      destination,
      packageManager,
      selection.languageDefinition.run
    );
  } else {
    printManualRunInstructions(
      destination,
      packageManager,
      options.install,
      Boolean(credentials),
      selection.languageDefinition.run
    );
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-lexmount-app: ${message}`);
  process.exitCode = 1;
}
