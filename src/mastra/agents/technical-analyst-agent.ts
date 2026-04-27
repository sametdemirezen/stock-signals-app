import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { technicalAnalysisTool } from '../tools/technical-analysis-tool';

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
    .enum(['bullish', 'bearish', 'neutral'])
    .describe('Overall swing-trade setup based on indicators'),

  score: z
    .number()
    .describe(
      'Quality of the setup on a 0-100 scale. ' +
        '0-49: weak or conflicting signals. ' +
        '50-79: clear setup but with some caveats. ' +
        '80-100: strong, multiple confirmations aligned.',
    ),

  rationale: z
    .string()
    .describe(
      'A 2-3 sentence explanation in Turkish referencing the actual ' +
        'indicator values that drove the conclusion.',
    ),

  entryZone: z
    .object({
      low: z.number(),
      high: z.number(),
    })
    .nullable()
    .describe(
      'Suggested entry price range. Null if no clear setup ' +
        '(e.g., setup is neutral).',
    ),

  stopLoss: z
    .number()
    .nullable()
    .describe('Suggested stop-loss price. Null if no clear setup.'),

  target: z
    .number()
    .nullable()
    .describe('Suggested first target price. Null if no clear setup.'),

  keyObservations: z
    .array(z.string())
    .describe(
      'Bullet observations citing specific indicator values, in Turkish. ' +
        'E.g. "RSI 62, momentum saglikli" or "Price 4% above SMA50".',
    ),
});

export type TechnicalAnalysis = z.infer<typeof technicalAnalysisSchema>;

export const technicalAnalystAgent = new Agent({
  id: 'technical-analyst-agent',
  name: 'Technical Analyst Agent',

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
    - Bullish entry zone: from current price down to SMA20
    - Bullish stop: 2-3% below SMA50, or recent swing low
    - Bullish target: previous high, or 2:1 reward-to-risk vs the stop
    - For bearish setups, mirror these (short setups)
    - If setup is neutral, set entryZone, stopLoss, target all to null

    Hard rules:
    - Always cite specific indicator values in keyObservations
      (e.g. "RSI 58", "Price 2.3% above SMA50", "MACD histogram +0.45")
    - Never give investment advice; you describe the setup, not "should buy"
    - Write rationale and keyObservations in Turkish; keep numbers and
      indicator names (RSI, MACD, SMA50) in their original form
  `,

  model: 'anthropic/claude-sonnet-4-5',
  tools: { technicalAnalysisTool },
});