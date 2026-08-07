# {{PROJECT_NAME}}

Generated from the Lexmount `screenshot` TypeScript template.

## Credentials

`create-lexmount-app` first looks for `LEXMOUNT_API_KEY` and
`LEXMOUNT_PROJECT_ID` in the current environment, `.env.local`, `.env`, or the
local browser-cli credentials file. When no complete credential pair exists,
it opens Lexmount's browser authorization flow and writes the returned values
to this project's ignored `.env` file.

If you generated with `--no-auth`, create `.env` manually:

```bash
LEXMOUNT_API_KEY=your_api_key_here
LEXMOUNT_PROJECT_ID=your_project_id_here
# Optional: LEXMOUNT_REGION=your_catalog_region_id
```

`LEXMOUNT_BASE_URL` defaults to `https://api.lexmount.cn`.
Leave `LEXMOUNT_REGION` unset to let the SDK and API select an available
region automatically. Set it only when you need a specific region ID from the
API catalog.

## Capture a screenshot

```bash
npm run screenshot -- --url https://semi.design/zh-CN/basic/button
```

The default real-world example captures Semi Design's public Button component
documentation so the resulting full-page PNG contains a useful, visually rich
developer page instead of a placeholder document.

You may instead set `TARGET_URL` in `.env` and run `npm run screenshot` without
flags.

The command:

1. uses the official `lexmount` SDK to create a temporary browser session;
2. immediately prints the session's inspect URL;
3. connects Playwright to that session and opens the target URL;
4. writes a full-page screenshot to `artifacts/screenshot.png`;
5. closes the browser and Lexmount session in a `finally` block;
6. prints JSON containing `title`, `final_url`, and `screenshot`.

## Validate the generated project

```bash
npm run typecheck
```
