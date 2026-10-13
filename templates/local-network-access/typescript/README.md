# Cloud browser access to your intranet

Run on a computer that can already reach the company intranet or VPN site:

```bash
npx create-lexmount-app --template local-network-access --language typescript --cloud cn
```

Use `--cloud global` for Lexmount Global Cloud. The launcher reuses matching
local credentials or opens the official authorization page, installs dependencies,
and starts the template. You do not need to copy an API key manually. Node.js
20 or later is required; no local Chromium installation is needed.

Enter an HTTP(S) intranet/VPN URL when prompted. The script opens an SDK local
tunnel, creates a normal Chromium session on the same client/region, and opens
the URL. The SDK handles DNS, TCP connections, forwarding and reconnection.
Your project needs `custom_proxy` capability and a region with local proxy enabled.
To select a specific enabled region, set `LEXMOUNT_REGION` in the generated `.env`.

## Use and stop the session

Keep this terminal and any required VPN running. Open your cloud console's
session list to view and operate the browser, then stop the session there when
finished. The script checks the session every five seconds. After a confirmed
`closed` status or a session-not-found response, it revokes its tunnel and exits.
Temporary status-check failures keep the tunnel running and retry with backoff.

The script does not print an Inspect URL, session identifiers, page data or a
result report, and does not save screenshots. It only prints connection/status
messages. Website login, if needed, happens in the cloud browser; local cookies
are not imported. If initial navigation fails, the session and tunnel remain
available for you to inspect and navigate from the console.

`Ctrl+C`, `SIGTERM`, `SIGHUP`, or closing the terminal stops the local connector.
**It does not stop the cloud session or its billing.** Stop the session in the
cloud console yourself. Graceful interruption disconnects the local automation
client and revokes the tunnel; a forced process kill cannot guarantee remote
tunnel cleanup. In-flight SDK requests may take time to finish during shutdown.
The script never deletes a cloud session, including after an initialization error.
If initialization fails after a session was allocated, check the console and stop
that session there.

The tunnel may reconnect after a network interruption, but existing connections
can fail and requests are not replayed. Retry page navigation in the console
after reconnection. The tunnel expires after seven days; normal session lifetime
and project limits also apply.

## Run again

```bash
cd lexmount-local-network-access
npm start
```

To supply the URL without a prompt:

```bash
npm start -- --url 'https://your-internal-site.example/'
```

Alternatively set `TARGET_URL` in `.env`. The explicit `--url` takes precedence.
There is no default public website. Localhost, loopback and unspecified addresses
are rejected; this template does not change the platform's network restrictions.
The URL check is an input guard, not a replacement for platform network isolation.

## Checks

```bash
npm run check
```

Tests cover URL input, session persistence, console stop detection, status errors,
reconnection, cancellation and cleanup without deleting the cloud session.
