# {{PROJECT_NAME}}

This standalone TypeScript project demonstrates a real human handoff in a
Lexmount cloud browser. Automation opens Gitee's public login page, prints the
Session's Remote View URL, and waits while the same Session, Browser Context,
and Page stay alive. A person completes login in Remote View; automation then
detects the authenticated dashboard URL and resumes.

Use a dedicated demo account with no private repositories, notifications, or
personal profile data. Credentials are entered only in Remote View. The script
does not accept, store, log, or inspect usernames, passwords, cookies, or
tokens.

## Setup

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, run:

```bash
npm install
cp .env.example .env
```

Configure `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` in `.env`. Leave
`LEXMOUNT_REGION` unset unless you need a specific catalog region.

## Run the Gitee handoff

```bash
npm run handoff
```

The script will:

1. create one Lexmount Browser Session and connect Playwright over CDP;
2. open Gitee with a safe return path to `/dashboard/projects`;
3. pause and print `Remote View: <inspectUrl>` with a clear instruction;
4. let the person complete password, CAPTCHA, or second-factor steps directly;
5. wait for the login form to disappear, then recheck the authenticated URL
   after a short stability window before continuing automation;
6. print structured JSON with the pause, human action, resume, and completion
   timestamps and the final origin/path only;
7. close Playwright and release the temporary Session.

Open the printed Remote View URL and complete Gitee login. The process waits
for up to 10 minutes by default. You can adjust the timeout and polling
interval:

```bash
npm run handoff -- --timeout-seconds 900 --poll-interval-ms 750
```

Environment variables `HANDOFF_TIMEOUT_SECONDS` and `POLL_INTERVAL_MS` provide
the same settings. `TARGET_URL` and `SUCCESS_URL` can adapt the handoff to
another site; both must be HTTPS URLs on the same origin. Command-line options
take precedence:

```bash
npm run handoff -- --url "https://gitee.com/login?redirect_to_url=%2Fdashboard%2Fprojects" --success-url https://gitee.com/dashboard/projects
```

If the timeout expires or another step fails, the `finally` cleanup still
closes the Browser connection and Session. The script never creates a second
Session during handoff, so Remote View and automation always operate on the
same browser state. The Remote View URL is printed only while human action is
needed; it is not included in the final JSON result.

## Adapt the checkpoint

Keep the lifecycle around `waitForHumanCompletion`, then replace these two parts:

- the condition that decides a human is needed;
- the same-origin success URL that proves the human action is complete.

Use a semantic or stable selector that represents the completed business state,
not a fixed sleep. Never put passwords, API keys, or access tokens in logs or
output, and never persist full direct browser connection URLs in result data.

## Validate

```bash
npm run check
```

The unit tests cover HTTPS and same-origin enforcement, success-path matching,
the login-form-absent completion contract, configuration bounds, timeline
order, and duration calculation. Running
`npm run handoff` and completing login in Remote View is the live end-to-end
test. This interactive example is intentionally not run automatically during
project scaffolding.
