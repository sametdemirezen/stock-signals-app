import 'dotenv/config';
import { mastra } from '../mastra';
import { newsSentimentSchema } from '../mastra/agents/news-sentiment-agent';
import { technicalAnalysisSchema } from '../mastra/agents/technical-analyst-agent';
import { finalSignalSchema } from '../mastra/agents/synthesizer-agent';

async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';

  console.log(`\n=== Analyzing ${ticker} ===\n`);

  // STAGE 1 — gather: run the two data agents in parallel.
  console.log('Stage 1: news + technical (parallel)...');
  const t1 = Date.now();

  const newsAgent = mastra.getAgent('newsSentimentAgent');
  const techAgent = mastra.getAgent('technicalAnalystAgent');

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

  const news = newsResult.object;
  const tech = techResult.object;

  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`  news=${news.sentiment} (${news.confidence})  tech=${tech.setup} (${tech.score})\n`);

  // STAGE 2 — synthesize: feed both outputs into the synthesizer agent.
  // It produces the final BUY/SELL/NO_TRADE decision.
  console.log('Stage 2: synthesizer...');
  const t2 = Date.now();

  const synthAgent = mastra.getAgent('synthesizerAgent');

  // Pass the two sub-agent outputs as a single JSON-stringified payload
  // in the user message. The synthesizer's instructions tell it what
  // structure to expect.
  const payload = JSON.stringify({ sentiment: news, technical: tech }, null, 2);

  const synthResult = await synthAgent.generate(
    `Combine these two analyses into a final trade decision:\n\n${payload}`,
    { structuredOutput: { schema: finalSignalSchema } },
  );

  const final = synthResult.object;

  console.log(`  done in ${((Date.now() - t2) / 1000).toFixed(1)}s\n`);

  // ───── Final report ─────
  console.log('═══════════════════════════════════════════');
  const emoji = final.action === 'BUY' ? '🟢' : final.action === 'SELL' ? '🔴' : '⚪';
  console.log(`  ${emoji}  ${ticker}  →  ${final.action}`);
  console.log(`  Confluence score: ${final.confluenceScore}`);
  console.log('═══════════════════════════════════════════\n');

  console.log('THESIS:');
  console.log(final.thesis, '\n');

  if (final.action !== 'NO_TRADE') {
    console.log('TRADE PLAN:');
    console.log(`  Entry:        ${final.entry?.toFixed(2) ?? '-'}`);
    console.log(`  Stop loss:    ${final.stopLoss?.toFixed(2) ?? '-'}`);
    console.log(`  Target:       ${final.target?.toFixed(2) ?? '-'}`);
    console.log(`  Risk/Reward:  ${final.riskRewardRatio?.toFixed(2) ?? '-'}`);
    console.log(`  Horizon:      ${final.horizon ?? '-'}\n`);
  }

  if (final.keyRisks.length > 0) {
    console.log('KEY RISKS:');
    final.keyRisks.forEach((r) => console.log('  -', r));
    console.log();
  }

  if (final.catalystsToWatch.length > 0) {
    console.log('CATALYSTS TO WATCH:');
    final.catalystsToWatch.forEach((c) => console.log('  -', c));
    console.log();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});