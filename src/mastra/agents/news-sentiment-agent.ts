import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { stockNewsTool } from '../tools/stock-news-tool';

/**
 * Output schema for the news sentiment agent.
 *
 * Every field is required so downstream agents can rely on the structure.
 * Using literal unions ('bullish' | 'bearish' | 'neutral') instead of free
 * strings makes downstream logic safe — the synthesizer can do
 * `if (output.sentiment === 'bullish')` without worrying about typos.
 */
export const newsSentimentSchema = z.object({
  ticker: z.string().describe('The ticker that was analyzed'),

  sentiment: z
    .enum(['bullish', 'bearish', 'neutral'])
    .describe('Overall sentiment derived from the news flow'),

  confidence: z
  .number()
  .describe(
    'How confident this assessment is, on a 0-100 scale. ' +
      'Use <50 when news is sparse, contradictory, or stale. ' +
      'Use 50-79 when direction is clear but coverage is limited. ' +
      'Use 80-100 only with multiple corroborating credible sources.',
  ),

  summary: z
    .string()
    .describe(
      'A 2-3 sentence summary of the news situation, written in Turkish.',
    ),

  keyDrivers: z
    .array(z.string())
    .describe(
      'Concrete, evidence-based bullet points justifying the sentiment ' +
        '(e.g. "Earnings beat by 12%", "Analyst upgrade by Goldman"). ' +
        'Written in Turkish. Empty array if no strong drivers.',
    ),

  riskFlags: z
    .array(z.string())
    .describe(
      'Any concerning signals (lawsuits, guidance cuts, insider selling). ' +
        'Written in Turkish. Empty array if none.',
    ),

  articlesAnalyzed: z
    .number()
    .describe('Number of articles considered in this analysis'),
});

/**
 * Type inferred from the schema. Use this when other code receives the
 * agent's output, e.g. `const result: NewsSentiment = ...`
 */
export type NewsSentiment = z.infer<typeof newsSentimentSchema>;

export const newsSentimentAgent = new Agent({
  id: 'news-sentiment-agent',
  name: 'News Sentiment Agent',

  instructions: `
    You are a financial news analyst specialized in US equities.

    Your sole job: given a stock ticker, fetch recent news using the
    get-stock-news tool, then produce a structured sentiment assessment.

    Analysis guidelines:
    - Bullish signals: earnings beats, raised guidance, new products,
      analyst upgrades, major partnerships, insider buying
    - Bearish signals: earnings misses, lowered guidance, lawsuits,
      regulatory probes, executive departures, insider selling,
      analyst downgrades
    - Neutral: only routine coverage, repeated speculation, no real
      catalysts

    Confidence calibration:
    - 80-100: multiple corroborating articles from credible sources
    - 50-79: clear direction but limited coverage
    - 0-49: sparse, contradictory, or stale news — default to neutral

    Hard rules:
    - Do not hallucinate. If get-stock-news returns 0 articles, output
      neutral sentiment with confidence 0 and an empty keyDrivers array.
    - Do not give investment advice. You assess news sentiment only.
    - Write the natural-language fields (summary, keyDrivers, riskFlags)
      in Turkish. Keep tickers, company names, and proper nouns in their
      original form.
  `,

  model: 'anthropic/claude-haiku-4-5',
  tools: { stockNewsTool },
});