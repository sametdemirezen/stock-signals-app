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
    if (
      earningsResult.object.preEarningsSetup !== "neutral" &&
      earningsResult.object.preEarningsSetup !== "not_applicable"
    ) {
      confidenceValues.push(earningsResult.object.qualityScore);
    }
    const meanConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
        : 0;

    console.log(`\n[DEBUG ${ticker}] Synthesizer raw output:`);
    console.log(`  action: ${synthResult.object.action}`);
    console.log(`  alignment: ${synthResult.object.agentAlignment}`);
    console.log(`  mean confidence (computed): ${meanConfidence.toFixed(1)}`);
    console.log(
      `  LLM confluence (will be overwritten): ${synthResult.object.confluenceScore}`,
    );
    console.log(`  entry: ${synthResult.object.entry}`);
    console.log(`  stopLoss: ${synthResult.object.stopLoss}`);
    console.log(`  target: ${synthResult.object.target}`);
    console.log(`  R:R (LLM): ${synthResult.object.riskRewardRatio}`);
    const enforced = enforceTradeRules(synthResult.object, meanConfidence);
    console.log(
      `  → after enforce: ${enforced.action}, confluence: ${enforced.confluenceScore}, R:R: ${enforced.riskRewardRatio}`,
    );
    return enforced;
  } catch (err) {
    console.error(`  ✗ ${ticker} failed:`, (err as Error).message);
    return null;
  }
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
function computeConfluenceScore(
  alignment: FinalSignal["agentAlignment"],
  meanConfidence: number,
): number {
  const confidence: "strong" | "moderate" | "weak" =
    meanConfidence > 70 ? "strong" : meanConfidence >= 50 ? "moderate" : "weak";

  const table: Record<
    FinalSignal["agentAlignment"],
    Record<"strong" | "moderate" | "weak", number>
  > = {
    all_three_aligned: { strong: 90, moderate: 75, weak: 60 },
    two_directional_one_neutral: { strong: 75, moderate: 65, weak: 50 },
    one_directional_two_neutral: { strong: 50, moderate: 40, weak: 30 },
    all_neutral: { strong: 35, moderate: 30, weak: 25 },
    mixed_conflicting: { strong: 20, moderate: 15, weak: 10 },
  };

  return table[alignment][confidence];
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
  meanConfidence: number,
): FinalSignal {
  // Recompute confluence deterministically.
  const computedConfluence = computeConfluenceScore(
    signal.agentAlignment,
    meanConfidence,
  );
  signal = { ...signal, confluenceScore: computedConfluence };
  // Only need post-processing for actionable signals.
  // NO_TRADE doesn't have entry/stop/target to validate.
  if (signal.action === "NO_TRADE") {
    return signal;
  }

  const { entry, stopLoss, target } = signal;

  // If any of the three is missing, we can't compute R:R — kill the trade.
  if (entry === null || stopLoss === null || target === null) {
    return {
      ...signal,
      action: "NO_TRADE",
      thesis:
        signal.thesis +
        " [Auto-downgraded to NO_TRADE: incomplete trade plan.]",
      entry: null,
      stopLoss: null,
      target: null,
      riskRewardRatio: null,
      horizon: null,
    };
  }

  // Compute R:R deterministically based on direction.
  // BUY: profit when price goes up (target > entry > stop)
  // SELL: profit when price goes down (target < entry < stop)
  const reward = signal.action === "BUY" ? target - entry : entry - target;
  const risk = signal.action === "BUY" ? entry - stopLoss : stopLoss - entry;

  // Sanity check: risk must be positive and non-zero.
  // If not, the trade plan is geometrically invalid.
  if (risk <= 0 || reward <= 0) {
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
    riskRewardRatio: computedRR,
  };
}

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log("   DAILY MARKET SCAN");
  console.log("══════════════════════════════════════════\n");

  // === MODE: pick one, comment the other ===
  //const scanList = await buildScanList({ scannerTopN: 15 });           // FULL: watchlist + S&P 500 scanner (~10 min)
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
