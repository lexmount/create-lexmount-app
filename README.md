# create-lexmount-app

Scaffold runnable Lexmount browser automation examples from the Templates
catalog.

## Quick start

```bash
npx create-lexmount-app --template web-check --language typescript
```

The command creates `lexmount-web-check/`, installs its dependencies, and
prints the next steps. To choose another destination directory, pass it as the
first positional argument:

```bash
npx create-lexmount-app my-web-check \
  --template web-check \
  --language typescript
```

After creation:

```bash
cd lexmount-web-check
cp .env.example .env
# Fill in LEXMOUNT_API_KEY and LEXMOUNT_PROJECT_ID.
# LEXMOUNT_REGION defaults to nanjing-1 and can be changed in .env.
npm run check -- --url https://example.com --expected "Example Domain"
```

The generated app starts a persistent-recording Lexmount session, checks the
page text, writes `artifacts/screenshot.png`, prints structured JSON, and links
to the session detail page where Replay becomes available after processing.

## Supported templates

| Template | Language | Description |
| --- | --- | --- |
| `web-check` | `typescript` | Check a URL for expected text and preserve screenshot/Replay evidence. |

## CLI options

```text
create-lexmount-app [directory] --template <name> --language <language>

--no-install   Generate files without installing dependencies
--help, -h     Show help
--version, -v  Show the package version
```

The destination defaults to `lexmount-<template>`. The CLI refuses to write
into a non-empty directory and never overwrites an existing project.

## Development

```bash
npm test
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
