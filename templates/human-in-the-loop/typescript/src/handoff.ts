export const DEFAULT_HANDOFF_TIMEOUT_SECONDS = 600;
export const DEFAULT_POLL_INTERVAL_MS = 500;
export const APPROVAL_SELECTOR = 'body[data-handoff-state="approved"]';

export type HandoffSettings = {
  timeout_seconds: number;
  poll_interval_ms: number;
};

export type HandoffTimeline = {
  session_created_at: string;
  paused_at: string;
  human_completed_at: string;
  resumed_at: string;
  completed_at: string;
};

function parseIntegerInRange(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be a whole number.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveHandoffSettings(
  timeoutSeconds: string | undefined,
  pollIntervalMs: string | undefined
): HandoffSettings {
  return {
    timeout_seconds: parseIntegerInRange(
      timeoutSeconds,
      '--timeout-seconds / HANDOFF_TIMEOUT_SECONDS',
      DEFAULT_HANDOFF_TIMEOUT_SECONDS,
      10,
      3_600
    ),
    poll_interval_ms: parseIntegerInRange(
      pollIntervalMs,
      '--poll-interval-ms / POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
      100,
      5_000
    ),
  };
}

export function parseApprovalTimestamp(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error('The approval marker did not contain a valid timestamp.');
  }
  return new Date(value).toISOString();
}

export function assertTimelineOrder(timeline: HandoffTimeline): void {
  const entries = Object.entries(timeline) as Array<
    [keyof HandoffTimeline, string]
  >;
  let previous = Number.NEGATIVE_INFINITY;
  for (const [name, value] of entries) {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      throw new Error(`${name} is not a valid timestamp.`);
    }
    if (timestamp < previous) {
      throw new Error(`${name} is earlier than the preceding handoff event.`);
    }
    previous = timestamp;
  }
}

export function durationBetween(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

export function buildDemoPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lexmount 人工接管演示</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --canvas: #f4f7f9;
        --surface: #ffffff;
        --text: #182230;
        --muted: #4a5565;
        --border: #d7dee7;
        --accent: #0b5fff;
        --accent-hover: #064acb;
        --accent-soft: #eaf1ff;
        --success: #067647;
        --focus: #2e90fa;
        background: var(--canvas);
        color: var(--text);
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        background: var(--canvas);
      }
      .skip-link {
        position: fixed;
        top: 8px;
        left: 8px;
        z-index: 1;
        padding: 8px 12px;
        border-radius: 6px;
        background: var(--text);
        color: var(--surface);
        transform: translateY(-160%);
      }
      .skip-link:focus {
        transform: translateY(0);
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }
      main {
        width: min(620px, 100%);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 24px;
        background: var(--surface);
        box-shadow: 0 8px 24px rgba(24, 34, 48, 0.08);
      }
      .eyebrow {
        margin: 0 0 12px;
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-size: clamp(28px, 5vw, 42px); line-height: 1.1; }
      p { color: var(--muted); line-height: 1.7; }
      .status {
        margin: 24px 0 16px;
        padding: 16px;
        border-left: 4px solid var(--accent);
        border-radius: 6px;
        background: var(--accent-soft);
        color: #123b75;
        font-weight: 700;
      }
      button {
        width: 100%;
        min-height: 52px;
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }
      button:hover { background: var(--accent-hover); }
      button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
      button:disabled { cursor: default; background: var(--success); }
      .footnote { margin-bottom: 0; font-size: 13px; }
      @media (min-width: 640px) {
        body { padding: 24px; }
        main { padding: 32px; }
      }
    </style>
  </head>
  <body data-handoff-state="waiting">
    <a class="skip-link" href="#handoff-main">跳到批准操作</a>
    <main id="handoff-main" aria-labelledby="handoff-title">
      <p class="eyebrow">Human checkpoint</p>
      <h1 id="handoff-title">需要你批准后继续</h1>
      <p>自动化已安全暂停。点击下方按钮后，同一个云端浏览器会话会继续执行剩余步骤。</p>
      <div id="handoff-status" class="status" role="status" aria-live="polite">正在等待人工操作</div>
      <button id="approve" type="button">批准并继续</button>
      <p class="footnote">此页由脚本生成，不需要第三方账号，也不会提交真实业务数据。</p>
    </main>
    <script>
      const button = document.querySelector('#approve');
      const status = document.querySelector('#handoff-status');
      const approve = () => {
        if (document.body.dataset.handoffState === 'approved') return;
        const approvedAt = new Date().toISOString();
        document.body.dataset.handoffState = 'approved';
        document.body.dataset.approvedAt = approvedAt;
        status.textContent = '已批准，等待自动化恢复';
        button.textContent = '已批准';
        button.disabled = true;
      };
      button.addEventListener('click', approve);
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        approve();
      });
    </script>
  </body>
</html>`;
}
