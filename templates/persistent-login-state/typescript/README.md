# {{PROJECT_NAME}}

This TypeScript project proves that one persistent Lexmount Context can carry
browser state across separate Sessions. The first Session writes a safe demo
Cookie and Local Storage marker, closes, and releases the Context. A second
Session mounts the same Context and verifies both markers without changing them.

The demo markers stand in for a real login so the project is deterministic and
does not need an account or store credentials. In a real workflow, replace the
body of `establishDemoState` with the site's login steps and verify a logged-in
page or account element instead of saving authentication tokens locally.

## Setup

`create-lexmount-app` installs the dependencies and creates `.env` from your
local Lexmount credentials. For manual setup, run:

```bash
npm install
Copy-Item .env.example .env
```

Configure `LEXMOUNT_API_KEY` and `LEXMOUNT_PROJECT_ID` in `.env`. Leave
`LEXMOUNT_REGION` unset unless you need a specific region from the API catalog.

## Run the complete proof

```bash
npm run demo -- --url https://example.com
```

This command creates one persistent Context and two different Sessions:

1. a `readWrite` Session establishes Cookie and Local Storage state;
2. the Session closes and the project waits for the Context to become available;
3. a new `readWrite` Session mounts that Context and performs read-only checks;
4. both state markers are read and asserted;
5. the Context remains available for later tasks.

The second Session also uses `readWrite` because the current public API returns
`Read only context is not implemented` for `readOnly`. Sessions are strictly
sequential, and the verification phase does not mutate the saved state.

The demo Cookie has an explicit 24-hour expiry. A browser Session Cookie has no
expiry and normally disappears when that browser process ends, so it is not a
valid proof of cross-Session Cookie persistence.

The Context ID and origin are saved to the ignored
`.lexmount/persistent-login-state.json` file. Cookie values and Local Storage
values from a real account should never be copied into that file or Context
metadata.

## Run the two tasks separately

```bash
npm run setup -- --url https://example.com
npm run verify
```

Running these as separate commands demonstrates that reuse does not depend on
one Node.js process. `verify` reads the Context ID from the local state file and
starts a genuinely new Session.

The browser state is origin-scoped. If the setup URL redirects, the final URL
and its origin are recorded and reused automatically.

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

The unit tests cover URL safety, state-file validation, ownership checks, and
the two browser-state assertions. `npm run demo` is the live end-to-end test.
