/**
 * Telegram notifier.
 *
 * Sends messages to a single chat via Telegram's HTTP API. We use the
 * built-in fetch() rather than a wrapper library because:
 *   - We only need outbound sendMessage; no need for polling/webhooks
 *   - Zero dependencies = nothing to break on package updates
 *   - The API is simple enough to call directly
 *
 * If the env vars are missing, sendTelegram() falls back to console
 * output so the rest of the pipeline still works during development.
 */

const TELEGRAM_API = 'https://api.telegram.org';

interface SendOptions {
  /**
   * Telegram supports two markdown flavors. We use MarkdownV2 because it's
   * the modern one, but it requires escaping a long list of special chars.
   * If you don't want to deal with escaping, switch to 'HTML' instead.
   */
  parseMode?: 'MarkdownV2' | 'HTML';
  disableLinkPreview?: boolean;
}

/**
 * Send a single message to the configured Telegram chat.
 * Throws on transport errors but does not throw on env-missing — that
 * just falls back to console so dev workflow keeps moving.
 */
export async function sendTelegram(
  text: string,
  opts: SendOptions = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('\n[telegram bypass — env vars missing, printing to console]\n');
    console.log(text);
    console.log();
    return;
  }

  const { parseMode = 'HTML', disableLinkPreview = true } = opts;

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: disableLinkPreview,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `Telegram sendMessage failed: ${response.status} — ${errBody}`,
    );
  }
}

/**
 * Telegram's MarkdownV2 requires escaping a bunch of special characters.
 * For HTML mode you only need to escape <, >, and &.
 *
 * We use HTML by default because there are way fewer characters to
 * worry about — financial signals contain a lot of -, ., (, ), %, etc.
 * which would all need escaping in MarkdownV2.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}