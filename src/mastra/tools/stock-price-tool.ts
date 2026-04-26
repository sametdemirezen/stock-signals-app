import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance();

export const stockPriceTool = createTool({
  id: 'get-stock-price',
  description:
    'Fetches the current price information for a stock from Yahoo Finance. ' +
    'A ticker symbol (e.g. AAPL, MSFT) must be provided.',

  inputSchema: z.object({
    ticker: z.string().describe('Stock ticker symbol, e.g. AAPL'),
  }),

  outputSchema: z.object({
    ticker: z.string(),
    price: z.number(),
    currency: z.string(),
    changePercent: z.number(),
    marketState: z.string(),
  }),

  execute: async (inputData) => {
    const { ticker } = inputData;

    const quote = await yf.quote(ticker);

    return {
      ticker: quote.symbol ?? ticker,
      price: quote.regularMarketPrice ?? 0,
      currency: quote.currency ?? 'USD',
      changePercent: quote.regularMarketChangePercent ?? 0,
      marketState: quote.marketState ?? 'UNKNOWN',
    };
  },
});