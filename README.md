# create-lexmount-app

Scaffold runnable Lexmount browser automation examples from the Templates
catalog.

## Quick start

```bash
npx create-lexmount-app --template screenshot --language typescript
```

The command creates `lexmount-screenshot/`, configures local Lexmount
credentials, installs dependencies, and prints the next steps. Credential
setup uses this order:

1. current `LEXMOUNT_API_KEY` + `LEXMOUNT_PROJECT_ID` environment variables;
2. `.env.local` or `.env` in the current directory;
3. the local browser-cli credentials file;
4. a browser-based loopback + PKCE authorization flow.

The generated `.env` is ignored by Git, written with mode `0600` on POSIX, and
the API key is never printed. To choose another destination directory, pass it
as the first positional argument:

```bash
npx create-lexmount-app my-screenshot \
  --template screenshot \
  --language typescript
```

After creation:

```bash
cd lexmount-screenshot
# LEXMOUNT_REGION defaults to nanjing-1 and can be changed in .env.
npm run screenshot -- --url https://example.com
```

The generated app uses the official Lexmount SDK to create a temporary browser
session, navigates with Playwright, writes `artifacts/screenshot.png`, and
prints the title, final URL, and screenshot path as structured JSON.

## Supported templates

| Template | Language | Description |
| --- | --- | --- |
| `screenshot` | `typescript` | Navigate to a URL and capture a full-page screenshot. |

## CLI options

```text
create-lexmount-app [directory] --template <name> --language <language>

--no-install   Generate files without installing dependencies
--no-auth      Skip credential discovery and browser authorization
--connect-base-url <url>
               Override the Lexmount console used for authorization
--help, -h     Show help
--version, -v  Show the package version
```

The destination defaults to `lexmount-<template>`. The CLI refuses to write
into a non-empty directory and never overwrites an existing project.

The API environment can be selected before running `npx`:

```bash
export LEXMOUNT_BASE_URL=https://apitest.local.lexmount.net # office
export LEXMOUNT_BASE_URL=https://api.lexmount.com           # qcloud-hk
```

The authorization console is inferred from the API URL. Use
`--connect-base-url` only for a custom environment. For offline generation or
CI packaging, pass `--no-auth`, then copy `.env.example` to `.env` yourself.

## Development

```bash
npm test
npm run test:release
npm pack --dry-run
```

## Publishing

Publishing follows the Lexmount Node.js SDK release workflow. A published
GitHub Release triggers `.github/workflows/publish.yml`, which checks that the
version is new, installs from the lockfile, runs the test/package validation,
and publishes to npm.

Because `create-lexmount-app` is a new package, the first version must be
published once by an authorized npm account. After that bootstrap publish,
configure npm trusted publishing for GitHub repository
`lexmount/create-lexmount-app`, workflow `publish.yml`, and the `npm publish`
action. Future releases use GitHub OIDC (`id-token: write`) and do not store a
long-lived npm token.

One-time bootstrap after this repository is merged:

```bash
npm login
npm publish --access public
npm trust github create-lexmount-app \
  --repo lexmount/create-lexmount-app \
  --file publish.yml \
  --allow-publish
```

The authenticated maintainer must complete npm's required 2FA. The first
automated release must use the next unpublished version because the bootstrap
command publishes the current one.

Before creating an automated release, bump `package.json` and
`package-lock.json` to the same unpublished stable version. The workflow
rejects prereleases and requires the GitHub Release tag to be exactly
`v<version>` or `<version>`. Trusted publishing generates npm provenance
automatically.
