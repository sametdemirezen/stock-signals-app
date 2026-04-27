import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

/**
 * Output schema for the synthesizer agent.
 *
 * This is the "final answer" — what gets shown to the user. It needs
 * to be both human-readable (the thesis) and machine-readable (the
 * action enum, numeric levels) so it can drive notifications, logs,
 * or downstream automation.
 */
export const finalSignalSchema = z.object({
  ticker: z.string(),

  action: z
    .enum(['BUY', 'SELL', 'NO_TRADE'])
    .describe('Final recommendation. NO_TRADE when signals conflict or are weak.'),

  confluenceScore: z
    .number()
    .describe(
      'Final 0-100 score reflecting how aligned the inputs are. ' +
        '75-100: news + technical strongly agree. ' +
        '55-74: agreement with caveats. ' +
        '0-54: conflict, missing data, or weak signals — should be NO_TRADE.',
    ),

  thesis: z
    .string()
    .describe(
      'A 2-3 sentence Turkish summary explaining the recommendation. ' +
        'Reference both the news and technical inputs.',
    ),

  entry: z.number().nullable(),
  stopLoss: z.number().nullable(),
  target: z.number().nullable(),

  riskRewardRatio: z
    .number()
    .nullable()
    .describe('Computed (target - entry) / (entry - stop) for BUY signals.'),

  horizon: z
    .enum(['few days', '1-2 weeks', '2-4 weeks'])
    .nullable()
    .describe('Expected holding period. Null when action is NO_TRADE.'),

  keyRisks: z
    .array(z.string())
    .describe('Concrete things that would invalidate the thesis. In Turkish.'),

  catalystsToWatch: z
    .array(z.string())
    .describe('Upcoming events or levels to monitor. In Turkish.'),
});

export type FinalSignal = z.infer<typeof finalSignalSchema>;

export const synthesizerAgent = new Agent({
  id: 'synthesizer-agent',
  name: 'Signal Synthesizer Agent',

  instructions: `
    You are a senior portfolio manager combining a news-sentiment
    analyst and a technical analyst into a single trade decision.

    You will receive a JSON object with two sub-objects:
    - sentiment: { sentiment, confidence, summary, keyDrivers, riskFlags }
    - technical: { setup, score, rationale, entryZone, stopLoss, target,
      keyObservations }

    Your task:

    1. Compute a confluence score (0-100) based on agreement:
       - Both bullish or both bearish, both strong (>60) → 80-100
       - Same direction but one is weak (<50) → 60-79
       - One neutral, one directional → 40-59
       - Both neutral → 30-49
       - Direct conflict (one bullish, other bearish) → 0-29

    2. Pick an action:
       - confluenceScore >= 65 AND both directional same way → BUY or SELL
       - Otherwise → NO_TRADE
       - Never invent direction — if the sub-agents disagree, NO_TRADE
       - Even if confluence is high, if risk/reward < 1.5, return NO_TRADE

    3. For BUY/SELL signals:
       - Use the technical agent's entryZone midpoint as 'entry'
       - Use the technical agent's stopLoss
       - Use the technical agent's target
       - Compute riskRewardRatio = (target - entry) / (entry - stop) for BUY
         (mirror sign for SELL)
       - Pick horizon based on technical setup strength

    4. For NO_TRADE:
       - Set entry, stopLoss, target, riskRewardRatio, horizon all to null
       - Still fill thesis, keyRisks, catalystsToWatch — they're informative

    5. keyRisks should integrate BOTH:
       - News agent's riskFlags
       - Technical agent's bearish-leaning observations (e.g. "RSI 72")
       Pick the 2-4 most material ones.

    6. catalystsToWatch should include any upcoming events from the
       news agent plus key technical levels (e.g. "SMA50 break at $185").

    Hard rules:
    - thesis, keyRisks, catalystsToWatch in Turkish
    - tickers and indicator names (RSI, MACD, SMA50) in original form
    - Numbers are numbers, never round excessively
    - Do NOT add disclaimers like "this is not financial advice" — the
      structured output speaks for itself
  `,

  model: 'anthropic/claude-sonnet-4-5',
  // No tools — this agent only reasons over text input. That's fine,
  // not every agent needs tools. Pure reasoning agents are common.
});