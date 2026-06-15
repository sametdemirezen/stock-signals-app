import { Agent } from "@mastra/core/agent";
import { z } from "zod";

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
    .enum(["BUY", "SELL", "NO_TRADE"])
    .describe(
      "Final recommendation. NO_TRADE when signals conflict or are weak.",
    ),

  confluenceScore: z
    .number()
    .describe(
      "Computed in code and overwritten — put 0 here, your value is ignored.",
    ),

  thesis: z
    .string()
    .describe(
      "A 2-3 sentence Turkish summary explaining the recommendation. " +
        "Reference both the news and technical inputs.",
    ),

  entry: z.number().nullable(),
  stopLoss: z.number().nullable(),
  target: z.number().nullable(),

  riskRewardRatio: z
    .number()
    .nullable()
    .describe("Computed (target - entry) / (entry - stop) for BUY signals."),

  horizon: z
    .enum(["few days", "1-2 weeks", "2-4 weeks"])
    .nullable()
    .describe("Expected holding period. Null when action is NO_TRADE."),

  keyRisks: z
    .array(z.string())
    .describe("Concrete things that would invalidate the thesis. In Turkish."),

  catalystsToWatch: z
    .array(z.string())
    .describe("Upcoming events or levels to monitor. In Turkish."),

  earningsContext: z
    .object({
      daysToEarnings: z
        .number()
        .nullable()
        .describe("Days until next earnings, null if none"),
      setup: z.enum(["bullish", "bearish", "neutral", "not_applicable"]),
      note: z.string().describe("Brief Turkish note on earnings timing impact"),
    })
    .nullable()
    .describe(
      "Earnings angle on the trade. Null if no earnings data available.",
    ),
});

export type FinalSignal = z.infer<typeof finalSignalSchema>;

export const synthesizerAgent = new Agent({
  id: "synthesizer-agent",
  name: "Signal Synthesizer Agent",

  instructions: `
  You are a senior portfolio manager combining specialist analysts into
  a single trade decision. You receive three sub-analyses:
  - sentiment: { sentiment, confidence, summary, keyDrivers, riskFlags }
  - technical: { setup, score, rationale, entry, entryZone, stopLoss,
    keyObservations }
  - earnings: { earningsWindow, preEarningsSetup, qualityScore, rationale,
    keyFactors, riskFlags, earningsRecommendation }

  IMPORTANT: alignment, confluence scoring, R:R, target price, and the
  earnings timing veto are ALL computed in code after you respond. Your
  job is the qualitative decision and the narrative — not the math.

  Your task:

  1. Decide action:
     - BUY: news and technical both lean bullish, technical has a valid
       entry + stopLoss, no strong conflicting signal.
     - SELL: both lean bearish with a valid short setup.
     - NO_TRADE: signals conflict, are weak, or technical gives no plan.
     Never invent a direction. When news and technical disagree, NO_TRADE.

  2. Trade plan (BUY/SELL only):
     - entry: use technical's 'entry' value
     - stopLoss: use technical's 'stopLoss' value
     - target: leave null (computed in code as 2R)
     - riskRewardRatio: leave null (computed in code)
     - horizon: pick based on setup strength
     - For NO_TRADE: entry, stopLoss, target, riskRewardRatio, horizon
       all null

  3. earningsContext — ALWAYS populate when earnings data exists:
     - daysToEarnings from earnings input (or null)
     - setup from earnings.preEarningsSetup
     - note: 1 Turkish sentence on the earnings timing impact, e.g.
       "Earnings 5 gün sonra, kalite skoru 75, pozisyon riski kontrollü."

  4. keyRisks — top 2-4 from all three inputs combined.
     Prioritize: imminent earnings > technical overbought > news risks
     > weak fundamentals.

  5. catalystsToWatch — upcoming earnings dates, key technical levels,
     news-flagged events.

  6. thesis — 2-3 Turkish sentences explaining the call, referencing
     news and technical. Be decisive.

  HARD RULES:
  - thesis, keyRisks, catalystsToWatch, earningsContext.note in Turkish
  - tickers, indicator names, numbers in original form
  - no "not financial advice" disclaimers
  - Do NOT mention any confluence number in the thesis — describe
    strength qualitatively ("güçlü uyum", "zayıf sinyal", "karışık
    görünüm") without a number.
`,

  model: "anthropic/claude-sonnet-4-5",
  // No tools — this agent only reasons over text input. That's fine,
  // not every agent needs tools. Pure reasoning agents are common.
});
