# Architecture — Stock Signals

Bu dokümanın amacı: birisi projeye ilk kez bakarken "neresi nereye bağlı,
hangi dosya ne yapıyor" sorularına 5 dakikada cevap vermek.

## Yüksek seviye akış

```
                 daily-scan.ts (entry point)
                          │
                          ▼
         ┌────────── buildScanList() ──────────┐
         │                                     │
   .env WATCHLIST                    scanMarket()
   (statik 10 hisse)                  S&P 500 (497 hisse)
         │                                     │
         │                              filtre + top 15
         │                                     │
         └──────── 25 unique ticker ──────────┘
                          │
                          ▼
              Her ticker için (batch=2):
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             │
    News Sentiment   Technical       (paralel)
       Agent         Analyst Agent
            └─────────────┬─────────────┘
                          ▼
                Synthesizer Agent
                          │
                  Final BUY/SELL/NO_TRADE
                          │
                          ▼
              Filter (confluence ≥ 65)
                          │
                          ▼
                      Telegram
```

## Klasör yapısı

```
src/
├── mastra/
│   ├── index.ts              ← Mastra registration: agent'lar burada
│   │                          kayıtlı, başka her şey buradan import edilir
│   │
│   ├── agents/               ← LLM agent'ları (instructions + tools + schema)
│   │   ├── news-sentiment-agent.ts
│   │   ├── technical-analyst-agent.ts
│   │   └── synthesizer-agent.ts
│   │
│   ├── tools/                ← Agent'ların çağırabileceği fonksiyonlar
│   │   ├── stock-news-tool.ts          ← Finnhub haberleri
│   │   ├── stock-price-tool.ts         ← Yahoo anlık fiyat (kullanılmıyor şu an)
│   │   └── technical-analysis-tool.ts  ← Yahoo geçmiş + RSI/MACD/SMA hesaplama
│   │
│   └── lib/                  ← Yardımcı modüller (LLM yok, saf JS/TS)
│       ├── sp500.ts                ← Statik S&P 500 ticker listesi
│       ├── scanner.ts              ← Volume/price filtresi
│       ├── build-scan-list.ts      ← Watchlist + scanner birleştirme
│       ├── telegram.ts             ← Bot API çağrısı (raw fetch)
│       └── format-signal.ts        ← Sinyal → HTML mesaj dönüşümü
│
└── scripts/                  ← Çalıştırılabilir entry pointler
    ├── test-news-agent.ts        ← Tek hisse haber sentiment testi
    ├── test-technical-agent.ts   ← Tek hisse teknik analiz testi
    ├── test-technical-tool.ts    ← Tool'u agent olmadan direkt test et
    ├── test-telegram.ts          ← Telegram çalışıyor mu smoke test
    ├── test-scanner.ts           ← Scanner debug
    ├── analyze-stock.ts          ← Tek hisse, multi-agent (3'lü pipeline)
    └── daily-scan.ts             ← PROD entry point: full pipeline
```

## Üç ajan, üç farklı sorumluluk

### News Sentiment Agent
- **Tool:** `stockNewsTool` (Finnhub)
- **Görev:** Son 2 günün haberlerini al, bullish/bearish/neutral skoru ver
- **Output:** `{ sentiment, confidence, summary, keyDrivers, riskFlags, articlesAnalyzed }`
- **Tek sorumluluğu:** haber yorumlamak. Fiyata bakmaz.

### Technical Analyst Agent
- **Tool:** `technicalAnalysisTool` (Yahoo + trading-signals)
- **Görev:** RSI/MACD/SMA hesapla, swing setup'ı bullish/bearish/neutral skala
- **Output:** `{ setup, score, rationale, entryZone, stopLoss, target, keyObservations }`
- **Tek sorumluluğu:** teknik göstergeleri yorumlamak. Habere bakmaz.

### Synthesizer Agent
- **Tool:** YOK (akıl yürüten ajan, API çağırmaz)
- **Görev:** İki yukarıdaki ajanın çıktısını birleştir, BUY/SELL/NO_TRADE kararı ver
- **Output:** `{ action, confluenceScore, thesis, entry, stopLoss, target, riskRewardRatio, ... }`
- **Tek sorumluluğu:** confluence değerlendirmesi. Yeni veri toplamaz.

