# {{PROJECT_NAME}}

Download a file in a Lexmount remote browser, retrieve it through the Session
Downloads API, and save auditable artifacts on the local machine.

Remote browser downloads do not automatically appear on your computer. This
project demonstrates the complete transfer path:

1. create a Session with `downloads.enabled=true`;
2. configure Chrome through CDP to write into `/config/Downloads`;
3. click a page element and wait for the remote download to finish;
4. query `client.sessions.downloads.list()`;
5. retrieve each file with `client.sessions.downloads.get()`;
6. retrieve all downloads as a ZIP with `client.sessions.downloads.archive()`;
7. verify size and SHA-256 metadata and write a JSON manifest.

## Credentials

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, copy `.env.example` to `.env`
and set `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID`.

`LEXMOUNT_BASE_URL` and `LEXMOUNT_REGION` are optional.

Never commit `.env`; it is ignored by Git.

## Run the controlled demo

```bash
npm install
npm run download
```

The default page and CSV link are generated inside the remote Session. The demo
does not depend on an external file server, so it is suitable for a repeatable
Downloads API smoke test.

Use `npm run download -- --demo` to force the controlled demo when `.env`
already contains a `TARGET_URL` for a real task.

Each run creates a timestamped directory under `artifacts/downloads` containing:

```text
files/lexmount-downloads-demo.csv
downloads.zip
download-manifest.json
```

The manifest records the original and local filenames, byte size, content type,
SHA-256 digest, remote download time, local save time, source page, and archive
metadata.

## Download from a real webpage

Set the page URL and a Playwright locator that matches the download control:

```dotenv
TARGET_URL=https://example.com/reports
DOWNLOAD_LOCATOR=a[download]
```

Then run `npm run download`. The first visible matching element is clicked.
Authenticated sites can be added later by mounting a persistent Lexmount
Context before navigation; this project intentionally keeps the default demo
credential-free and deterministic.

Command-line flags override environment values:

```bash
npm run download -- \
  --url https://example.com/reports \
  --locator "a[download]" \
  --output artifacts/downloads \
  --timeout-ms 90000 \
  --poll-interval-ms 1000
```

On Windows PowerShell, place the command on one line or use PowerShell's own
line-continuation syntax.

## Validate the project

```bash
npm run check
```

The Session and CDP connection are closed in `finally`, including failure paths.
Downloaded local artifacts remain available under the configured output
directory.
