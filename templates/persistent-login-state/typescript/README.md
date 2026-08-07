# {{PROJECT_NAME}}

This TypeScript project proves that one persistent Lexmount Context can carry a
real website's login state across separate Sessions. The first Session signs in
to the public TDesign Starter demo, closes, and releases the Context. A second
Session mounts that same Context and verifies that the dashboard opens without
returning to the login page.

TDesign Starter is a hosted public demo rather than a production account
system. Its login fields are currently prefilled with the site's documented
demo values. The example submits those existing values without hardcoding,
accepting, or printing account credentials. The project demonstrates real site
storage and routing while keeping personal credentials out of the workflow.

## Setup

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, run:

```bash
npm install
cp .env.example .env
```

Configure `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` in `.env`. Leave
`LEXMOUNT_REGION` unset unless you need a specific region from the API catalog.

## Run the complete proof

```bash
npm run demo -- --url https://tdesign.tencent.com/starter/vue-next/login
```

This command creates one persistent Context and two different Sessions:

1. a `readWrite` Session submits the public TDesign demo login;
2. the Session closes and the project waits for the Context to become available;
3. a new `readWrite` Session mounts that Context and opens the saved dashboard;
4. the dashboard URL and visible `.dashboard-item` content are asserted;
5. the Context remains available for later tasks.

The second Session also uses `readWrite` because the current public API returns
`Read only context is not implemented` for `readOnly`. Sessions are strictly
sequential, and the verification phase does not mutate the saved state.

The Context ID and origin are saved to the ignored
`.lexmount/persistent-login-state.json` file. Login values, cookies, and Local
Storage are never copied into that file or Context metadata.

If the public demo stops prefilling its fields, the script fails safely instead
of asking for credentials. Update the target's public demo contract before
continuing. Never put real account credentials in environment files,
command-line arguments, Context metadata, logs, screenshots, or committed
files.

## Run the two tasks separately

```bash
npm run setup -- --url https://tdesign.tencent.com/starter/vue-next/login
npm run verify
```

Running these as separate commands demonstrates that reuse does not depend on
one Node.js process. `verify` reads the Context ID from the local state file and
starts a genuinely new Session.

The browser state is origin-scoped. The setup step records the final TDesign
dashboard URL and the verification step requires the same origin and dashboard
path. `LOGIN_TIMEOUT_SECONDS` defaults to 60 and accepts values from 10 to 300.

## Clean up the demo Context

```bash
npm run cleanup
```

Cleanup refuses to delete a locked Context or one whose ownership metadata does
not match this project. It removes only the exact Context recorded in the local
state file.

## Validate the project

```bash
npm run check
```

The unit tests cover URL safety, locale-independent control selectors, timeout
bounds, dashboard matching, state-file validation, and ownership checks.
`npm run demo` is the live end-to-end test.
