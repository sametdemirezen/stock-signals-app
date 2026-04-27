# Stock Signals — Multi-Agent Swing Trading Assistant

A TypeScript multi-agent system that scans the US stock market (NYSE/NASDAQ)
daily and produces swing-trade signals by combining news sentiment, technical
analysis, and a synthesizer agent. Results are pushed to Telegram.

Built with [Mastra](https://mastra.ai), Anthropic Claude, Yahoo Finance, and
Finnhub.

> **Disclaimer:** This is an educational project, not investment advice.
> LLM-based signals do not guarantee alpha. Backtest before risking capital.

---

## What it does

Every run:

1. **Builds a scan list** — combines a static watchlist with the day's
   top movers from S&P 500 (volume spike + price move filters)
2. **Runs three agents per ticker:**
   - **News Sentiment Agent** — fetches recent Finnhub headlines, scores
     bullish/bearish/neutral with confidence
   - **Technical Analyst Agent** — pulls Yahoo Finance daily bars,
     computes RSI/MACD/SMAs, evaluates the swing setup
   - **Signal Synthesizer Agent** — combines both inputs into a final
     BUY/SELL/NO_TRADE decision with entry, stop, target, and R:R
3. **Filters** to high-confluence signals only (default ≥65)
4. **Sends** the report to Telegram, one clean message per signal

Typical output: 25 tickers analyzed → 0-5 actionable signals.

---

## Architecture
*****************************************************************************************************************************************
┌─────────────────────┐
                │   daily-scan.ts     │
                └──────────┬──────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
     Watchlist (.env)         Market scanner (S&P 500)
            │                             │
            └──────────────┬──────────────┘
                      ~25 tickers
                           │
              For each ticker (in batches):
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  │
News Sentiment Agent   Technical Agent        │
   (Finnhub)            (Yahoo Finance)       │
        └──────────────────┬──────────────────┘
                           │
                   Signal Synthesizer Agent
                           │
                     Final decision
                           │
                        Telegram

*****************************************************************************************************************************************

## Tech stack

- **Language:** TypeScript (Node.js 20+)
- **Agent framework:** Mastra
- **LLM:** Anthropic Claude Sonnet 4.5 (via Vercel AI SDK)
- **Validation:** Zod schemas (structured output)
- **Market data:** yahoo-finance2 (price/volume), Finnhub (news)
- **Indicators:** trading-signals (RSI, MACD, SMA, EMA)
- **Notifications:** Telegram Bot API (raw fetch, no wrapper)
- **Storage:** LibSQL + DuckDB (Mastra defaults)

---

## Setup

### Prerequisites

- Node.js ≥ 20
- An Anthropic API key with at least Tier 1 access
- A Finnhub free API key (https://finnhub.io)
- A Telegram bot token + your chat ID

### Installation

```bash
git clone <your-repo>
cd stock-signals
npm install
cp .env.example .env
# Fill in .env, see "Environment variables" below
```

### Environment variables

```env
# LLM
ANTHROPIC_API_KEY=sk-ant-...

# News provider
FINNHUB_API_KEY=...

# Telegram delivery
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789

# Watchlist (comma-separated, no spaces)
WATCHLIST=AAPL,NVDA,MSFT,GOOGL,META,AMZN,TSLA,JPM,V,WMT
```

### Telegram bot setup

1. Talk to [@BotFather](https://t.me/BotFather), `/newbot`, follow prompts.
2. Save the token to `.env`.
3. Open your new bot in Telegram and send any message.
4. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser.
5. Find `chat.id` in the JSON, save to `.env`.

---

## Usage

### Manual single-ticker analysis

```bash
npx tsx src/scripts/test-news-agent.ts NVDA
npx tsx src/scripts/test-technical-agent.ts NVDA
npx tsx src/scripts/analyze-stock.ts NVDA
```

### Full daily scan (watchlist + scanner + Telegram)

```bash
npx tsx src/scripts/daily-scan.ts
```

Takes ~10 minutes due to Anthropic rate limits at Tier 1
(30k input tokens/min). Tier 2 cuts this to ~3 minutes.

### Mastra Studio (interactive agent debugging)

```bash
npm run dev
```

Then open http://localhost:4111. Useful for prompt iteration.

---

## Project structure
src/
├── mastra/
│   ├── index.ts                       # Mastra registration
│   ├── agents/
│   │   ├── news-sentiment-agent.ts
│   │   ├── technical-analyst-agent.ts
│   │   └── synthesizer-agent.ts
│   ├── tools/
│   │   ├── stock-news-tool.ts         # Finnhub
│   │   ├── stock-price-tool.ts        # Yahoo (single quote)
│   │   └── technical-analysis-tool.ts # Yahoo (history) + indicators
│   └── lib/
│       ├── sp500.ts                   # Static S&P 500 ticker list
│       ├── scanner.ts                 # Volume/price filter
│       ├── build-scan-list.ts         # Watchlist + scanner merge
│       ├── telegram.ts                # Bot API wrapper
│       └── format-signal.ts           # HTML message templating
└── scripts/
├── test-news-agent.ts
├── test-technical-agent.ts
├── test-technical-tool.ts
├── test-telegram.ts
├── test-scanner.ts
├── analyze-stock.ts               # Single ticker, multi-agent
└── daily-scan.ts                  # Full pipeline (production entry)

---

## Configuration knobs

In `src/scripts/daily-scan.ts`:

- `BATCH_SIZE` — tickers analyzed in parallel (default 2 for Anthropic Tier 1)
- `BATCH_DELAY_MS` — wait between batches (default 25s, prevents rate limits)
- `MIN_CONFLUENCE_SCORE` — signals below this are filtered out (default 65)

In `src/mastra/lib/scanner.ts`:

- `minVolumeRatio` — volume spike threshold (default 1.5x)
- `minChangePct` — price move threshold (default 2%)

---

## Known limitations

- **Free Yahoo Finance** is unofficial; production should use Polygon.io or IEX
- **Pre-market data** isn't computed; scanner uses last completed bar
- **No backtesting** yet — signals are forward-looking only
- **Tier 1 rate limits** make full scans slow (~10 min); upgrade to Tier 2
  ($40 deposit) cuts this drastically
- **No persistence** of past signals — every run is independent

---

## Roadmap

- [ ] Backtest engine (historical news + price replay)
- [ ] Position sizing agent (Kelly, volatility-based)
- [ ] Earnings calendar integration
- [ ] Insider trading (SEC Form 4) tool
- [ ] Multi-LLM voting (Claude + GPT cross-check)
- [ ] Web dashboard (Next.js + Mastra client)
- [ ] Live intraday alerts on major news

---

## License

MIT