import 'dotenv/config';
import { earningsDataTool } from '../mastra/tools/earnings-data-tool';
async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';

  console.log(`\nFetching earnings data for ${ticker}...\n`);

  const result = await earningsDataTool.execute!(
    { ticker } as any,
    {} as any,
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});