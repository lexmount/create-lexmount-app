# {{PROJECT_NAME}}

Generated from the Lexmount `web-check` TypeScript template.

## Configure

```bash
cp .env.example .env
```

Set the required credentials in `.env`:

```bash
LEXMOUNT_API_KEY=your_api_key_here
LEXMOUNT_PROJECT_ID=your_project_id_here
```

`LEXMOUNT_BASE_URL` defaults to `https://api.lexmount.cn` and
`LEXMOUNT_HOME_URL` defaults to `https://browser.lexmount.cn`.

## Run a check

```bash
npm run check -- --url https://example.com --expected "Example Domain"
```

You may instead set `TARGET_URL` and `EXPECTED_TEXT` in `.env` and run
`npm run check` without flags.

The command:

1. creates a Lexmount browser session with persistent recording enabled;
2. opens the target URL and looks for the expected text in the page body;
3. writes a full-page screenshot to `artifacts/screenshot.png`;
4. closes the temporary browser and session in a `finally` block;
5. prints JSON containing `matched`, `title`, `final_url`, `screenshot`, and
   `replay`.

The `replay` value links to the Lexmount session detail page. Recording
processing can take a short time after the session closes. A missing expected
text returns structured evidence and sets exit code `2`; runtime failures use
exit code `1`.

## Validate the generated project

```bash
npm run typecheck
```
