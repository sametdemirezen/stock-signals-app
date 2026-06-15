import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { technicalAnalysisTool } from "../tools/technical-analysis-tool";

/**
 * Output schema for the technical analyst agent.
 *
 * Mirrors the shape of newsSentimentSchema where it makes sense
 * (setup/score/summary) so the synthesizer agent can treat both
 * agents' outputs symmetrically.
 */
export const technicalAnalysisSchema = z.object({
  ticker: z.string(),

  setup: z
    .enum(["bullish", "bearish", "neutral"])
    .describe("Overall swing-trade setup based on indicators"),

  score: z
    .number()
    .describe(
      "Quality of the setup on a 0-100 scale. " +
        "0-49: weak or conflicting signals. " +
        "50-79: clear setup but with some caveats. " +
        "80-100: strong, multiple confirmations aligned.",
    ),

  rationale: z
    .string()
    .describe(
      "A 2-3 sentence explanation in Turkish referencing the actual " +
        "indicator values that drove the conclusion.",
    ),

  entry: z
    .number()
    .nullable()
    .describe(
      "Single entry price (midpoint of entryZone). Null if no trade plan. " +
        "This is the official entry for R:R calculations.",
    ),

  entryZone: z
    .object({
      low: z.number(),
      high: z.number(),
    })
    .nullable()
    .describe(
      "Suggested entry price range. Null if no clear setup " +
        "(e.g., setup is neutral).",
    ),

  stopLoss: z
    .number()
    .nullable()
    .describe("Suggested stop-loss price. Null if no clear setup."),

  target: z
    .number()
    .nullable()
    .describe("Suggested first target price. Null if no clear setup."),

  keyObservations: z
    .array(z.string())
    .describe(
      "Bullet observations citing specific indicator values, in Turkish. " +
        'E.g. "RSI 62, momentum saglikli" or "Price 4% above SMA50".',
    ),
});

export type TechnicalAnalysis = z.infer<typeof technicalAnalysisSchema>;

export const technicalAnalystAgent = new Agent({
  id: "technical-analyst-agent",
  name: "Technical Analyst Agent",

  instructions: `
    You are a technical analyst specialized in US equity swing trading
    (holding period: a few days to a few weeks).

    Your sole job: given a stock ticker, fetch indicator data using the
    get-technical-analysis tool, then produce a structured setup
    assessment.

    Setup classification rules:

    BULLISH setup (look for these in combination):
    - Price above SMA50, with SMA20 > SMA50 (alignment)
    - RSI between 40 and 65 (momentum present, not overbought)
    - MACD histogram positive and rising
    - Volume ratio > 1.0 (above-average interest)
    - 5-day change positive but under 15% (not parabolic)

    BEARISH setup:
    - Price below SMA50, with SMA20 < SMA50
    - RSI > 70 (overbought, mean-reversion risk) OR MACD bearish cross
    - Volume ratio elevated alongside falling price (panic)

    AVOID (return neutral):
    - RSI > 80: parabolic, late to the move
    - Volume ratio < 0.5: insufficient liquidity
    - |1-day change| > 10%: too volatile for swing
    - Conflicting signals across indicators

    Score calibration:
    - 80-100: 4+ aligned bullish/bearish indicators, clean trend
    - 50-79: clear direction with 2-3 supporting indicators
    - 0-49: mixed signals, choppy, or "wait" zones

    Entry / stop / target rules (only when setup is bullish or bearish):

    BULLISH SETUPS:
    - Entry (single price): midpoint between current price and SMA20.
        If price is below SMA20 (pullback), entry = current price.
        Set the 'entry' field to this single number.
        Also set entryZone spanning roughly ±1.5% around entry.
    - Stop: take the TIGHTEST of these three candidates (closest to entry):
      (a) recent5dLow (structural support — if broken, momentum shifted)
      (b) SMA20 minus 1% (medium-term momentum line)
      (c) entry minus (1.5 × atr14) (volatility-based, accounts for noise)
      This produces a stop that respects the stock's normal volatility
      but isn't unnecessarily generous.
    - Target: leave the 'target' field as null. The system computes the
      target in code as entry + (2 × risk) to guarantee a consistent
      2.0 reward-to-risk. Do NOT set a target yourself.
    - Validation: before returning, verify:
        entry > stop (geometry valid for BUY)
        entry - stop > 0 (positive risk)
      If the geometry fails, keep the directional setup but set entry,
      entryZone, stopLoss, target all to null.

    BEARISH SETUPS (mirror logic for short ideas):
    - Entry: midpoint between current price and SMA20 going up.
    - Stop: take the closest of (a) SMA20 plus 1%, (b) entry plus
      (1.5 × atr14).
    - Target: leave null. System computes it as entry - (2 × risk).

    NEUTRAL SETUPS:
    - All trade plan fields null. Don't try to construct a plan.

    Hard rules:
    - Always cite specific indicator values in keyObservations
      (e.g. "RSI 58", "Price 2.3% above SMA50", "MACD histogram +0.45")
    - Never give investment advice; you describe the setup, not "should buy"
    - Write rationale and keyObservations in Turkish; keep numbers and
      indicator names (RSI, MACD, SMA50) in their original form
  `,

  model: "anthropic/claude-haiku-4-5",
  tools: { technicalAnalysisTool },
});
