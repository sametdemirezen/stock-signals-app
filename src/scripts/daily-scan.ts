import 'dotenv/config';
import { buildScanList } from '../mastra/lib/build-scan-list';
import { mastra } from '../mastra';
import { newsSentimentSchema } from '../mastra/agents/news-sentiment-agent';
import { technicalAnalysisSchema } from '../mastra/agents/technical-analyst-agent';
import { finalSignalSchema, type FinalSignal } from '../mastra/agents/synthesizer-agent';
import { sendTelegram } from '../mastra/lib/telegram';
import { formatSignalForTelegram, formatHeaderMessage } from '../mastra/lib/format-signal';

const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 25_000;
const MIN_CONFLUENCE_SCORE = 65;

async function analyzeTicker(ticker: string): Promise<FinalSignal | null> {
  try {
    const newsAgent = mastra.getAgent('newsSentimentAgent');
    const techAgent = mastra.getAgent('technicalAnalystAgent');
    const synthAgent = mastra.getAgent('synthesizerAgent');

    const [newsResult, techResult] = await Promise.all([
      newsAgent.generate(
        `Analyze the news sentiment for ${ticker}. Use the get-stock-news tool, then return the structured assessment.`,
        { structuredOutput: { schema: newsSentimentSchema } },
      ),
      techAgent.generate(
        `Analyze the technical setup for ${ticker} using the get-technical-analysis tool, then return the structured assessment.`,
        { structuredOutput: { schema: technicalAnalysisSchema } },
      ),
    ]);

    const payload = JSON.stringify(
      { sentiment: newsResult.object, technical: techResult.object },
      null,
      2,
    );

    const synthResult = await synthAgent.generate(
      `Combine these two analyses into a final trade decision:\n\n${payload}`,
      { structuredOutput: { schema: finalSignalSchema } },
    );

    return synthResult.object;
  } catch (err) {
    console.error(`  ✗ ${ticker} failed:`, (err as Error).message);
    return null;
  }
}

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('   DAILY MARKET SCAN');
  console.log('══════════════════════════════════════════\n');

  const scanList = await buildScanList({ scannerTopN: 15 });
  //const tickers = scanList.combined; &&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&TESTING SLICE &&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&& 
  // Test mode: only run on the first 4 tickers (2 batches x 2 = ~2 min total).
// Remove this slice for full daily runs.
  const tickers = scanList.combined.slice(0, 4);

  console.log(`\nAnalyzing ${tickers.length} tickers in batches of ${BATCH_SIZE}...\n`);

  const allSignals: FinalSignal[] = [];
  const t0 = Date.now();

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tickers.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`);
    const batchStart = Date.now();

    const results = await Promise.all(batch.map((t) => analyzeTicker(t)));
    for (const r of results) {
      if (r !== null) allSignals.push(r);
    }

    const batchSecs = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`  done in ${batchSecs}s`);

    if (i + BATCH_SIZE < tickers.length) {
      console.log(`  waiting ${BATCH_DELAY_MS / 1000}s for rate limit window...`);
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nAll batches done in ${totalSecs}s.`);

  const actionable = allSignals
    .filter((s) => s.action !== 'NO_TRADE' && s.confluenceScore >= MIN_CONFLUENCE_SCORE)
    .sort((a, b) => b.confluenceScore - a.confluenceScore);

  console.log('\n══════════════════════════════════════════');
  console.log(`   REPORT — ${actionable.length} actionable signals`);
  console.log(`   (out of ${allSignals.length} analyzed)`);
  console.log('══════════════════════════════════════════\n');

  for (const sig of actionable) {
    const emoji = sig.action === 'BUY' ? '🟢' : '🔴';
    console.log(`${emoji}  ${sig.ticker}  →  ${sig.action}  (confluence ${sig.confluenceScore})`);
    console.log(`   ${sig.thesis}`);
    if (sig.entry !== null && sig.stopLoss !== null && sig.target !== null) {
      console.log(
        `   Entry: ${sig.entry.toFixed(2)}  Stop: ${sig.stopLoss.toFixed(2)}  Target: ${sig.target.toFixed(2)}` +
          (sig.riskRewardRatio !== null ? `  R:R ${sig.riskRewardRatio.toFixed(1)}` : ''),
      );
    }
    if (sig.keyRisks.length > 0) {
      console.log(`   Risks: ${sig.keyRisks.slice(0, 2).join('; ')}`);
    }
    console.log();
  }

  // ───────── Telegram delivery ─────────
  console.log('Sending to Telegram...');

  await sendTelegram(
    formatHeaderMessage({
      totalAnalyzed: allSignals.length,
      actionableCount: actionable.length,
    }),
  );

  for (const sig of actionable) {
    await sendTelegram(formatSignalForTelegram(sig));
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('✓ Telegram delivery complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});