import { escapeHtml } from './telegram';
import type { FinalSignal } from '../agents/synthesizer-agent';

/**
 * Convert a FinalSignal into a Telegram-ready HTML message.
 *
 * Format goals:
 * - Mobile-friendly: short lines, no horizontal scroll
 * - Skimmable: most important info at the top
 * - Self-contained: each message stands alone (no "see previous message")
 */
export function formatSignalForTelegram(sig: FinalSignal): string {
  const emoji = sig.action === 'BUY' ? '🟢' : sig.action === 'SELL' ? '🔴' : '⚪';

  const lines: string[] = [];

  // Header line — emoji + ticker + action + score
  lines.push(
    `${emoji} <b>${sig.ticker}</b> → <b>${sig.action}</b> (confluence ${sig.confluenceScore})`,
  );
  lines.push(''); // blank line for breathing room

  // Thesis — escaped because it's free-form LLM output
  lines.push(escapeHtml(sig.thesis));

  // Trade plan, only if we have one
  if (sig.entry !== null && sig.stopLoss !== null && sig.target !== null) {
    lines.push('');
    lines.push('<b>📋 Trade Plan</b>');
    lines.push(`<code>Entry:  ${sig.entry.toFixed(2)}</code>`);
    lines.push(`<code>Stop:   ${sig.stopLoss.toFixed(2)}</code>`);
    lines.push(`<code>Target: ${sig.target.toFixed(2)}</code>`);
    if (sig.riskRewardRatio !== null) {
      lines.push(`<code>R:R     ${sig.riskRewardRatio.toFixed(2)}</code>`);
    }
    if (sig.horizon !== null) {
      lines.push(`<code>Horizon: ${sig.horizon}</code>`);
    }
  }

  // Risks — keep it to top 2 to avoid wall-of-text
  if (sig.keyRisks.length > 0) {
    lines.push('');
    lines.push('<b>⚠️ Riskler</b>');
    for (const risk of sig.keyRisks.slice(0, 2)) {
      lines.push(`• ${escapeHtml(risk)}`);
    }
  }

  // Catalysts to watch
  if (sig.catalystsToWatch.length > 0) {
    lines.push('');
    lines.push('<b>👀 Takip Edilecek</b>');
    for (const cat of sig.catalystsToWatch.slice(0, 2)) {
      lines.push(`• ${escapeHtml(cat)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Header message sent before individual signals.
 * Gives an at-a-glance summary of the daily scan.
 */
export function formatHeaderMessage(opts: {
  totalAnalyzed: number;
  actionableCount: number;
}): string {
  const { totalAnalyzed, actionableCount } = opts;
  const date = new Date().toLocaleDateString('tr-TR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (actionableCount === 0) {
    return [
      '<b>📊 Günlük Tarama</b>',
      `<i>${escapeHtml(date)}</i>`,
      '',
      `${totalAnalyzed} hisse analiz edildi.`,
      '',
      'Bugün eşik değerini geçen sinyal yok.',
      'Piyasa belirsiz veya sinyaller zayıf — bekleyiş günü.',
    ].join('\n');
  }

  return [
    '<b>📊 Günlük Sinyal Raporu</b>',
    `<i>${escapeHtml(date)}</i>`,
    '',
    `${totalAnalyzed} hisse tarandı.`,
    `<b>${actionableCount} fırsat</b> tespit edildi 🎯`,
  ].join('\n');
}