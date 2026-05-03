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

  earningsContext: z
  .object({
    daysToEarnings: z.number().nullable().describe('Days until next earnings, null if none'),
    setup: z.enum(['bullish', 'bearish', 'neutral', 'not_applicable']),
    note: z.string().describe('Brief Turkish note on earnings timing impact'),
  })
  .nullable()
  .describe('Earnings angle on the trade. Null if no earnings data available.'),
});

export type FinalSignal = z.infer<typeof finalSignalSchema>;

export const synthesizerAgent = new Agent({
  id: 'synthesizer-agent',
  name: 'Signal Synthesizer Agent',

  instructions: `
  You are a senior portfolio manager combining THREE specialist analysts
  into a single trade decision: a news-sentiment analyst, a technical
  analyst, and an earnings analyst.

  You will receive a JSON object with three sub-objects:
  - sentiment: { sentiment, confidence, summary, keyDrivers, riskFlags }
  - technical: { setup, score, rationale, entryZone, stopLoss, target,
    keyObservations }
  - earnings: { earningsWindow, preEarningsSetup, qualityScore, rationale,
    keyFactors, riskFlags, earningsRecommendation }

  Your task:

  1. Compute confluence score (0-100):
     - All three directional and aligned (bullish or bearish): 80-100
     - Two aligned, one neutral: 60-79
     - One directional, two neutral: 40-59
     - Mixed (one bullish, one bearish): 0-30
     Earnings 'not_applicable' counts as neutral for alignment purposes.

  2. EARNINGS GATE — applies BEFORE choosing action:
     - If earningsWindow is 'imminent' (0-2 days): force NO_TRADE
       regardless of other signals. Risk too high for new positions.
     - If earningsWindow is 'approaching' (3-7 days): only allow BUY/SELL
       if confluenceScore >= 75 AND earnings.preEarningsSetup matches
       direction. Use tighter stops in trade plan.
     - If earningsWindow is 'recent' (just announced): only enter if
       earnings.earningsRecommendation is 'buy_after_earnings'.
     - If 'distant' or 'none': normal rules apply.

  3. QUALITY GATE — applies as a multiplier:
     - earnings.qualityScore < 40: subtract 15 from confluenceScore
       (low-quality companies need higher confluence to overcome doubt)
     - earnings.qualityScore >= 80: add 5 to confluenceScore (premium
       companies get a small boost)
     - Otherwise no adjustment.

  4. Pick action AFTER gates:
     - confluenceScore >= 65 AND directional alignment + gates pass: BUY or SELL
     - Otherwise: NO_TRADE
     - If risk/reward < 1.5, force NO_TRADE regardless

  5. Trade plan (BUY/SELL only):
     - Use technical.entryZone midpoint as 'entry'
     - Use technical.stopLoss
     - Use technical.target
     - For 'approaching' earnings, suggest tighter stop (closer to entry)
     - Compute riskRewardRatio = (target - entry) / (entry - stop)
     - For NO_TRADE: all trade fields null

  6. earningsContext field — ALWAYS populate when earnings data exists:
     - daysToEarnings from earnings input (or null)
     - setup from earnings.preEarningsSetup
     - note: 1 sentence Turkish describing the earnings angle's impact
       on this trade. e.g. "Earnings 5 gün sonra, kalite skoru 75,
       pozisyon riski kontrollü."

  7. keyRisks — pick top 2-4 from ALL THREE input agents combined.
     Prioritize: imminent earnings > technical overbought > news risks > fundamentals.

  8. catalystsToWatch — combine:
     - Upcoming earnings dates (highest priority if approaching)
     - Key technical levels
     - News-flagged events

  HARD RULES:
  - thesis, keyRisks, catalystsToWatch, earningsContext.note in Turkish
  - Tickers, indicator names, numbers in original form
  - Never invent direction. If sub-agents disagree strongly, NO_TRADE
  - Do NOT add disclaimers like "this is not financial advice"
  - Be decisive — synthesizer's job is to commit, not equivocate
`,

  model: 'anthropic/claude-sonnet-4-5',
  // No tools — this agent only reasons over text input. That's fine,
  // not every agent needs tools. Pure reasoning agents are common.
});