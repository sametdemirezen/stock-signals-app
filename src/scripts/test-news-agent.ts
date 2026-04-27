/**
 * Standalone test script for the news sentiment agent.
 *
 * This is the "real" way agents are used in production: programmatically,
 * with structured output, and the result is consumed by other code (or
 * other agents) rather than displayed in a chat UI.
 *
 * Run with: npx tsx src/scripts/test-news-agent.ts AAPL
 */
import 'dotenv/config';
import { mastra } from '../mastra';
import { newsSentimentSchema } from '../mastra/agents/news-sentiment-agent';


async function main() {
  // Read the ticker from CLI args, default to AAPL
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';

  console.log(`\nAnalyzing news sentiment for ${ticker}...\n`);

  // Get a handle to the agent we registered in src/mastra/index.ts
  const agent = mastra.getAgent('newsSentimentAgent');

  // Call the agent. Two important things happen here:
  //   1. We pass a natural language prompt as usual
  //   2. We pass structuredOutput.schema, which forces the agent to
  //      produce an object matching our schema instead of free text
  const result = await agent.generate(
    `Analyze the news sentiment for ${ticker}. Use the get-stock-news tool to fetch articles, then return the structured assessment.`,
    {
      structuredOutput: {
        schema: newsSentimentSchema,
      },
    },
  );

  // result.object is fully typed thanks to z.infer in the schema file.
  // Try typing `result.object.` in your editor — autocomplete will show
  // all available fields.
  console.log('Sentiment:', result.object.sentiment);
  console.log('Confidence:', result.object.confidence);
  console.log('Articles analyzed:', result.object.articlesAnalyzed);
  console.log('\nSummary:');
  console.log(result.object.summary);
  console.log('\nKey drivers:');
  result.object.keyDrivers.forEach((d) => console.log(' -', d));
  if (result.object.riskFlags.length > 0) {
    console.log('\nRisk flags:');
    result.object.riskFlags.forEach((r) => console.log(' -', r));
  }
  console.log('\n---\nFull JSON:');
  console.log(JSON.stringify(result.object, null, 2));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});