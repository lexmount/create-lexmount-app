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

const supportedTemplates = new Map([
  ['screenshot', new Set(['typescript'])],
]);
const DEFAULT_SCREENSHOT_URL = 'https://example.com';

const helpText = `create-lexmount-app

Usage:
  create-lexmount-app [directory] --template <name> --language <language>

Options:
  --template <name>       Template to generate (supported: screenshot)
  --language <language>   Template language (supported: typescript)
  --no-install            Generate files without installing dependencies or running the example
  --no-auth               Skip local credential discovery and browser authorization
  --connect-base-url      Override the Lexmount console used for authorization
  --help, -h              Show this help
  --version, -v           Show the package version

Examples:
  npx create-lexmount-app --template screenshot --language typescript
  npx create-lexmount-app my-screenshot --template screenshot --language typescript
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

  const languages = supportedTemplates.get(template);
  if (!languages) {
    throw new Error(
      `Unsupported template: ${template}. Supported templates: ${[
        ...supportedTemplates.keys(),
      ].join(', ')}`
    );
  }
  if (!languages.has(language)) {
    throw new Error(
      `Unsupported language for ${template}: ${language}. Supported languages: ${[
        ...languages,
      ].join(', ')}`
    );
  }
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

function installDependencies(destination) {
  const packageManager = detectPackageManager();
  const command = packageManager;
  const args = packageManager === 'yarn' ? [] : ['install'];

  console.log(`\nInstalling dependencies with ${packageManager}...`);
  const result = spawnSync(command, args, {
    cwd: destination,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw new Error(`Failed to start ${packageManager}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${packageManager} install failed with exit code ${result.status}`);
  }
  return packageManager;
}

function runScreenshotExample(destination, packageManager) {
  console.log(`\nRunning screenshot example for ${DEFAULT_SCREENSHOT_URL}...`);
  const result = spawnSync(
    packageManager,
    ['run', 'screenshot', '--', '--url', DEFAULT_SCREENSHOT_URL],
    {
      cwd: destination,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }
  );
  if (result.error) {
    throw new Error(
      `Failed to start the screenshot example with ${packageManager}: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Screenshot example failed with exit code ${result.status}`
    );
  }
}

function printManualRunInstructions(
  destination,
  packageManager,
  installed,
  credentialsConfigured
) {
  const relativeDestination = path.relative(process.cwd(), destination) || '.';
  const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;

  console.log('\nThe screenshot example was not run automatically:');
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
  console.log(`  ${runPrefix} screenshot -- --url ${DEFAULT_SCREENSHOT_URL}`);
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

  validateSelection(options.template, options.language);

  const directory = options.directory ?? `lexmount-${options.template}`;
  const destination = path.resolve(process.cwd(), directory);
  assertWritableDestination(destination);

  let credentials;
  if (options.auth) {
    const discovered = discoverCredentials();
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
    runScreenshotExample(destination, packageManager);
  } else {
    printManualRunInstructions(
      destination,
      packageManager,
      options.install,
      Boolean(credentials)
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
