# Tasarım Kararları — Stock Signals

Bu dosyanın amacı: "neden böyle yaptık" sorularını gelecekteki kendine cevap
vermek. Bir karar verirken **alternatifleri**, **trade-off'ları** ve **tetikleyiciyi**
yazıyoruz, böylece 6 ay sonra "ne düşünmüştüm acaba" demiyoruz.

Format: her karar bir başlık altında. Tarih, neyi neden seçtik, neyi reddettik.

---

## Neden Mastra (vs LangGraph.js, AutoGen, ham SDK)

**Karar:** Multi-agent framework olarak Mastra v1.x kullanıyoruz.

**Alternatifler:**
- **Vercel AI SDK ham:** Daha düşük seviye, kendi orkestrayonunu yazarsın. Esnek
  ama "agent + tool + memory + observability" stack'ini sıfırdan kurmak gerekir.
- **LangGraph.js:** State machine modeli, daha steep learning curve. Daha çok
  "research / experimental" yönünde ağırlıklı.
- **AutoGen:** Microsoft'un, agent-to-agent konuşma odaklı. Bizim kullanım
  senaryomuza fazla geliyor (biz pipeline kuruyoruz, sohbet değil).

**Niye Mastra:**
- TypeScript-native, modern API (Vercel AI SDK üstüne kurulu)
- Built-in: agent registration, tool framework, structured output, memory,
  observability, Studio UI
- Mastra Studio prompt iteration için **çok değerli** — agent'ı sohbette
  test edersin, sonra koda gömersin

**Trade-off:** Hızlı gelişen framework, breaking change'ler yedik. Adım 4'te
tool execute imzası v0.x'ten v1.x'e değişmişti (`{context}` → `inputData`).

---

## Neden Anthropic Claude Sonnet 4.5

**Karar:** Tüm agent'lar `anthropic/claude-sonnet-4-5` kullanıyor.

**Alternatifler:**
- **Haiku 4.5:** 10x ucuz, 5x hızlı, ama nuance yakalama zayıf (özellikle
  synthesizer için kritik)
- **GPT-4 / 4o:** Karşılaştırılabilir kalite, ama bizim için sebep yok değişmek

