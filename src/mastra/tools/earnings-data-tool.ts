import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

/**
 * Fetches three earnings-related data points for a ticker:
 *   1. Upcoming earnings date + estimates (within next 14 days)
 *   2. Last 8 quarters of beat/miss history (estimate vs actual)
 *   3. A curated subset of basic financials (P/E, margins, growth, etc.)
 *
 * Why one tool instead of three? Because the earnings agent needs all
 * three together to do its job — fetching them separately would mean
 * three sequential agent->tool round-trips. One call, one return, faster.
 *
 * The agent can selectively use what's relevant. If a ticker has no
 * upcoming earnings, that field is null and the agent ignores it.
 */
export const earningsDataTool = createTool({
  id: 'get-earnings-data',
  description:
    'Fetches earnings information for a stock: upcoming earnings date ' +
    '(within next 14 days), historical beat/miss surprises (last 8 ' +
    'quarters), and key fundamental metrics (P/E, profit margin, ' +
    'revenue growth, debt levels). Use this to assess pre-earnings ' +
    'setups, post-earnings reactions, and overall company quality.',

  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol, e.g. AAPL'),
  }),

  outputSchema: z.object({
    ticker: z.string(),

    // Upcoming earnings — null if nothing scheduled in next 14 days
    upcomingEarnings: z
      .object({
        date: z.string().describe('Earnings date YYYY-MM-DD'),
        daysUntil: z.number().describe('How many calendar days from today'),
        epsEstimate: z.number().nullable(),
        revenueEstimate: z.number().nullable().describe('In USD'),
        hour: z.string().nullable().describe('"bmo" before market open, "amc" after market close, or null'),
      })
      .nullable(),

    // Last 8 quarters of beat/miss
    earningsHistory: z.array(
      z.object({
        period: z.string(),
        quarter: z.number(),
        year: z.number(),
        epsEstimate: z.number(),
        epsActual: z.number(),
        surprisePercent: z.number().describe('Positive = beat, negative = miss'),
      }),
    ),

    // Aggregate stats from earnings history
    beatStreak: z.number().describe('How many consecutive recent beats (0 if last was a miss)'),
    avgSurprisePct: z.number().describe('Average surprise % over the history we have'),

    // Curated fundamentals — only the ones a swing trader cares about
    fundamentals: z.object({
      peTTM: z.number().nullable().describe('Price-to-earnings (trailing 12 months)'),
      pegRatio: z.number().nullable().describe('PE / earnings growth'),
      profitMarginTTM: z.number().nullable().describe('Net profit margin %'),
      revenueGrowthTTM: z.number().nullable().describe('Revenue growth YoY %'),
      epsGrowthTTM: z.number().nullable().describe('EPS growth YoY %'),
      debtToEquity: z.number().nullable(),
      week52High: z.number().nullable(),
      week52Low: z.number().nullable(),
      pctFrom52High: z.number().nullable().describe('How far below 52-week high, e.g. -8.3 means 8.3% below'),
    }),

    qualityScore: z
      .number()
      .describe(
        'Computed in code: 0-100 based on beat streak (25), profit margin (25), ' +
          'revenue growth (25), debt-to-equity (25). Deterministic, not LLM-derived.',
      ),
  }),

  execute: async (inputData) => {
    const { ticker } = inputData;
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      throw new Error('FINNHUB_API_KEY is not set in environment.');
    }

    // ─── 1. Upcoming earnings (next 14 days) ─────────────────────────
    const today = new Date();
    const future = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const calRes = await fetch(
      `${FINNHUB_BASE}/calendar/earnings?from=${fmt(today)}&to=${fmt(future)}` +
        `&symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
    );
    if (!calRes.ok) throw new Error(`Earnings calendar failed: ${calRes.status}`);
    const calData = (await calRes.json()) as {
      earningsCalendar?: Array<{
        date: string;
        epsEstimate: number | null;
        revenueEstimate: number | null;
        hour: string | null;
      }>;
    };

    let upcomingEarnings: {
      date: string;
      daysUntil: number;
      epsEstimate: number | null;
      revenueEstimate: number | null;
      hour: string | null;
    } | null = null;

    const next = calData.earningsCalendar?.[0];
    if (next) {
      const earningsDate = new Date(next.date);
      const daysUntil = Math.round(
        (earningsDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
      );
      upcomingEarnings = {
        date: next.date,
        daysUntil,
        epsEstimate: next.epsEstimate,
        revenueEstimate: next.revenueEstimate,
        hour: next.hour,
      };
    }

    // ─── 2. Earnings history (last 8 quarters) ──────────────────────
    const histRes = await fetch(
      `${FINNHUB_BASE}/stock/earnings?symbol=${encodeURIComponent(ticker)}` +
        `&limit=8&token=${apiKey}`,
    );
    if (!histRes.ok) throw new Error(`Earnings history failed: ${histRes.status}`);
    const histRaw = (await histRes.json()) as Array<{
      period: string;
      quarter: number;
      year: number;
      estimate: number;
      actual: number;
      surprisePercent: number;
    }>;

    const earningsHistory = histRaw.map((h) => ({
      period: h.period,
      quarter: h.quarter,
      year: h.year,
      epsEstimate: h.estimate,
      epsActual: h.actual,
      surprisePercent: h.surprisePercent,
    }));

    // Compute beat streak: count consecutive beats from most recent backwards
    let beatStreak = 0;
    for (const e of earningsHistory) {
      if (e.surprisePercent > 0) beatStreak++;
      else break;
    }

    const avgSurprisePct =
      earningsHistory.length > 0
        ? earningsHistory.reduce((sum, e) => sum + e.surprisePercent, 0) /
          earningsHistory.length
        : 0;

    // ─── 3. Basic financials ────────────────────────────────────────
    const finRes = await fetch(
      `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}` +
        `&metric=all&token=${apiKey}`,
    );
    if (!finRes.ok) throw new Error(`Financials failed: ${finRes.status}`);
    const finData = (await finRes.json()) as {
      metric?: Record<string, number | null>;
    };
    const m = finData.metric ?? {};

    // Pull only the fields we care about. Finnhub returns hundreds — we
    // pick the swing-trade-relevant ones to keep the agent's context lean.
    const week52High = m['52WeekHigh'] ?? null;
    const lastPrice = m['52WeekHighDate'] ? null : null; // not in this endpoint
    // pctFrom52High will be computed by the agent using lastPrice from
    // the technical tool — we just pass week52High here.

    const fundamentals = {
      peTTM: m['peTTM'] ?? null,
      pegRatio: m['pegRatio'] ?? null,
      profitMarginTTM: m['netProfitMarginTTM'] ?? null,
      revenueGrowthTTM: m['revenueGrowthTTMYoy'] ?? null,
      epsGrowthTTM: m['epsGrowthTTMYoy'] ?? null,
      debtToEquity: m['totalDebt/totalEquityQuarterly'] ?? null,
      week52High,
      week52Low: m['52WeekLow'] ?? null,
      pctFrom52High: null as number | null, // agent will compute using last price
    };

    const qualityScore = computeQualityScore({
      beatStreak,
      profitMarginTTM: fundamentals.profitMarginTTM,
      revenueGrowthTTM: fundamentals.revenueGrowthTTM,
      debtToEquity: fundamentals.debtToEquity,
    });

    return {
      ticker,
      upcomingEarnings,
      earningsHistory,
      beatStreak,
      avgSurprisePct,
      fundamentals,
      qualityScore
      
    };
  },
});

/**
 * Compute company quality score from fundamentals + earnings consistency.
 *
 * Each factor contributes up to 25 points, summed to 0-100. Designed to
 * be deterministic so the synthesizer's confluence math is reproducible.
 *
 * Tunable: if real-world testing shows the weights need adjusting,
 * change them here once instead of editing prompts in multiple places.
 */
function computeQualityScore(opts: {
  beatStreak: number;
  profitMarginTTM: number | null;
  revenueGrowthTTM: number | null;
  debtToEquity: number | null;
}): number {
  let score = 0;

  // Beat streak: consistent execution
  if (opts.beatStreak >= 4) score += 25;
  else if (opts.beatStreak === 3) score += 20;
  else if (opts.beatStreak === 2) score += 15;
  else if (opts.beatStreak === 1) score += 10;

  // Profit margin: business quality
  const margin = opts.profitMarginTTM;
  if (margin !== null) {
    if (margin > 20) score += 25;
    else if (margin > 10) score += 18;
    else if (margin > 5) score += 10;
    // <5% gets 0
  }

  // Revenue growth: company is expanding
  const growth = opts.revenueGrowthTTM;
  if (growth !== null) {
    if (growth > 15) score += 25;
    else if (growth > 5) score += 18;
    else if (growth > 0) score += 10;
    // negative growth gets 0
  }

  // Debt-to-equity: balance sheet health (lower is better)
  const debt = opts.debtToEquity;
  if (debt !== null) {
    if (debt < 1) score += 25;
    else if (debt < 2) score += 18;
    else if (debt < 3) score += 10;
    // >3 gets 0
  }

  return score;
}