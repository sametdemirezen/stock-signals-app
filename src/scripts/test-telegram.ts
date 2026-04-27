import 'dotenv/config';
import { sendTelegram, escapeHtml } from '../mastra/lib/telegram';

async function main() {
  const messageText = `
<b>Test message from stock-signals 🤖</b>

If you can read this, your Telegram setup is working.

<b>Sample signal preview:</b>
🟢 <b>NVDA</b> → BUY (confluence 78)

<i>Entry: 208.27</i>
<i>Stop:  198.00</i>
<i>Target: 230.00</i>

<b>Risks:</b> ${escapeHtml('RSI > 70 (overbought)')}
  `.trim();

  console.log('Sending test message to Telegram...');
  await sendTelegram(messageText);
  console.log('✓ Sent! Check your Telegram.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});