**Niye Sonnet:**
- Türkçe çıktı kalitesi yüksek (Haiku'da bazen tuhaflıklar oluyor)
- Structured output desteği yerleşik
- Tool calling güvenilir

**İleride deneme için:** News + Technical Haiku, Synthesizer Sonnet ("model
routing" pattern). Maliyet düşer. Şimdilik ölçmedik, optimize etmiyoruz.

---

## Tek bir agent yerine üç agent (single responsibility)

**Karar:** News, Technical, Synthesizer ayrı ajanlar.

**Alternatif:** Tek bir "do everything" ajanı, tüm tool'lara erişebilir,
"AAPL'ı analiz et" deyince hepsine bakar.

**Niye ayrı:**
- Her ajanın tek bir kuralı var, instructions kısa ve net
- Bir ajan yanlış davranırsa diğerini etkilemiyor (debug kolay)
- News ve Technical PARALEL çalışabiliyor (`Promise.all`) — 2x hız
- Synthesizer farklı bir reasoning karakterinde — "iki uzmanın görüşünü
  birleştir" tek bir prompt'la yapması daha kontrollü

**Trade-off:** 3 LLM çağrısı / ticker = daha pahalı + rate limit baskısı.
Ama tutarlılık değer. Adım 6'da bunu test ettik, kalite belirgin daha iyi.

---

## Confluence skoru ≥ 65 filtre

**Karar:** Synthesizer'dan gelen sinyal `confluenceScore < 65` ise
filtreliyoruz, Telegram'a göndermiyoruz.

**Alternatif:** Tüm sinyalleri gönder, kullanıcı kendi karar versin.

**Niye 65:**
- 80-100 = "iki ajan güçlü hemfikir" → kesin sinyal
- 65-79 = "hemfikir ama bir tarafta uyarılar var" → değerli
- < 65 = karışık veya zayıf, gürültü

Eşik **prompt'tan değil koddan** geliyor (`MIN_CONFLUENCE_SCORE` const'u).
İleride veriyle eşiği ayarlarız (50 sinyal birikince istatistik tutarız).

---

## Scanner kriterleri: volume 1.5x VEYA price %2

**Karar:** S&P 500'den top 15 hisse seçerken iki kriter, OR mantığı:
- Volume ratio ≥ 1.5x (20-gün ortalamasına göre)
- |Daily change| ≥ %2

**Alternatifler:**
- AND mantığı (her ikisi de) — çok az aday çıkar, sakin günlerde 0
- Daha gevşek (1.2x, %1) — çok aday, gürültü artar
- 52-week high yakınlığı, gap analizi gibi ek filtreler

**Niye böyle:**
- OR + 1.5x/2% = sakin günlerde 5-10 aday, hareketli günlerde 30+ aday
- Skor formülü (`volumeRatio × |changePct|`) ikisini birden ödüllendiriyor,
  yani her iki sinyali aynı anda gösteren hisseler en üste çıkıyor

**İleride:** Pre-market gap, 52-week high yakınlığı eklenmeli. Adım 9 sonrası.

---

## scannerTopN = 15

**Karar:** Scanner'dan en yüksek skorlu 15 hisseyi alıyoruz, watchlist'le
birleştirip ~25 unique ticker oluşuyor.

**Alternatifler:** 10 (daha hızlı, az fırsat), 30 (daha çok fırsat, çok yavaş).

**Niye 15:**
- 10 watchlist + 15 scanner ≈ 25 ticker
- 25 × 3 LLM çağrısı = 75 çağrı
- Tier 1 rate limit (30k token/dk) ile ~10 dakika
- 10 dakika = "akşam tetikle, sabah uyandığında rapor hazır" için ideal

**Tetikleyici:** Hızlı feedback loop'ta 30 ticker çok yorucu. 15 + watchlist
sweet spot çıktı.

---

## BATCH_SIZE = 2 (Anthropic rate limit)

**Karar:** Multi-agent pipeline'da aynı anda en fazla 2 ticker analiz ediliyor.

**Tetikleyici:** Adım 8'de batch=5 ile başladık, **429 rate_limit_error** patladı.
Anthropic Tier 1 limiti dakikada 30k input token. 5 ticker × 3 çağrı × ~4k
token = 60k → limit 2x aşılıyor.

**Niye 2:**
- 2 × 3 = 6 çağrı / batch ≈ 24k token, limit altında güvende
- BATCH_DELAY_MS=25000 ile dakikalık pencere yeniliyor

**İleride:** Tier 2'ye geçince ($40 ödeme) limit 80k → batch=5 yapılabilir,
3x hızlanırız.

---

## Yahoo Finance + Finnhub (vs Polygon, IEX)

**Karar:** Fiyat için yahoo-finance2 (unofficial), haber için Finnhub free tier.

**Alternatifler:**
- **Polygon.io:** Kalite yüksek, $30/ay, prod-grade
- **IEX Cloud:** Benzer, fiyat değişti son zamanlarda
- **Alpaca:** Broker entegre, ücretsiz katmanı var

**Niye Yahoo + Finnhub:**
- İkisi de bedava (Finnhub free tier 60 req/dakika yeter)
- Setup hızlı (key bile gerekmiyor Yahoo'da)
- Kalite hobby/öğrenme amaçlı yeterli

**Trade-off:**
- Yahoo unofficial — patlarsa sorumlusu yok
- Pre-market data zayıf
- Veri tazeliği gün içinde tutarsız (volume ratio sabah eksik gözüküyor)

**Production'a giderken:** Polygon.io geç, Yahoo'ya backup olarak bırak.

---

## Kod İngilizce, agent çıktısı Türkçe

**Karar:** Tüm kod ve `instructions` İngilizce, ama her ajanın son satırında
"respond in Turkish" var.

**Tetikleyici:** Adım 2'de Türkçe instructions yazıyordum, sen "kod İngilizce
olsun" dedin.

**Niye:**
- LLM'ler İngilizce instruction ile daha iyi çalışıyor (eğitim verisi büyük
  çoğunluğu İngilizce)
- Açık kaynak / paylaşım için İngilizce kod evrensel
- Hata mesajları, dokümantasyon zaten İngilizce, tutarlılık iyi
- Cursor/Copilot gibi AI toolları İngilizce kodla çok daha iyi çalışıyor

**Sonuç:** Tüm `instructions` İngilizce, son satırı `Always respond in Turkish`.
Bu pattern her agent'ta aynı.

---

## Telegram için raw fetch (vs node-telegram-bot-api)

**Karar:** `node-telegram-bot-api` paketi yerine doğrudan `fetch()` ile API çağrısı.

**Alternatifler:** Resmi sayılan `node-telegram-bot-api` paketi.

**Niye raw:**
- Sadece outbound `sendMessage` lazım, polling/webhook yok
- API endpoint'i çok basit, wrapper hiçbir şey kazandırmıyor
- Sıfır dependency, paket güncellemelerinde kırılma riski yok
- Node 18+ `fetch` built-in, ekstra paket yok

**Telegram bot kullanıcı mesajlarına da cevap verecekse** (örn. `/analyze AAPL`
komutu), polling lazım olur, paket bağlamak doğru olur. Şu an gerekmiyor.

---

## Telegram için HTML mode (vs MarkdownV2)

**Karar:** Mesajları `parse_mode: 'HTML'` ile gönderiyoruz.

**Alternatif:** `MarkdownV2`

**Niye HTML:**
- MarkdownV2'de `_ * [ ] ( ) ~ \`> # + - = | { } . !` hepsini escape etmek
  gerekiyor. Finansal sinyallerde `+4.32%`, `R:R 1.6`, `Stop: 350.00` her yerde,
  bir karakter unutursan mesaj **gitmez** (Bad Request)
- HTML'de sadece `<`, `>`, `&` escape edilmeli — finans verisinde nadir
- Format gücü aynı (`<b>`, `<i>`, `<code>`)

---

## Statik S&P 500 listesi (vs Wikipedia scrape)

**Karar:** Sp500 ticker listesi `src/mastra/lib/sp500.ts`'de hardcoded.

**Alternatif:** Her gün Wikipedia veya bir API'den çek.

**Niye statik:**
- S&P 500 yılda ~20 değişir, günlük scrape gereksiz
- İnternete bağımlılık katmanı + failure mode bir tane daha
- Hangi hisseleri taradığımızı tam kontrol ediyoruz

**Bakım:** Yılda bir kez Wikipedia'dan al, dosyayı güncelle.

---

## Trading-signals (vs technicalindicators)

**Karar:** Teknik göstergeler için `trading-signals` paketi.

**Tetikleyici:** İlk başta `technicalindicators` önermiştim, ama bu paket:
- Son güncelleme 2020'den
- `canvas` adında native dependency gerektiriyor (Linux'ta C derleyici sorunu)
- Bakımsız, modern TS değil

**Niye trading-signals:**
- TypeScript-native, aktif geliştiriliyor
- Native bağımlılığı yok
- Modern API (streaming-friendly)

**Tuzak:** v7+'da `MACD` constructor `EMA` instance'ları alıyor, integer
parametreler değil. `new MACD(new EMA(12), new EMA(26), new EMA(9))`. README
v6 sözdizimi gösteriyor olabilir, `.d.ts` dosyasına bak.

---

## .env vs config dosyası vs CLI args

**Karar:** Tüm secret'lar ve user-specific config `.env`'de.

**Niye:**
- Standart Node.js convention
- `.gitignore`'da, asla repo'ya gitmez
- Production deployment'larda (GitHub Actions, VPS) doğal eşleşme

**Yapılmayan:** YAML config dosyası — overkill, single-developer projesi için.

---

## Karar verirken kullanılan zihniyet

Bu projede karar verirken sürekli sorduğumuz üç soru:

1. **"En basit ne yapar?"** — fancy mimari değil, çalışan basit kod
2. **"Defensive ne demek burada?"** — bir tarafı patlarsa diğeri devam etsin
   (try/catch per ticker, graceful telegram fallback, vs.)
3. **"Senior dev refleksi nedir?"** — `.d.ts` dosyasına bak, hata mesajını
   oku, tahmin yapma — gözle gör

Bu prensipler proje boyunca geri dönüyor. Yeni karar verirken sor.
