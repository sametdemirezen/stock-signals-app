/**
 * Market scanner.
 *
 * Filters the S&P 500 universe down to ~30-40 tickers worth a closer
 * look, based on simple price + volume criteria. The goal is to feed
 * the multi-agent pipeline ONLY high-signal candidates, so we don't
 * waste LLM tokens analyzing 500 sleepy stocks every morning.
 *
 * Criteria:
 *   - Volume spike: today's volume >= 1.5x its 20-day average
 *   - Price move:   |today's % change| >= 2%
 *
 * A ticker passes if EITHER criterion fires. Each candidate is given
 * a numeric score (volumeRatio * |changePct|) and the top N are kept.
 *
 * Why these thresholds?
 *   - 1.5x volume + 2% move are loose enough to catch many candidates
 *     on quiet days, but tight enough to filter noise on busy ones.
 *   - These are tunable — you can adjust per market regime.
 */
import YahooFinance from 'yahoo-finance2';
import { SP500_TICKERS } from './sp500';

const yahooFinance = new YahooFinance();

export interface ScanCandidate {
  ticker: string;
  lastPrice: number;
  changePct: number;
  volumeRatio: number;
  score: number;
  reason: string; // human-readable why-it-passed
}

interface ScanOptions {
  topN?: number;
  minVolumeRatio?: number;
  minChangePct?: number;
  /**
   * Subset of tickers to scan. Defaults to full S&P 500.
   * Useful for testing with 10 tickers instead of 500.
   */
  universe?: readonly string[];
}

/**
 * Compute the 20-day average volume from a chart result.
 * Returns null if not enough history.
 */
function avgVolume20(volumes: number[]): number | null {
  if (volumes.length < 20) return null;
  const last20 = volumes.slice(-20);
  return last20.reduce((sum, v) => sum + v, 0) / last20.length;
}

/**
 * Fetch a quick price/volume snapshot for one ticker.
 * Returns null on error so the scanner can keep going.
 */
async function snapshot(ticker: string): Promise<ScanCandidate | null> {
  try {
    // We need ~25 days of bars to compute a 20-day volume average + today.
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 50 * 24 * 60 * 60 * 1000);

    const result = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval: '1d',
      return: 'array',
    });

    const bars = result.quotes.filter(
      (q): q is typeof q & { close: number; volume: number } =>
        q.close != null && q.volume != null,
    );

    if (bars.length < 21) return null; // not enough history

    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    const changePct = ((last.close - prev.close) / prev.close) * 100;
    const avgVol = avgVolume20(volumes.slice(0, -1)); // exclude today from avg
    if (avgVol == null) return null;
    const volumeRatio = last.volume / avgVol;

    // score is a simple combination: how unusual the volume + how big the move
    const score = volumeRatio * Math.abs(changePct);

    const reasons: string[] = [];
    if (volumeRatio >= 1.5) reasons.push(`vol ${volumeRatio.toFixed(1)}x`);
    if (Math.abs(changePct) >= 2) {
      reasons.push(`${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`);
    }

    return {
      ticker,
      lastPrice: last.close,
      changePct,
      volumeRatio,
      score,
      reason: reasons.join(', '),
    };
  } catch {
    // Yahoo occasionally errors on individual tickers (delisting, halts).
    // We swallow per-ticker errors so the scan doesn't die on one bad apple.
    return null;
  }
}

/**
 * Scan the universe and return the top N candidates by score.
 *
 * Internal concurrency: we batch into groups of 20 with Promise.all to
 * avoid hammering Yahoo with 500 simultaneous requests (rate limits).
 */
export async function scanMarket(opts: ScanOptions = {}): Promise<ScanCandidate[]> {
  const {
    topN = 20,
    minVolumeRatio = 1.5,
    minChangePct = 2,
    universe = SP500_TICKERS,
  } = opts;

  console.log(`Scanning ${universe.length} tickers...`);

  const candidates: ScanCandidate[] = [];
  const batchSize = 20;

  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((t) => snapshot(t)));

    for (const c of results) {
      if (
        c !== null &&
        (c.volumeRatio >= minVolumeRatio || Math.abs(c.changePct) >= minChangePct)
      ) {
        candidates.push(c);
      }
    }

    // brief pause between batches to be polite
    if (i + batchSize < universe.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Sort by score descending, take top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topN);
}