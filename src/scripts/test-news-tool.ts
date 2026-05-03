import 'dotenv/config';
import { stockNewsTool } from '../mastra/tools/stock-news-tool';

async function main() {
  const ticker = process.argv[2]?.toUpperCase() ?? 'AAPL';
  const daysBack = process.argv[3] ? parseInt(process.argv[3], 10) : 2;

  console.log(`\nFetching news for ${ticker} (last ${daysBack} days)...\n`);

  // Call the tool's execute() directly. No agent, no LLM, no analysis —
  // just the raw Finnhub output formatted for human reading.
  const result = await stockNewsTool.execute!(
    { ticker, daysBack } as any,
    {} as any,
  ) as { ticker: string; articleCount: number; articles: Array<{ headline: string; summary: string; source: string; url: string; publishedAt: string }> };

  console.log(`${result.articleCount} article(s) found:\n`);
  console.log('─'.repeat(80));

  for (const article of result.articles) {
    // Convert ISO timestamp to readable Turkish locale
    const date = new Date(article.publishedAt).toLocaleString('tr-TR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    console.log(`📰 ${article.headline}`);
    console.log(`   ${date}  •  ${article.source}`);
    if (article.summary) {
      // Truncate long summaries to keep terminal output readable
      const summary =
        article.summary.length > 200
          ? article.summary.slice(0, 200) + '...'
          : article.summary;
      console.log(`   ${summary}`);
    }
    console.log(`   🔗 ${article.url}`);
    console.log('─'.repeat(80));
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});