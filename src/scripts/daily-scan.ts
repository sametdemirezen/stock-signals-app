import "dotenv/config";
import { buildScanList } from "../mastra/lib/build-scan-list";
import { mastra } from "../mastra";
import { newsSentimentSchema } from "../mastra/agents/news-sentiment-agent";
import { technicalAnalysisSchema } from "../mastra/agents/technical-analyst-agent";
import { earningsAnalysisSchema } from "../mastra/agents/earnings-analyst-agent";
import {
  finalSignalSchema,
  type FinalSignal,
} from "../mastra/agents/synthesizer-agent";
import { sendTelegram } from "../mastra/lib/telegram";
import {
  formatSignalForTelegram,
  formatHeaderMessage,
} from "../mastra/lib/format-signal";

const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 25_000;
const MIN_CONFLUENCE_SCORE = 65;

async function analyzeTicker(ticker: string): Promise<FinalSignal | null> {
  try {
    const newsAgent = mastra.getAgent("newsSentimentAgent");
    const techAgent = mastra.getAgent("technicalAnalystAgent");
    const earningsAgent = mastra.getAgent("earningsAnalystAgent");
    const synthAgent = mastra.getAgent("synthesizerAgent");

    // All three data agents are independent — run in parallel.
    const [newsResult, techResult, earningsResult] = await Promise.all([
      newsAgent.generate(
        `Analyze the news sentiment for ${ticker}. Use the get-stock-news tool, then return the structured assessment.`,
        { structuredOutput: { schema: newsSentimentSchema } },
      ),
      techAgent.generate(
        `Analyze the technical setup for ${ticker} using the get-technical-analysis tool, then return the structured assessment.`,
        { structuredOutput: { schema: technicalAnalysisSchema } },
      ),
      earningsAgent.generate(
        `Analyze the earnings situation for ${ticker}. Use the get-earnings-data tool, then return the structured assessment.`,
        { structuredOutput: { schema: earningsAnalysisSchema } },
      ),
    ]);

    // Bundle all three outputs for the synthesizer.
    const payload = JSON.stringify(
      {
        sentiment: newsResult.object,
        technical: techResult.object,
        earnings: earningsResult.object,
      },
      null,
      2,
    );

    const synthResult = await synthAgent.generate(
      `Combine these three analyses into a final trade decision:\n\n${payload}`,
      { structuredOutput: { schema: finalSignalSchema } },
    );

    // Compute mean confidence from directional sub-agents.
    // "Directional" means the agent is not neutral / not_applicable.
    const confidenceValues: number[] = [];
    if (newsResult.object.sentiment !== "neutral") {
      confidenceValues.push(newsResult.object.confidence);
    }
    if (techResult.object.setup !== "neutral") {
      confidenceValues.push(techResult.object.score);
    }

    const meanConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
        : 0;
    const alignment = computeAlignment(
      newsResult.object.sentiment,
      techResult.object.setup,
    );

    console.log(`  action: ${synthResult.object.action}`);
    console.log(`  mean confidence (computed): ${meanConfidence.toFixed(1)}`);
    console.log(
      `  LLM confluence (will be overwritten): ${synthResult.object.confluenceScore}`,
    );

    const enforced = enforceTradeRules(
      synthResult.object,
      alignment,
      meanConfidence,
      earningsResult.object.earningsWindow,
      earningsResult.object.qualityScore,
    );
    return enforced;
  } catch (err) {
    console.error(`  ✗ ${ticker} failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Compute alignment deterministically from news + technical directions.
 *
 * Earnings is deliberately EXCLUDED here — it is not a directional
 * signal. Earnings affects the decision only as a timing veto and a
 * quality adjustment (applied separately in enforceTradeRules).
 *
 * Treating earnings "pre-earnings setup" as a third directional vote
 * over-weighted it: past beat history doesn't predict next-quarter
 * direction (the market has already priced it). So alignment rests on
 * the two genuinely directional agents: news and technical.
 */
type TwoWayAlignment =
  | "both_aligned"
  | "one_directional"
  | "both_neutral"
  | "conflicting";

function computeAlignment(
  newsSentiment: "bullish" | "bearish" | "neutral",
  techSetup: "bullish" | "bearish" | "neutral",
): TwoWayAlignment {
  const directions = [newsSentiment, techSetup].filter((d) => d !== "neutral");

  if (directions.length === 0) return "both_neutral";
  if (directions.length === 1) return "one_directional";

  // Both directional — same way or opposed?
  return directions[0] === directions[1] ? "both_aligned" : "conflicting";
}

/**
 * Compute confluence score deterministically.
 *
 * Two inputs:
 *   - alignment: categorical decision by the LLM (which it does reliably)
 *   - meanConfidence: numeric average computed from sub-agent outputs
 *
 * The confidence band (strong/moderate/weak) is derived in code from
 * meanConfidence, NOT by the LLM. Same inputs always produce the same
 * score, run to run.
 */
/**
 * Confluence score from two-way alignment + mean confidence.
 * Lookup table tuned so MIN_CONFLUENCE_SCORE=65 admits:
 *   - both_aligned + strong/moderate
 * and rejects single-agent or conflicting setups.
 */
function computeConfluenceScore(
  alignment: TwoWayAlignment,
  meanConfidence: number,
): number {
  const band: "strong" | "moderate" | "weak" =
    meanConfidence > 70 ? "strong" : meanConfidence >= 50 ? "moderate" : "weak";

  const table: Record<TwoWayAlignment, Record<typeof band, number>> = {
    both_aligned: { strong: 90, moderate: 72, weak: 55 },
    one_directional: { strong: 50, moderate: 40, weak: 30 },
    both_neutral: { strong: 25, moderate: 20, weak: 15 },
    conflicting: { strong: 20, moderate: 15, weak: 10 },
  };

  return table[alignment][band];
}

/**
 * Post-process the synthesizer's output to enforce deterministic rules.
 *
 * The LLM is good at qualitative reasoning but unreliable at arithmetic.
 * Recompute the risk/reward ratio in code and force NO_TRADE if it falls
 * below threshold. This catches cases where the LLM produced a "BUY with
 * R:R 2.0" decision but the actual math says R:R was 0.5.
 */
function enforceTradeRules(
  signal: FinalSignal,
  alignment: TwoWayAlignment,
  meanConfidence: number,
  earningsWindow: string,
  earningsQualityScore: number,
): FinalSignal {
  // 1. Earnings timing veto — imminent earnings kills new positions.
  if (earningsWindow === "imminent") {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis + " [NO_TRADE: earnings imminent, gap risk too high.]",
      entry: null,
      stopLoss: null,
      target: null,
      riskRewardRatio: null,
      horizon: null,
      confluenceScore: computeConfluenceScore(alignment, meanConfidence),
    };
  }
  // 2. Confluence from code, with earnings quality adjustment.
  let confluence = computeConfluenceScore(alignment, meanConfidence);
  if (earningsQualityScore < 40) confluence -= 10;
  else if (earningsQualityScore >= 80) confluence += 5;
  signal = { ...signal, confluenceScore: confluence };

  // (geri kalan: NO_TRADE check, entry/stop validation, target hesabı — AYNEN KALIYOR)
  if (signal.action === "NO_TRADE") {
    return signal;
  }

  const { entry, stopLoss } = signal;

  // Entry and stop are required. Target is computed below, so we don't
  // require it from the LLM anymore.
  if (entry === null || stopLoss === null) {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis +
        " [Auto-downgraded to NO_TRADE: missing entry or stop.]",
      entry: null,
      stopLoss: null,
      target: null,
      riskRewardRatio: null,
      horizon: null,
    };
  }

  // Compute risk from entry and stop based on direction.
  const risk = signal.action === "BUY" ? entry - stopLoss : stopLoss - entry;

  // Risk must be positive — otherwise geometry is invalid.
  if (risk <= 0) {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis +
        " [Auto-downgraded to NO_TRADE: invalid trade geometry.]",
      entry: null,
      stopLoss: null,
      target: null,
      riskRewardRatio: null,
      horizon: null,
    };
  }

  // Compute target deterministically: 2R from entry.
  // This GUARANTEES R:R = 2.0 — no LLM arithmetic involved.
  const target = signal.action === "BUY" ? entry + 2 * risk : entry - 2 * risk;

  // Compute R:R deterministically based on direction.
  // BUY: profit when price goes up (target > entry > stop)
  // SELL: profit when price goes down (target < entry < stop)
  const reward = signal.action === "BUY" ? target - entry : entry - target;

  // Sanity check: reward must be positive and non-zero.
  // If not, the trade plan is geometrically invalid.
  if (reward <= 0) {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis +
        " [Auto-downgraded to NO_TRADE: invalid trade geometry.]",
      riskRewardRatio: null,
    };
  }

  const computedRR = reward / risk;

  // Apply the hard rule: R:R < 1.5 means the trade isn't worth taking.
  if (computedRR < 1.5) {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis +
        ` [Auto-downgraded to NO_TRADE: R:R ${computedRR.toFixed(2)} < 1.5.]`,
      riskRewardRatio: computedRR,
    };
  }

  // Trade is valid. Replace whatever R:R the LLM returned with the
  // computed value — even if rounded similarly, the LLM might have
  // had it slightly wrong.
  return {
    ...signal,
    target,
    riskRewardRatio: computedRR,
  };
}

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log("   DAILY MARKET SCAN");
  console.log("══════════════════════════════════════════\n");

  // === MODE: pick one, comment the other ===
  //const scanList = await buildScanList({ scannerTopN: 15 }); // FULL: watchlist + S&P 500 scanner (~10 min)
  const scanList = await buildScanList({ skipScanner: true }); // FAST: watchlist only (~3-4 min)
  //&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&TESTING SLICE &&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&
  const tickers = scanList.combined;
  // Test mode: only run on the first 4 tickers (2 batches x 2 = ~2 min total).
  // Remove this slice for full daily runs.
  //const tickers = scanList.combined.slice(0, 4);

  console.log(
    `\nAnalyzing ${tickers.length} tickers in batches of ${BATCH_SIZE}...\n`,
  );

  const allSignals: FinalSignal[] = [];
  const t0 = Date.now();

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tickers.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);
    const batchStart = Date.now();

    const results = await Promise.all(batch.map((t) => analyzeTicker(t)));
    for (const r of results) {
      if (r !== null) allSignals.push(r);
    }

    const batchSecs = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`  done in ${batchSecs}s`);

    if (i + BATCH_SIZE < tickers.length) {
      console.log(
        `  waiting ${BATCH_DELAY_MS / 1000}s for rate limit window...`,
      );
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nAll batches done in ${totalSecs}s.`);

  const actionable = allSignals
    .filter(
      (s) =>
        s.action !== "NO_TRADE" && s.confluenceScore >= MIN_CONFLUENCE_SCORE,
    )
    .sort((a, b) => b.confluenceScore - a.confluenceScore);

  console.log("\n══════════════════════════════════════════");
  console.log(`   REPORT — ${actionable.length} actionable signals`);
  console.log(`   (out of ${allSignals.length} analyzed)`);
  console.log("══════════════════════════════════════════\n");

  for (const sig of actionable) {
    const emoji = sig.action === "BUY" ? "🟢" : "🔴";
    console.log(
      `${emoji}  ${sig.ticker}  →  ${sig.action}  (confluence ${sig.confluenceScore})`,
    );
    console.log(`   ${sig.thesis}`);
    if (sig.entry !== null && sig.stopLoss !== null && sig.target !== null) {
      console.log(
        `   Entry: ${sig.entry.toFixed(2)}  Stop: ${sig.stopLoss.toFixed(2)}  Target: ${sig.target.toFixed(2)}` +
          (sig.riskRewardRatio !== null
            ? `  R:R ${sig.riskRewardRatio.toFixed(1)}`
            : ""),
      );
    }
    if (sig.keyRisks.length > 0) {
      console.log(`   Risks: ${sig.keyRisks.slice(0, 2).join("; ")}`);
    }
    console.log();
  }

  // ───────── Telegram delivery ─────────
  console.log("Sending to Telegram...");

  await sendTelegram(
    formatHeaderMessage({
      totalAnalyzed: allSignals.length,
      actionableCount: actionable.length,
    }),
  );

  for (const sig of actionable) {
    await sendTelegram(formatSignalForTelegram(sig));
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("✓ Telegram delivery complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
