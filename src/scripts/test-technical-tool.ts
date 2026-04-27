import 'dotenv/config';
import { technicalAnalysisTool } from '../mastra/tools/technical-analysis-tool';

async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'NVDA';

  console.log(`\nDirect tool call for ${ticker}...\n`);

  // Bypass the LLM. Call the tool's execute() directly so any error
  // bubbles up here in plain JavaScript form.
  const result = await technicalAnalysisTool.execute!(
    { ticker } as any,
    {} as any,
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('TOOL ERROR:');
  console.error(err);
  process.exit(1);
});