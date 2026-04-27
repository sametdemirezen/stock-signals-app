import 'dotenv/config';
import { mastra } from '../mastra';
import { technicalAnalysisSchema } from '../mastra/agents/technical-analyst-agent';

async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';

  console.log(`\nAnalyzing technical setup for ${ticker}...\n`);

  const agent = mastra.getAgent('technicalAnalystAgent');

  const result = await agent.generate(
    `Analyze the technical setup for ${ticker} using the get-technical-analysis tool, then return the structured assessment.`,
    {
      structuredOutput: {
        schema: technicalAnalysisSchema,
      },
    },
  );

  const out = result.object;

  console.log('Setup:    ', out.setup);
  console.log('Score:    ', out.score);
  console.log('\nRationale:');
  console.log(out.rationale);

  if (out.entryZone) {
    console.log('\nTrade plan:');
    console.log(`  Entry: ${out.entryZone.low.toFixed(2)} - ${out.entryZone.high.toFixed(2)}`);
    console.log(`  Stop:  ${out.stopLoss?.toFixed(2) ?? '-'}`);
    console.log(`  Target:${out.target?.toFixed(2) ?? '-'}`);
  }

  console.log('\nKey observations:');
  out.keyObservations.forEach((o) => console.log(' -', o));

  console.log('\n---\nFull JSON:');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});