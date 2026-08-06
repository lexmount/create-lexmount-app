# {{PROJECT_NAME}}

This standalone TypeScript project distributes a URL batch across independent
Lexmount cloud Browser Sessions, limits concurrency, and writes one report with
successful page observations, failed tasks, and Session lifecycle counts.

Each URL gets its own Session so cookies, pages, crashes, and cleanup remain
isolated. The scheduler uses `Promise.allSettled`, so one failed page does not
stop the rest of the batch.

## Setup

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, run:

```powershell
npm install
Copy-Item .env.example .env
```

Configure `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` in `.env`. Leave
`LEXMOUNT_REGION` unset unless you need a specific catalog region.

## Run the default official-site batch

```powershell
npm run browse
```

`inputs/urls.json` contains three public Lexmount pages. The default
`CONCURRENCY` is 3, so the example creates up to three Sessions at once without
sending batch traffic to third-party sites.

Progress is printed to stderr as each Session is created, completes, and
closes. The final JSON is printed to stdout and saved to
`artifacts/parallel-browser-results.json`. Every successful result includes:

- the requested and final URL;
- HTTP response status, title, first H1, and elapsed time;
- Session ID and Remote View URL;
- Session creation, task completion, and closure status.

Failures contain the same lifecycle record plus a redacted error message. A
partial failure still produces the full report, then sets a non-zero exit code.

## Customize the batch

Edit `inputs/urls.json` or pass another file:

```powershell
npm run browse -- --input inputs/my-urls.json --concurrency 5
```

The input format is:

```json
{
  "urls": ["https://example.com/", "https://example.org/"]
}
```

Command-line options take precedence over the matching environment variables:

```text
--input         INPUT_PATH
--output        OUTPUT_PATH
--concurrency   CONCURRENCY (default 3, range 1-20)
--timeout-ms    NAVIGATION_TIMEOUT_MS (default 60000)
```

## Validate

```powershell
npm run check
```

The tests cover input safety, numeric bounds, concurrency enforcement,
`Promise.allSettled` failure isolation, lifecycle aggregation, and credential
redaction. `npm run browse` is the live end-to-end test and always attempts to
release every Session in its cleanup path.
