import 'dotenv/config';
import { buildScanList } from '../mastra/lib/build-scan-list';

async function main() {
  console.log('\n=== Building scan list ===\n');

  const result = await buildScanList({ scannerTopN: 15 });

  console.log('\n──── Final scan list ────');
  console.log(`Watchlist tickers:    ${result.watchlist.length}`);
  console.log(`Scanner top hits:     ${result.scannerHits.length}`);
  console.log(`Combined (unique):    ${result.combined.length}`);
  console.log();

  console.log('Top scanner hits:');
  console.log('Ticker  | Price    | Change   | Vol×    | Reason');
  console.log('────────┼──────────┼──────────┼─────────┼─────────────');
  for (const c of result.scannerHits) {
    const ticker = c.ticker.padEnd(7);
    const price = `$${c.lastPrice.toFixed(2)}`.padEnd(9);
    const chg = `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}%`.padEnd(9);
    const vol = `${c.volumeRatio.toFixed(2)}x`.padEnd(8);
    console.log(`${ticker} | ${price}| ${chg}| ${vol}| ${c.reason}`);
  }
  console.log();

  console.log('Final combined list (will be sent to multi-agent pipeline):');
  console.log(result.combined.join(', '));
  console.log();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});