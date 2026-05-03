import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { earningsDataTool } from '../tools/earnings-data-tool';

/**
 * Output schema for the earnings analyst agent.
 *
 * The shape mirrors news/technical agents (setup + score + rationale)
 * so the synthesizer can treat all three uniformly.
 */
export const earningsAnalysisSchema = z.object({
  ticker: z.string(),

  // Earnings timing situation — what window are we in?
  earningsWindow: z
    .enum([
      'imminent',      // earnings ≤ 2 days away (high risk for new positions)
      'approaching',   // earnings 3-7 days away (caution zone)
      'distant',       // earnings 8+ days away or unknown (normal trading)
      'recent',        // earnings just happened, post-earnings drift play
      'none',          // no upcoming earnings data found
    ])
    .describe('What earnings phase is the stock in right now?'),

  // Pre-earnings setup quality — only meaningful if window is approaching/imminent
  preEarningsSetup: z
    .enum(['bullish', 'bearish', 'neutral', 'not_applicable'])
    .describe(
      'How does the company look going into earnings? Based on beat ' +
        'history, fundamentals, and growth. "not_applicable" if window ' +
        'is distant or none.',
    ),

  // Quality score reflecting fundamentals + earnings track record
  qualityScore: z
    .number()
    .describe(
      'Company quality on 0-100 scale based on: profit margins, growth ' +
        'rates, beat streak consistency, and debt levels. 80+ = top-tier, ' +
        '60-79 = solid, 40-59 = average, <40 = weak.',
    ),

  rationale: z
    .string()
    .describe(
      'A 2-3 sentence Turkish explanation citing concrete numbers ' +
        '(beat streak, profit margin %, revenue growth %, days to earnings).',
    ),

  keyFactors: z
    .array(z.string())
    .describe(
      'Bullet observations in Turkish citing specific numbers from the ' +
        'data. E.g. "Son 3 quarter üst üste beat", "EPS büyüme %25", ' +
        '"Earnings 2 gün sonra - pozisyon riskli".',
    ),

  riskFlags: z
    .array(z.string())
    .describe(
      'Earnings-specific risks in Turkish. E.g. "Earnings 1 gün sonra, ' +
        'gap riski", "Son quarter miss vardı, momentum bozuk", ' +
        '"P/E 35 - değerleme yüksek". Empty array if no concerns.',
    ),

  // Trading recommendation based on the earnings angle alone
  earningsRecommendation: z
    .enum([
      'buy_before_earnings',  // strong setup, willing to hold through
      'buy_after_earnings',   // wait for the print, react to it
      'avoid_until_after',    // too risky to enter now
      'no_earnings_signal',   // no special timing edge
    ])
    .describe('What this agent thinks about timing trades around earnings.'),
});

export type EarningsAnalysis = z.infer<typeof earningsAnalysisSchema>;

export const earningsAnalystAgent = new Agent({
  id: 'earnings-analyst-agent',
  name: 'Earnings Analyst Agent',

  instructions: `
    You are an earnings-focused equity analyst. Your job: given a stock
    ticker, fetch earnings data and produce a structured assessment of
    how earnings timing and company quality affect trade decisions.

    Use the get-earnings-data tool to fetch:
    - Upcoming earnings date (if within 14 days)
    - Last 8 quarters of beat/miss history
    - Basic fundamentals (P/E, margins, growth, debt)

    EARNINGS WINDOW classification:
    - imminent: 0-2 days until earnings (DO NOT enter new positions)
    - approaching: 3-7 days until earnings (caution, tight stops)
    - distant: 8+ days OR no earnings scheduled (normal trading)
    - recent: earnings happened ≤2 days ago (look for post-earnings drift)
    - none: no upcoming earnings data found

    PRE-EARNINGS SETUP rules (when window is imminent or approaching):
    - BULLISH:
      * Beat streak ≥ 3 (consistent execution)
      * Avg surprise % > 3 (analysts underestimating)
      * EPS growth > 15% AND revenue growth > 5%
      * Profit margin > 10% (quality business)
    - BEARISH:
      * Last quarter was a miss
      * Beat streak = 0 with negative avg surprise
      * Revenue growth < 0 (declining business)
      * Debt-to-equity > 3 (leveraged)
    - NEUTRAL: mixed signals or insufficient data

    QUALITY SCORE: This is pre-computed in the tool output as 'qualityScore'.
    Use the value as-is — do not recalculate or modify it. Use it as input
    to your reasoning (e.g. "qualityScore 85 means premium business").

    EARNINGS RECOMMENDATION logic:
    - buy_before_earnings: window=approaching/distant + setup=bullish + quality>=60
    - avoid_until_after: window=imminent (always, regardless of setup)
    - buy_after_earnings: window=recent + last surprise was a beat
    - no_earnings_signal: window=distant/none with no special edge

    HARD RULES:
    - Always cite specific numbers in keyFactors and rationale (use the
      actual values from the tool output, not generic statements)
    - Round percentages to 1 decimal place
    - If upcomingEarnings is null, set window to 'none' or 'distant'
    - Write rationale, keyFactors, riskFlags in Turkish; keep ticker
      symbols, indicator names, and numbers in their original form
    - Do NOT give "buy/sell" advice in rationale — describe the earnings
      situation, the synthesizer agent will combine this with other inputs
  `,

  model: 'anthropic/claude-sonnet-4-5',
  tools: { earningsDataTool },
});