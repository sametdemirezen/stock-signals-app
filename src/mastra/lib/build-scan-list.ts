import { scanMarket, type ScanCandidate } from './scanner';

/**
 * Build the final list of tickers to analyze each morning.
 *
 * Combines:
 *   1. The user's static WATCHLIST from .env (always analyzed)
 *   2. Top movers from the daily market scanner (dynamic)
 *
 * Watchlist tickers always pass through; scanner candidates are
 * de-duplicated against the watchlist so we don't analyze the same
 * stock twice. The result is a clean, ordered list.
 */
export interface ScanListResult {
  watchlist: string[];
  scannerHits: ScanCandidate[];
  /** Final tickers, deduplicated, watchlist first then scanner additions */
  combined: string[];
}

/**
 * Read WATCHLIST from environment. Returns empty array if unset.
 * Tickers are uppercased and trimmed for safety.
 */
function readWatchlist(): string[] {
  const raw = process.env.WATCHLIST ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function buildScanList(opts: {
  scannerTopN?: number;
} = {}): Promise<ScanListResult> {
  const { scannerTopN = 15 } = opts;

  const watchlist = readWatchlist();
  console.log(`Watchlist: ${watchlist.length} tickers`);

  // Run the scanner. We don't pass a `universe`, so it uses full S&P 500.
  console.log('Running market scanner on full S&P 500...');
  const t0 = Date.now();
  const scannerHits = await scanMarket({ topN: scannerTopN });
  console.log(`Scanner finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${scannerHits.length} hits.`);

  // Deduplicate. Watchlist comes first; scanner hits append only if not
  // already in the watchlist. A Set tracks what we've seen.
  const seen = new Set<string>();
  const combined: string[] = [];

  for (const t of watchlist) {
    if (!seen.has(t)) {
      seen.add(t);
      combined.push(t);
    }
  }
  for (const c of scannerHits) {
    if (!seen.has(c.ticker)) {
      seen.add(c.ticker);
      combined.push(c.ticker);
    }
  }

  return { watchlist, scannerHits, combined };
}