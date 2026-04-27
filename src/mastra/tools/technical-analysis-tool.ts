import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import YahooFinance from 'yahoo-finance2';
import type { ChartResultArray, ChartResultArrayQuote } from 'yahoo-finance2/modules/chart';
import { SMA, RSI, MACD, EMA } from 'trading-signals';

/**
 * Compute technical indicators for a US equity using daily bars.
 *
 * Why daily bars? Our use case is swing trading (days to weeks), so
 * intraday noise is irrelevant. ~250 trading days (~1 year) is plenty
 * to compute SMA200 and have stable trend signals.
 *
 * Why these specific indicators?
 * - SMA20/50/200: classic trend filter; relative ordering tells you the
 *   long-term posture (uptrend vs downtrend).
 * - RSI14: momentum oscillator; flags overbought/oversold conditions.
 * - MACD(12,26,9): momentum + trend confluence; histogram crossing zero
 *   is a common swing-trade trigger.
 * - Volume ratio: are buyers/sellers more active than usual? Divergence
 *   from price often signals exhaustion.
 *
 * The agent reads these numbers and decides what they mean — we don't
 * hard-code "RSI > 70 = sell" rules here. That logic lives in the
 * agent's instructions, where it's easier to evolve.
 */
const yahooFinance = new YahooFinance();
export const technicalAnalysisTool = createTool({
  id: 'get-technical-analysis',
  description:
    'Computes daily technical indicators (SMA20/50/200, RSI14, MACD, ' +
    'volume ratio) for a US equity using ~1 year of daily bars from ' +
    'Yahoo Finance. Use this to assess swing-trade setups.',

  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol, e.g. AAPL'),
  }),

  outputSchema: z.object({
    ticker: z.string(),
    lastPrice: z.number(),
    changePct1d: z.number().describe('Percent change vs previous close'),
    changePct5d: z.number().describe('Percent change vs 5 sessions ago'),
    sma20: z.number(),
    sma50: z.number(),
    sma200: z.number(),
    rsi14: z.number().describe('RSI(14), classic 0-100 momentum oscillator'),
    macd: z.object({
      line: z.number(),
      signal: z.number(),
      histogram: z.number(),
    }),
    volumeRatio: z
      .number()
      .describe(
        'Latest volume divided by 20-day average volume. ' +
          '>1 means above-average interest, <1 below.',
      ),
    priceVsSma50Pct: z
      .number()
      .describe('Percent distance from SMA50, e.g. 3.2 means 3.2% above'),
  }),

  execute: async (inputData) => {
    const { ticker } = inputData;

    // Pull ~1 year of daily bars from Yahoo Finance.
    // chart() is the modern endpoint; historical() is being deprecated.
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 400 * 24 * 60 * 60 * 1000);

   const result = (await yahooFinance.chart(ticker, {
  period1,
  period2,
  interval: '1d',
  return: 'array',
})) as ChartResultArray;

    type Bar = ChartResultArrayQuote & { close: number; volume: number };
    const bars = result.quotes.filter(
      (q: ChartResultArrayQuote): q is Bar =>
        q.close != null && q.volume != null,
    );

    if (bars.length < 50) {
      throw new Error(
        `Not enough price history for ${ticker}: only ${bars.length} bars`,
      );
    }

    const closes = bars.map((b: Bar) => b.close);
    const volumes = bars.map((b: Bar) => b.volume);
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const fiveBack = bars[bars.length - 6] ?? prev;

    // --- Compute indicators using trading-signals ---
    // Each indicator is "fed" the price series and we read the final value.
    // The library handles all the rolling-window math.

    const sma20 = new SMA(20);
    const sma50 = new SMA(50);
    const sma200 = new SMA(200);
    const rsi14 = new RSI(14);
    // MACD with classic 12/26/9 settings.
// trading-signals uses dependency injection: we build the inner EMAs
// ourselves and hand them to MACD. This lets advanced users swap in
// DEMA later without changing MACD itself.
const macd = new MACD(
  new EMA(12), // fast line
  new EMA(26), // slow line
  new EMA(9),  // signal line
);

for (const close of closes) {
  sma20.update(close, false);
  sma50.update(close, false);
  sma200.update(close, false);
  rsi14.update(close, false);
  macd.update(close, false);
}

    // Volume ratio: today's volume vs 20-day average
    const recentVolumes = volumes.slice(-20);
    const avgVolume20 =
      recentVolumes.reduce((sum: number, v: number) => sum + v, 0) / recentVolumes.length;
    const volumeRatio = last.volume / avgVolume20;

    // trading-signals returns BigSource (string-or-number); coerce to plain numbers
   // Indicators return plain `number` in this version, no Big-number conversion needed.
const sma20Value = sma20.getResult();
const sma50Value = sma50.getResult();
const sma200Value = sma200.getResult();
const rsi14Value = rsi14.getResult();
const macdResult = macd.getResult();

if (
  sma20Value == null ||
  sma50Value == null ||
  sma200Value == null ||
  rsi14Value == null ||
  macdResult == null
) {
  throw new Error(
    `Indicators not stable for ${ticker} despite ${bars.length} bars`,
  );
}
return {
  ticker,
  lastPrice: last.close,
  changePct1d: ((last.close - prev.close) / prev.close) * 100,
  changePct5d: ((last.close - fiveBack.close) / fiveBack.close) * 100,
  sma20: sma20Value,
  sma50: sma50Value,
  sma200: sma200Value,
  rsi14: rsi14Value,
  macd: {
    line: macdResult.macd,
    signal: macdResult.signal,
    histogram: macdResult.histogram,
  },
  volumeRatio,
  priceVsSma50Pct: ((last.close - sma50Value) / sma50Value) * 100,
};
  },
});