# {{PROJECT_NAME}}

This standalone TypeScript project demonstrates a reliable human handoff in a
Lexmount cloud browser. Automation pauses at a controlled approval checkpoint,
prints the Session's Remote View URL, waits while the same Session, Browser
Context, and Page stay alive, and resumes as soon as a person clicks the
approval button.

The demo uses `page.setContent()` and does not require a third-party account.
Replace the demo checkpoint with login confirmation, OAuth consent, QR-code
scanning, business approval, CAPTCHA handling, or an unexpected-dialog rule in
a real workflow.

## Setup

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, run:

```powershell
npm install
Copy-Item .env.example .env
```

Configure `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` in `.env`. Leave
`LEXMOUNT_REGION` unset unless you need a specific catalog region.

## Run the handoff demo

```powershell
npm run handoff
```

The script will:

1. create one Lexmount Browser Session and connect Playwright over CDP;
2. render a deterministic page with `page.setContent()`;
3. pause and print `Remote View: <inspectUrl>` with a clear instruction;
4. poll the same Page for `body[data-handoff-state="approved"]`;
5. detect the Remote View click and continue the remaining automation;
6. print structured JSON with the pause, human action, resume, and completion
   timestamps;
7. close Playwright and release the temporary Session.

Open the printed Remote View URL and click **批准并继续**. The process waits for
up to 10 minutes by default. You can adjust the timeout and polling interval:

```powershell
npm run handoff -- --timeout-seconds 900 --poll-interval-ms 750
```

Environment variables `HANDOFF_TIMEOUT_SECONDS` and `POLL_INTERVAL_MS` provide
the same settings. Command-line options take precedence.

If the timeout expires or another step fails, the `finally` cleanup still
closes the Browser connection and Session. The script never creates a second
Session during handoff, so Remote View and automation always operate on the
same browser state.

## Adapt the checkpoint

Keep the lifecycle around `waitForHumanApproval`, then replace these two parts:

- the condition that decides a human is needed;
- the selector or page state that proves the human action is complete.

Use a semantic or stable selector that represents the completed business state,
not a fixed sleep. Never put passwords, API keys, access tokens, or full direct
browser connection URLs in logs or output.

## Validate

```powershell
npm run check
```

The unit tests cover configuration bounds, approval timestamps, timeline order,
duration calculation, and the demo page's approval-marker contract. Running
`npm run handoff` and clicking through Remote View is the live end-to-end test.
