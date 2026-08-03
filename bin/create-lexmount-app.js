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

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
);

const supportedTemplates = new Map([
  ['web-check', new Set(['typescript'])],
]);

const helpText = `create-lexmount-app

Usage:
  create-lexmount-app [directory] --template <name> --language <language>

Options:
  --template <name>       Template to generate (supported: web-check)
  --language <language>   Template language (supported: typescript)
  --no-install            Generate files without installing dependencies
  --help, -h              Show this help
  --version, -v           Show the package version

Examples:
  npx create-lexmount-app --template web-check --language typescript
  npx create-lexmount-app my-check --template web-check --language typescript
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

function printNextSteps(destination, packageManager, installed) {
  const relativeDestination = path.relative(process.cwd(), destination) || '.';
  const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;

  console.log(`\nCreated Lexmount app in ${destination}`);
  console.log('\nNext steps:');
  if (relativeDestination !== '.') {
    console.log(`  cd ${relativeDestination}`);
  }
  console.log('  cp .env.example .env');
  console.log('  # Add LEXMOUNT_API_KEY and LEXMOUNT_PROJECT_ID to .env');
  if (!installed) {
    console.log(`  ${packageManager} install`);
  }
  console.log(
    `  ${runPrefix} check -- --url https://example.com --expected "Example Domain"`
  );
}

function main(argv) {
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

  const packageManager = detectPackageManager();
  if (options.install) {
    installDependencies(destination);
  }
  printNextSteps(destination, packageManager, options.install);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`create-lexmount-app: ${message}`);
  process.exitCode = 1;
}
