import { scanMarket, type ScanCandidate } from './scanner';

export interface ScanListResult {
  watchlist: string[];
  scannerHits: ScanCandidate[];
  /** Final tickers, deduplicated, watchlist first then scanner additions */
  combined: string[];
}

function readWatchlist(): string[] {
  const raw = process.env.WATCHLIST ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function buildScanList(opts: {
  scannerTopN?: number;
  /**
   * If true, skips the full S&P 500 scan and returns only the watchlist.
   * Use this for quick local runs (~watchlist size analysis) instead of
   * the full daily scan that adds scanner-discovered tickers.
   */
  skipScanner?: boolean;
} = {}): Promise<ScanListResult> {
  const { scannerTopN = 15, skipScanner = false } = opts;

  const watchlist = readWatchlist();
  console.log(`Watchlist: ${watchlist.length} tickers`);

  // Fast path: watchlist-only mode. No network calls beyond what the
  // multi-agent pipeline will already make.
  if (skipScanner) {
    console.log('Scanner skipped (watchlist-only mode).');
    return {
      watchlist,
      scannerHits: [],
      combined: [...watchlist],
    };
  }

  console.log('Running market scanner on full S&P 500...');
  const t0 = Date.now();
  const scannerHits = await scanMarket({ topN: scannerTopN });
  console.log(`Scanner finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${scannerHits.length} hits.`);

  // Dedupe: watchlist first, then scanner hits if not already present.
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