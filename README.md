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
