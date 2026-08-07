# {{PROJECT_NAME}}

Generated from the Lexmount `search-results-to-json` TypeScript template.

Use WebFetch when you only need public page content. Use this browser workflow
when the task must type, click, wait for navigation or dynamic elements, and
then extract results.

## Credentials

`create-lexmount-app` configures an ignored `.env` from local environment files,
browser-cli credentials, or Lexmount's browser authorization flow. If you used
`--no-auth`, copy `.env.example` to `.env` and provide
`LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` yourself.

Leave `LEXMOUNT_REGION` unset unless you need a specific catalog region.

## Run the default Baidu example

```bash
npm run search -- --query "Playwright 浏览器自动化" --limit 3
```

The command writes `artifacts/search-results.json` and prints the same JSON. It
contains the Session ID, final URL, requested limit, result count, elapsed time,
and each result's title, link, and summary.

## Use another search page

Copy `config/baidu.json`, then replace the target URL and locator rules:

- `role`: accessible role with an optional name;
- `label`: visible form label;
- `text`: visible text;
- `css`: stable CSS selector fallback;
- waits: URL match, visible locator, or network idle.

Run the replacement configuration with:

```bash
npm run search -- --config config/my-site.json --query "your query" --limit 10
```

The runtime follows the full browser lifecycle: create Session, connect
Playwright over CDP, fill and click, wait for deterministic page state, extract
results, save JSON, close Playwright, and release the Session.

## Validate

```bash
npm run typecheck
npm test
```
