import 'dotenv/config';
import { mastra } from '../mastra';
import { earningsAnalysisSchema } from '../mastra/agents/earnings-analyst-agent';

async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';

  console.log(`\nAnalyzing earnings situation for ${ticker}...\n`);

  const agent = mastra.getAgent('earningsAnalystAgent');

  const result = await agent.generate(
    `Analyze the earnings situation for ${ticker}. Use the get-earnings-data tool, then return the structured assessment.`,
    {
      structuredOutput: { schema: earningsAnalysisSchema },
    },
  );

  const out = result.object;

  console.log('Earnings window:    ', out.earningsWindow);
  console.log('Pre-earnings setup: ', out.preEarningsSetup);
  console.log('Quality score:      ', out.qualityScore);
  console.log('Recommendation:     ', out.earningsRecommendation);
  console.log('\nRationale:');
  console.log(out.rationale);

  console.log('\nKey factors:');
  out.keyFactors.forEach((f) => console.log(' -', f));

  if (out.riskFlags.length > 0) {
    console.log('\nRisk flags:');
    out.riskFlags.forEach((r) => console.log(' -', r));
  }

  console.log('\n---\nFull JSON:');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});