Bu **single responsibility** ayrımı önemli — her ajan tek konuda uzman, kuralları net,
debug etmesi kolay. Bir agent'a "her şeyi yap" demek hem prompt'u kötüleştirir hem
hata yapma alanını büyütür.

## Veri akışı: bir ticker'ın hayat döngüsü

Örnek: NVDA için ne oluyor?

1. **Scanner pass:** `scanner.ts` Yahoo'dan NVDA'nın 50 günlük fiyat/hacmini çeker.
   Volume ratio 1.5x veya |change| %2 üstündeyse "aday" olur.

2. **Combined list'e girer:** `build-scan-list.ts` watchlist + scanner sonuçlarını
   `Set` ile dedup edip tek listeye koyar.

3. **Multi-agent pipeline başlar** (`daily-scan.ts`):
   - News Agent + Technical Agent **PARALEL** çalışır (`Promise.all`)
   - News Agent → `stockNewsTool` → Finnhub API → 10 haber → LLM yorumu
   - Technical Agent → `technicalAnalysisTool` → Yahoo API → 250 günlük bar → RSI/MACD/SMA → LLM yorumu

4. **Synthesizer çağrılır:** İki ajanın JSON çıktısı tek payload'da gönderilir.
   Synthesizer "iki ajan ne diyor, çelişiyor mu, birleşik karar ne?" diye düşünür.
   `BUY | SELL | NO_TRADE` döner.

5. **Filter:** `daily-scan.ts` sonucu `MIN_CONFLUENCE_SCORE` ile karşılaştırır.
   `NO_TRADE` ise veya skor düşükse filtrelenir.

6. **Telegram:** Sinyal varsa `formatSignalForTelegram()` ile HTML mesajına
   dönüşür, `sendTelegram()` ile gönderilir.

## Schema validation: Zod'un rolü

Her agent'ın bir **çıktı şeması** var (`newsSentimentSchema`, `technicalAnalysisSchema`,
`finalSignalSchema`). Bunlar üç şey birden yapıyor:

1. **LLM'e ne dönmesi gerektiğini anlatır** (Anthropic API'ye gönderilir)
2. **Cevap geldiğinde doğrular** (yanlış format ise Mastra retry yapar)
3. **TypeScript tipi olarak da çalışır** (`z.infer<typeof schema>`)

Yani bir tek schema = dokümantasyon + validation + tip güvenliği. Bu yüzden her
ajanı yazarken önce schema, sonra instructions diye düşünüyoruz.

## Rate limiting — sistemin nefes alma şekli

İki yerde rate limit endişesi var:

1. **Scanner → Yahoo Finance:** 497 hisseyi 20'şerli batch'lerde paralel çekiyoruz,
   batch'ler arasında 200ms duruyoruz. Yahoo bu hızda hata vermiyor.

2. **Multi-agent → Anthropic Tier 1:** 30k input token/dakika limit.
   `BATCH_SIZE=2` (2 ticker = 6 LLM çağrısı = ~24k token) + `BATCH_DELAY_MS=25000`
   (25s bekleme) = limitin altında kalıyoruz.

Bu sayılar **yatırım**. Sıkıştırırsan rate limit yer, gevşetirsen vakit kaybedersin.

## .env değişkenleri

```
ANTHROPIC_API_KEY      # LLM çağrıları için
FINNHUB_API_KEY        # Haber çekmek için
TELEGRAM_BOT_TOKEN     # Mesaj göndermek için
TELEGRAM_CHAT_ID       # Hangi chat'e gönderilecek
WATCHLIST              # Sürekli takip edilen 10 hisse, virgülle ayrılmış
```

## Toggleable modlar

`daily-scan.ts` içinde bir comment-toggle var:

```typescript
const scanList = await buildScanList({ scannerTopN: 15 });          // FULL
// const scanList = await buildScanList({ skipScanner: true });     // FAST
```

- **FULL mode:** Watchlist + S&P 500 scanner, ~25 ticker, ~10 dakika
- **FAST mode:** Sadece watchlist, 10 ticker, ~4 dakika

Birinin başına `//` ekleyip diğerinden çıkararak değiştirirsin (Ctrl+/ kısayol).
