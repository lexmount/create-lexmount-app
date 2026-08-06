# create-lexmount-app

Scaffold runnable Lexmount Browser and WebFetch examples from the Templates
catalog.

## Quick start

```bash
npx create-lexmount-app --template screenshot --language typescript
```

The command creates `lexmount-screenshot/`, configures local Lexmount
credentials, installs dependencies, and immediately runs the generated
screenshot example against `https://example.com`. Credential setup uses this
order:

1. current `LEXMOUNT_API_KEY` + `LEXMOUNT_PROJECT_ID` environment variables;
2. `.env.local` or `.env` in the current directory;
3. the local browser-cli or webfetch-cli credentials file;
4. a browser-based loopback + PKCE authorization flow using the permissions
   required by the selected template.

The generated `.env` is ignored by Git, written with mode `0600` on POSIX, and
the API key is never printed. To choose another destination directory, pass it
as the first positional argument:

```bash
npx create-lexmount-app my-screenshot \
  --template screenshot \
  --language typescript
```

To run it again with another URL:

```bash
cd lexmount-screenshot
npm run screenshot -- --url https://example.com
```

Leave `LEXMOUNT_REGION` unset to let the SDK and API automatically select an
available region. Set it in `.env` only when targeting a specific region ID
from the API catalog. `--no-install` and `--no-auth` skip automatic execution
and print the manual command instead.

The generated app uses the official Lexmount SDK to create a temporary browser
session, prints its inspect URL before connecting or navigating, navigates with
Playwright, writes `artifacts/screenshot.png`, and prints the title, final URL,
and screenshot path as structured JSON.

For structured content without browser interaction, generate the WebFetch
template instead:

```bash
npx create-lexmount-app --template webpage-to-json --language typescript
```

This creates `lexmount-webpage-to-json/`, sends one WebFetch request for
`https://example.com`, and prints structured JSON containing the title, main
text, links, images, and related metadata. It does not create a Browser Session
or install Playwright.

For a page that must be searched interactively, generate the browser search
template:

```bash
npx create-lexmount-app --template search-results-to-json --language typescript
```

This creates `lexmount-search-results-to-json/`, opens Baidu in a temporary
Lexmount Browser Session, fills and submits a search through Playwright, waits
for the results page, and saves the first three title/link/summary records to
`artifacts/search-results.json`. Edit `config/baidu.json` to target another
site or replace its role, label, text, CSS, and wait rules.

For a repeatable browser check with a replayable Recording, generate the web
check template:

```bash
npx create-lexmount-app --template web-check --language typescript
```

This creates `lexmount-web-check/`, runs the JSON checklist in
`inputs/checks.json`, saves a machine-readable report to `artifacts/`, and
closes the Session after preserving its persistent Recording for Replay.

To prove that login state can survive across separate browser Sessions,
generate the persistent Context template:

```bash
npx create-lexmount-app --template persistent-login-state --language typescript
```

This creates `lexmount-persistent-login-state/`, writes safe demo Cookie and
Local Storage markers in one Session, verifies them in a second Session, and
keeps the Context available for later tasks. Run `npm run cleanup` when you no
longer need that demo Context.

During browser authorization, the CLI prints progress when the loopback
callback arrives and when credential exchange finishes. The callback response
closes its localhost connection explicitly, so a browser keep-alive connection
cannot delay dependency installation.

## Supported templates

| Template | Language | Description |
| --- | --- | --- |
| `screenshot` | `typescript` | Navigate to a URL and capture a full-page screenshot. |
| `webpage-to-json` | `typescript` | Extract structured JSON from a public webpage with WebFetch. |
| `search-results-to-json` | `typescript` | Search a page and save the first N results as structured JSON. |
| `web-check` | `typescript` | Run a JSON web checklist and keep a persistent Recording for replay. |
| `persistent-login-state` | `typescript` | Reuse Cookie and Local Storage state across separate browser Sessions. |

## CLI options

```text
create-lexmount-app [directory] --template <name> --language <language>

--no-install   Generate files without installing dependencies or running the example
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
