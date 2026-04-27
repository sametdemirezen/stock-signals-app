import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Helper to format a Date as YYYY-MM-DD, which is what Finnhub expects.
 */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const stockNewsTool = createTool({
  id: 'get-stock-news',
  description:
    'Fetches recent company news headlines for a given stock ticker ' +
    'from Finnhub. Returns headline, summary, source, and publication date. ' +
    'Use this to assess sentiment or recent developments around a stock.',

  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol, e.g. AAPL'),
    daysBack: z
      .number()
      .min(1)
      .max(7)
      .default(2)
      .describe('How many days back to fetch news for (1-7).'),
  }),

  outputSchema: z.object({
    ticker: z.string(),
    articleCount: z.number(),
    articles: z.array(
      z.object({
        headline: z.string(),
        summary: z.string(),
        source: z.string(),
        url: z.string(),
        publishedAt: z.string(),
      }),
    ),
  }),

  execute: async (inputData) => {
    const { ticker, daysBack } = inputData;

    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      throw new Error('FINNHUB_API_KEY is not set in environment.');
    }

    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const url =
      `https://finnhub.io/api/v1/company-news` +
      `?symbol=${encodeURIComponent(ticker)}` +
      `&from=${formatDate(from)}` +
      `&to=${formatDate(to)}` +
      `&token=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Finnhub request failed: ${response.status} ${response.statusText}`,
      );
    }

    const rawArticles = (await response.json()) as Array<{
      headline?: string;
      summary?: string;
      source?: string;
      url?: string;
      datetime?: number;
    }>;

    // Limit to 10 most recent — LLM context windows hate huge dumps,
    // and 10 is plenty for sentiment assessment.
    const articles = rawArticles.slice(0, 10).map((a) => ({
      headline: a.headline ?? '',
      summary: a.summary ?? '',
      source: a.source ?? 'unknown',
      url: a.url ?? '',
      publishedAt: a.datetime
        ? new Date(a.datetime * 1000).toISOString()
        : '',
    }));

    return {
      ticker,
      articleCount: articles.length,
      articles,
    };
  },
});