# {{PROJECT_NAME}}

Run a deterministic JSON checklist in a Lexmount browser Session and keep a
persistent Recording for replay after the run. The command always attempts to
write a machine-readable report before it closes a created Session, including
when an assertion fails.

## Configure

`create-lexmount-app` has already created `.env` from your local Lexmount
credentials. To configure the project manually, copy `.env.example` to `.env`
and provide your Lexmount credentials:

```powershell
Copy-Item .env.example .env
```

```dotenv
LEXMOUNT_API_KEY=your_api_key_here
LEXMOUNT_PROJECT_ID=your_project_id_here
# LEXMOUNT_REGION=your_catalog_region_id
```

`LEXMOUNT_BASE_URL` defaults to `https://api.lexmount.cn`. The Replay link uses
`LEXMOUNT_HOME_URL`, which defaults to `https://browser.lexmount.cn`.
Leave `LEXMOUNT_REGION` unset to let the SDK and API automatically select an
available region. Set it only to a region ID from the current API catalog after
confirming that region stores persistent Recording and Replay data.

## Define checks

Edit `inputs/checks.json`:

```json
{
  "name": "lexmount-docs-navigation-check",
  "url": "https://lexmount.cn/",
  "timeout_ms": 60000,
  "checks": [
    { "action": "goto" },
    {
      "action": "expectTitle",
      "value": "Lexmount",
      "match": "contains"
    },
    {
      "action": "expectText",
      "selector": "h1",
      "value": "企业级浏览能力",
      "match": "contains"
    },
    { "action": "click", "selector": "a[href=\"https://browser.lexmount.cn/docs\"]" },
    {
      "action": "expectUrl",
      "value": "https://browser.lexmount.cn/docs",
      "match": "contains"
    },
    {
      "action": "expectTitle",
      "value": "文档总览",
      "match": "contains"
    },
    {
      "action": "expectText",
      "selector": "h1",
      "value": "文档总览",
      "match": "equals"
    }
  ]
}
```

The shipped checklist is a real production smoke test: it opens Lexmount's
public homepage, verifies the hero, follows the **开发文档** link, and confirms
the public documentation landing page. The persistent Recording makes the
entire navigation available for Replay.

The schema intentionally supports only these actions:

| Action | Required fields | Behavior |
| --- | --- | --- |
| `goto` | none; optional `url` | Opens the step URL or the top-level URL. |
| `click` | `selector` | Clicks one Playwright locator. |
| `fill` | `selector`, `value` | Fills one locator; the value is redacted from reports. |
| `expectTitle` | `value`; optional `match` | Checks the page title. |
| `expectText` | `value`; optional `selector`, `match` | Checks locator text; selector defaults to `body`. |
| `expectUrl` | `value`; optional `match` | Checks the current URL. |

`match` is either `contains` (the default) or `equals`. Unknown fields and
unsupported actions are rejected instead of being executed.

## Run

```powershell
npm run check:web
```

Optional paths and timeout overrides:

```powershell
npm run check:web -- --input inputs/checks.json --output artifacts/report.json --timeout-ms 45000
```

The command creates a Session with `recording.persistent=true`, runs checks in
order, and records each step's start, end, duration, result, error, and safe
details. After the first failed action or assertion, dependent steps are marked
`skipped`. The report is written in a `pre_close` phase, the Session is closed,
and the same report is updated with final closure state. The runner uses the
newest page in the remote browser context, matching the Recording runtime's
tracked tab.

Exit codes are `0` for a passing checklist, `2` for a failed check, and `1` for
configuration, runtime, report-write, or Session-close errors.

After Session closure, the command prints the Session ID and console URL. Open
that Session in the Lexmount console to view its Replay. Recording processing
may take a short time after closure.

## Validate

```powershell
npm run check
```

For an intentional real assertion failure:

```powershell
npm run check:web -- --input test/fixtures/failing-checks.json --output artifacts/failing-web-check-report.json
```
