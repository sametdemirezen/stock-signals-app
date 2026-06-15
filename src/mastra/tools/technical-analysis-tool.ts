import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import YahooFinance from "yahoo-finance2";
import type {
  ChartResultArray,
  ChartResultArrayQuote,
} from "yahoo-finance2/modules/chart";
import { SMA, RSI, MACD, EMA, ATR } from "trading-signals";

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
  id: "get-technical-analysis",
  description:
    "Computes daily technical indicators (SMA20/50/200, RSI14, MACD, " +
    "volume ratio) for a US equity using ~1 year of daily bars from " +
    "Yahoo Finance. Use this to assess swing-trade setups.",

  inputSchema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),

  outputSchema: z.object({
    ticker: z.string(),
    lastPrice: z.number(),
    changePct1d: z.number().describe("Percent change vs previous close"),
    changePct5d: z.number().describe("Percent change vs 5 sessions ago"),
    sma20: z.number(),
    sma50: z.number(),
    sma200: z.number(),
    rsi14: z.number().describe("RSI(14), classic 0-100 momentum oscillator"),
    macd: z.object({
      line: z.number(),
      signal: z.number(),
      histogram: z.number(),
    }),
    volumeRatio: z
      .number()
      .describe(
        "Latest volume divided by 20-day average volume. " +
          ">1 means above-average interest, <1 below.",
      ),
    priceVsSma50Pct: z
      .number()
      .describe("Percent distance from SMA50, e.g. 3.2 means 3.2% above"),
    atr14: z
      .number()
      .describe(
        "Average True Range (14 days). Measures average daily volatility " +
          "in price units. Use for setting stops: tighter for low ATR " +
          "stocks, wider for high ATR stocks.",
      ),
    recent5dLow: z
      .number()
      .describe(
        "Lowest low price over the last 5 trading days. Acts as a " +
          "structural support level — if price breaks below this, " +
          "short-term momentum has shifted.",
      ),
    priceVsSma200Pct: z
      .number()
      .describe(
        "Percent distance from SMA200. Positive = above long-term trend. " +
          "This is the primary regime filter: above SMA200 = long-term " +
          "uptrend intact, below = downtrend territory.",
      ),

    recent20dHigh: z
      .number()
      .describe("Highest high over the last 20 trading days (~1 month)."),

    pctFrom20dHigh: z
      .number()
      .describe(
        "Percent distance below the 20-day high. E.g. -8.3 means price is " +
          "8.3% below the recent high. Measures pullback depth: -3 to -12 " +
          "in an uptrend is a typical buyable pullback zone; deeper may " +
          "signal trend damage.",
      ),
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
      interval: "1d",
      return: "array",
    })) as ChartResultArray;

    type Bar = ChartResultArrayQuote & { close: number; volume: number };
    const bars = result.quotes.filter(
      (
        q,
      ): q is typeof q & {
        close: number;
        volume: number;
        high: number;
        low: number;
      } =>
        q.close != null && q.volume != null && q.high != null && q.low != null,
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
      new EMA(9), // signal line
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
      recentVolumes.reduce((sum: number, v: number) => sum + v, 0) /
      recentVolumes.length;
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

    // ─── ATR(14) — Average True Range, volatility measure ─────────────
    // True Range for each bar = max of:
    //   (a) high - low
    //   (b) |high - previous close|
    //   (c) |low - previous close|
    // ATR is the rolling average of TR over 14 bars.
    // We use the trading-signals ATR class with HighLowClose inputs.
    const atr14Indicator = new ATR(14);
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      atr14Indicator.update(
        { high: bar.high, low: bar.low, close: bar.close },
        false,
      );
    }
    const atr14Result = atr14Indicator.getResult();
    if (atr14Result == null) {
      throw new Error(`ATR computation failed for ${ticker}`);
    }
    const atr14 = atr14Result;

    // ─── Recent 5-day low (structural support) ─────────────────────────
    // Look at the last 5 completed bars and find the lowest low.
    // "Today" is included, so this is "last 5 sessions including today".
    const last5Bars = bars.slice(-5);
    const recent5dLow = Math.min(...last5Bars.map((b) => b.low));

    // ─── Recent 20-day high (~1 month) and pullback depth ───────────────
    const last20Bars = bars.slice(-20);
    const recent20dHigh = Math.max(...last20Bars.map((b) => b.high));
    const pctFrom20dHigh =
      ((last.close - recent20dHigh) / recent20dHigh) * 100;

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
      atr14,
      recent5dLow,
      priceVsSma200Pct: ((last.close - sma200Value) / sma200Value) * 100,
      recent20dHigh,
      pctFrom20dHigh,
    };
  },
});
