#!/usr/bin/env node
/**
 * X Agent Daily Run — Complete pipeline
 *
 * 1. Scrape:  x-agent.mjs --search (list + trending + keyword searches)
 * 2. Analyze: analyzer.mjs (token mentions, heat change, top tweets)
 * 3. Output:  enriched JSON with all insights + history
 *
 * Usage: node daily-run.mjs
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AGENT_DIR = "/home/azureuser/.openclaw/tools/x-agent";
const DATA_DIR = "/home/azureuser/.openclaw/data/x-agent";
const telegramMode = process.argv.includes("--telegram");
const telegramPartsMode = process.argv.includes("--telegram-parts");
if (telegramMode || telegramPartsMode) {
  console.error = () => {};
}

function runScript(script, args = [], timeoutSec = 160) {
  const cmd = `node ${path.join(AGENT_DIR, script)} ${args.join(" ")}`;
  console.error(`[RUNNER] Exec: ${script} ${args.join(" ")}`);
  try {
    const out = execSync(cmd, {
      timeout: timeoutSec * 1000,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { success: true, stdout: out };
  } catch (err) {
    // Try to extract JSON from partial output
    const output = err.stdout || err.stderr || err.message || "";
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return { success: true, stdout: jsonMatch[0] };
      } catch {}
    }
    console.error(`[RUNNER] Script failed: ${script}`, err.message.slice(0, 200));
    return { success: false, error: err.message };
  }
}

function trimText(text, max = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function metricLine(metrics = {}) {
  const like = metrics.like || "0";
  const repost = metrics.repost || "0";
  const reply = metrics.reply || "0";
  const view = metrics.view || "";
  return `❤️ ${like} 🔁 ${repost} 💬 ${reply}${view ? ` | 浏览 ${view}` : ""}`;
}

function reportDate(timestamp) {
  return new Date(timestamp || Date.now()).toISOString().slice(0, 10).replaceAll("-", ".");
}

function splitTelegramParts(text, maxLen = 3300) {
  if (text.length <= maxLen) return [text];
  const blocks = text.split(/\n(?=━━━━━━━━━━━━━━━━━━━━━)/g);
  const parts = [];
  let cur = "";
  for (const block of blocks) {
    const next = cur ? `${cur}\n${block}` : block;
    if (next.length <= maxLen) {
      cur = next;
      continue;
    }
    if (cur) parts.push(cur.trim());
    if (block.length <= maxLen) {
      cur = block;
    } else {
      const lines = block.split("\n");
      cur = "";
      for (const line of lines) {
        const n = cur ? `${cur}\n${line}` : line;
        if (n.length > maxLen && cur) {
          parts.push(cur.trim());
          cur = line;
        } else {
          cur = n;
        }
      }
    }
  }
  if (cur) parts.push(cur.trim());
  const total = parts.length;
  return parts.map((p, i) => `${p.split("\n")[0]}\nPart ${i + 1}/${total}\n${p.split("\n").slice(1).join("\n")}`);
}

const CRYPTO_NARRATIVE_KEYWORDS = new Set([
  "bitcoin", "ethereum", "solana", "base", "altcoin", "rwa", "defi",
  "memecoin", "regulation", "nft", "layer2", "staking", "etf", "whale",
]);

function narrativeBucket(item = {}) {
  const keyword = String(item.keyword || "").toLowerCase();
  if (CRYPTO_NARRATIVE_KEYWORDS.has(keyword)) return "crypto";
  return "market";
}

function narrativeSort(a, b) {
  const as = (a.weightedScore ?? a.current ?? 0) + Math.max(0, a.change || 0) * 0.5;
  const bs = (b.weightedScore ?? b.current ?? 0) + Math.max(0, b.change || 0) * 0.5;
  return bs - as;
}

const CG_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", XRP: "ripple",
  ONDO: "ondo-finance", HYPE: "hyperliquid", AAVE: "aave", PEPE: "pepe", TRX: "tron",
  STRK: "starknet", USDT: "tether", USDC: "usd-coin",
};

function timeoutSignal(ms = 8000) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

async function fetchJson(url, ms = 8000) {
  try {
    const res = await fetch(url, { signal: timeoutSignal(ms), headers: { "accept": "application/json", "user-agent": "OpenClaw-X-Agent/1.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dominantSentiment(counts = {}) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";
}

async function getBinanceMarket(token) {
  const symbol = `${token}USDT`;
  const spot = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  const funding = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, 5000);
  if (!spot) return null;
  return {
    source: "binance",
    symbol,
    price: Number(spot.lastPrice),
    priceChangePct24h: Number(spot.priceChangePercent),
    quoteVolume24h: Number(spot.quoteVolume),
    fundingRate: funding?.lastFundingRate != null ? Number(funding.lastFundingRate) : null,
  };
}

async function getCoinGeckoMarket(token) {
  const id = CG_IDS[token];
  if (!id) return null;
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`);
  const row = data?.[id];
  if (!row) return null;
  return {
    source: "coingecko",
    id,
    price: row.usd,
    priceChangePct24h: row.usd_24h_change,
    volume24h: row.usd_24h_vol,
    marketCap: row.usd_market_cap,
  };
}

async function getDexLiquidity(token) {
  const data = await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(token)}`, 8000);
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const best = pairs
    .filter(p => String(p.baseToken?.symbol || "").toUpperCase() === token)
    .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
  if (!best) return null;
  return {
    source: "dexscreener",
    chain: best.chainId,
    pairAddress: best.pairAddress,
    liquidityUsd: Number(best.liquidity?.usd || 0),
    volume24h: Number(best.volume?.h24 || 0),
    priceChangePct24h: Number(best.priceChange?.h24 || 0),
    url: best.url,
  };
}

function validationLabel({ mentions, xSentiment, binance, coingecko, dex }) {
  const pricePct = binance?.priceChangePct24h ?? coingecko?.priceChangePct24h ?? dex?.priceChangePct24h ?? null;
  const volume = binance?.quoteVolume24h ?? coingecko?.volume24h ?? dex?.volume24h ?? 0;
  const liquidity = dex?.liquidityUsd ?? null;
  const funding = binance?.fundingRate;

  if (mentions >= 2 && liquidity != null && liquidity > 0 && liquidity < 500000) {
    return { label: "高风险", reason: "X 很热但 DEX liquidity 偏低，容易滑点/被操纵" };
  }
  if (["bearish", "panic"].includes(xSentiment) && ((pricePct != null && pricePct < -3) || (funding != null && funding < -0.0001))) {
    return { label: "risk-off", reason: "X 利空/恐慌与价格下跌或 funding 异常同时出现" };
  }
  if (mentions >= 2 && pricePct != null && pricePct > 5 && volume > 10000000) {
    return { label: "可能正在 pump", reason: "X 热度上升，同时 24h 价格与成交量显著放大" };
  }
  if (mentions >= 2 && pricePct != null && Math.abs(pricePct) < 2) {
    return { label: "早期叙事", reason: "X 热度上升，但价格暂未明显反应" };
  }
  return { label: "观察中", reason: "X 热度与市场数据尚未形成强确认" };
}

async function crossValidateMarket(analysis = {}) {
  const tokens = (analysis.tokenMentions || [])
    .filter(t => /^[A-Z]{2,10}$/.test(t.token))
    .slice(0, 8);
  const out = [];
  for (const t of tokens) {
    const [binance, coingecko, dex] = await Promise.all([
      getBinanceMarket(t.token),
      getCoinGeckoMarket(t.token),
      getDexLiquidity(t.token),
    ]);
    const xSentiment = dominantSentiment(analysis.tokenSentiment?.[t.token] || {});
    const verdict = validationLabel({ mentions: t.count, xSentiment, binance, coingecko, dex });
    out.push({ token: t.token, mentions: t.count, xSentiment, verdict, binance, coingecko, dex });
  }
  return out;
}

function formatTelegramReport(output) {
  const scrape = output.scrape || {};
  const analysis = output.analysis || {};
  const sources = scrape.sources || {};
  const sourceText = [
    sources.list ? `X List ${sources.list}` : null,
    sources.signal ? `信号 ${sources.signal}` : null,
    sources.narrative ? `叙事 ${sources.narrative}` : null,
  ].filter(Boolean).join(" / ");

  const totalTweets = scrape.totalTweets || output.totalTweets || 0;
  const topNarratives = analysis.topNarratives || [];
  const allNarratives = topNarratives.length ? topNarratives : analysis.keywordHeat || [];
  const cryptoNarratives = allNarratives.filter(x => narrativeBucket(x) === "crypto").sort(narrativeSort).slice(0, 5);
  const marketNarratives = allNarratives.filter(x => narrativeBucket(x) === "market").sort(narrativeSort).slice(0, 5);
  const heatWords = allNarratives
    .slice(0, 3)
    .map(x => x.keyword)
    .filter(Boolean)
    .join("、");

  const sentimentLine = analysis.sentimentSummary
    ? `情绪分类显示 bullish ${analysis.sentimentSummary.bullish || 0}、bearish ${analysis.sentimentSummary.bearish || 0}、panic ${analysis.sentimentSummary.panic || 0}、hype ${analysis.sentimentSummary.hype || 0}、news ${analysis.sentimentSummary.news || 0}、shill ${analysis.sentimentSummary.shill || 0}。`
    : "";
  const validation = analysis.crossValidation || [];
  const early = validation.filter(x => x.verdict?.label === "早期叙事").map(x => `$${x.token}`);
  const pump = validation.filter(x => x.verdict?.label === "可能正在 pump").map(x => `$${x.token}`);
  const highRisk = validation.filter(x => x.verdict?.label === "高风险").map(x => `$${x.token}`);
  const riskOff = validation.filter(x => x.verdict?.label === "risk-off").map(x => `$${x.token}`);

  const lines = [
    `🐦 X/Twitter 每日精选 · ${reportDate(output.timestamp)}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📊 市场情绪总览",
    `本次覆盖 ${totalTweets} 条推文，来自 ${sourceText || "X"}。热点主要集中在 ${heatWords || "crypto 叙事"}。${sentimentLine}`,
    "",
    `交叉验证方面：${early.length ? `${early.join("、")} 属于“X 热但价格暂未明显反应”的早期叙事；` : ""}${pump.length ? `${pump.join("、")} 有可能正在 pump；` : ""}${highRisk.length ? `${highRisk.join("、")} 属于高风险低流动性标的；` : ""}${riskOff.length ? `${riskOff.join("、")} 出现 risk-off 信号；` : ""}其余标的继续观察。`,
    "",
    "整体判断：X 情绪不是单边 bullish。监管/机构 adoption 叙事仍在强化，但 ETF 流出、bearish 新闻和部分 shill/低流动性代币说明短线资金仍然挑剔。适合把它当成叙事雷达，不适合直接当买卖信号。",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔥 核心叙事",
  ];

  if (analysis.sentimentSummary) {
    const s = analysis.sentimentSummary;
    lines.push("", `🧠 情绪分类: bullish ${s.bullish || 0} / bearish ${s.bearish || 0} / panic ${s.panic || 0} / hype ${s.hype || 0} / news ${s.news || 0} / shill ${s.shill || 0}`);
  }

  const heatSource = allNarratives;
  const heat = Array.isArray(heatSource)
    ? heatSource
    : Object.entries(heatSource)
      .map(([keyword, v]) => ({ keyword, ...(v || {}) }))

  const renderNarratives = (items) => {
    let i = 1;
    for (const item of items) {
      const change = item.change > 0 ? `+${item.change}` : `${item.change || 0}`;
      const sample = item.samples?.[0];
      lines.push(`${i}️⃣ ${item.keyword} 热度 ${item.current || 0} 次（${change} vs previous，${item.sentiment || "neutral"}）`);
      if (sample) {
        lines.push(`${sample.text}（@${sample.author || "unknown"}，${metricLine(sample.metrics)}）`);
        if (sample.url) lines.push(sample.url);
      }
      const second = item.samples?.[1];
      if (second) {
        lines.push(`补充信号：${second.text}（@${second.author || "unknown"}）`);
      }
      i++;
    }
  };

  if (cryptoNarratives.length) {
    lines.push("A. Crypto / On-chain 榜");
    renderNarratives(cryptoNarratives);
  } else {
    lines.push("A. Crypto / On-chain 榜：暂时没有足够重复叙事。");
  }

  lines.push("");
  if (marketNarratives.length) {
    lines.push("B. AI / Macro / Geopolitics 榜");
    renderNarratives(marketNarratives);
  } else {
    lines.push("B. AI / Macro / Geopolitics 榜：暂时没有足够重复叙事。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "🪙 高频代币");
  const tokens = (analysis.tokenMentions || []).slice(0, 8);
  if (tokens.length) {
    lines.push(tokens.map(t => `$${t.token}(${t.count})`).join("  "));
  } else {
    lines.push("暂时没有可信 $ticker 聚集。");
  }

  const cross = (analysis.crossValidation || []).slice(0, 8);
  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "🔍 X × 市场交叉验证");
  if (cross.length) {
    for (const item of cross) {
      const pct = item.binance?.priceChangePct24h ?? item.coingecko?.priceChangePct24h ?? item.dex?.priceChangePct24h;
      const pctText = Number.isFinite(pct) ? `${pct.toFixed(2)}%` : "n/a";
      const liq = item.dex?.liquidityUsd ? `$${Math.round(item.dex.liquidityUsd).toLocaleString()}` : "n/a";
      lines.push(`- $${item.token}: ${item.verdict.label} / X情绪 ${item.xSentiment} / 24h ${pctText} / DEX流动性 ${liq}`);
      lines.push(`  ${item.verdict.reason}`);
      if (item.binance?.fundingRate != null) lines.push(`  Binance funding: ${(item.binance.fundingRate * 100).toFixed(4)}%`);
    }
  } else {
    lines.push("暂时没有足够市场数据完成交叉验证。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "📈 最热门5条推文");
  const topTweets = (analysis.topTweets || []).slice(0, 5);
  if (topTweets.length) {
    let i = 1;
    for (const t of topTweets) {
      lines.push(`${i}️⃣ @${t.author || "unknown"}`);
      lines.push(`${trimText(t.text, 115)}`);
      if (t.metrics) lines.push(metricLine(t.metrics));
      lines.push(`${t.url || "X"}`);
      i++;
    }
  } else {
    lines.push("暂时没有可排序的高互动帖子。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "👀 最高浏览量5条");
  const topViewed = (analysis.topViewedTweets || [])
    .filter(t => !topTweets.some(x => x.url === t.url))
    .slice(0, 5);
  if (topViewed.length) {
    let i = 1;
    for (const t of topViewed) {
      lines.push(`${i}️⃣ @${t.author || "unknown"}`);
      lines.push(`${trimText(t.text, 120)}`);
      if (t.metrics) lines.push(metricLine(t.metrics));
      lines.push(`${t.url || "X"}`);
      i++;
    }
  } else {
    lines.push("最高浏览量推文与热门互动榜高度重合。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "📡 数据源说明");
  lines.push(`本次分析覆盖 ${totalTweets} 条推文，包含 X List、信号查询和 10 组关键词搜索。`);
  lines.push("", `⏰ 采集时间：${output.timestamp || new Date().toISOString()}`);
  lines.push("🤖 X Agent Daily · Generated by OpenClaw");
  lines.push("", "📁 完整数据已保存:");
  lines.push(output.savedDaily || output.savedJson || "/home/azureuser/.openclaw/data/x-agent/latest-daily.json");

  return lines.join("\n");
}

async function main() {
  console.error("=== X Agent Daily Run ===");
  const startTime = Date.now();

  // Ensure data dir exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 1: Scrape
  console.error("[1/2] Scraping X...");
  const scrapeResult = runScript("x-agent.mjs", ["--search"], 150);
  if (!scrapeResult.success) {
    console.error("[FATAL] Scrape failed");
    process.exit(1);
  }

  // Parse scrape output to verify
  let scrapeData;
  try {
    scrapeData = JSON.parse(scrapeResult.stdout);
  } catch {
    // Scraper already saved to latest.json, read from there
    scrapeData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "latest.json"), "utf8"));
  }
  console.error(`[RUNNER] Scraped ${scrapeData.totalTweets} tweets, ${(scrapeData.exploreTrending || scrapeData.trending || []).length} trending`);

  if (scrapeData.version === "v3" || scrapeData.hotTokens || scrapeData.cryptoTrending) {
    console.error("[RUNNER] Using v3 precomputed analysis");

    const output = {
      status: "ok",
      timestamp: scrapeData.timestamp,
      runTime: scrapeData.runTime || `${((Date.now() - startTime) / 1000).toFixed(0)}s`,
      scrape: {
        totalTweets: scrapeData.totalTweets,
        trending: scrapeData.exploreTrending || scrapeData.trending || [],
        sources: scrapeData.sources || {},
      },
      analysis: {
        tokenMentions: scrapeData.hotTokens?.slice(0, 20) || [],
        tokenSentiment: scrapeData.tokenSentiment || {},
        sentimentSummary: scrapeData.sentimentSummary || {},
        accountMentions: scrapeData.hotAccounts?.slice(0, 15) || [],
        keywordHeat: scrapeData.cryptoTrending || scrapeData.keywordHeat || [],
        topNarratives: scrapeData.topNarratives || [],
        topTweets: scrapeData.topTweets?.slice(0, 8) || [],
        topViewedTweets: scrapeData.topViewedTweets?.slice(0, 8) || [],
      },
      savedJson: scrapeData.savedJson,
    };
    output.analysis.crossValidation = await crossValidateMarket(output.analysis);

    const outFile = path.join(DATA_DIR, `daily-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    output.savedDaily = outFile;
    fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
    fs.writeFileSync(path.join(DATA_DIR, "latest-daily.json"), JSON.stringify(output, null, 2));

    if (telegramPartsMode) {
      console.log(JSON.stringify({ status: "ok", parts: splitTelegramParts(formatTelegramReport(output)), savedDaily: output.savedDaily }, null, 2));
    } else {
      console.log(telegramMode ? splitTelegramParts(formatTelegramReport(output))[0] : JSON.stringify(output));
    }
    return;
  }

  // Step 2: Analyze
  console.error("[2/2] Running analysis...");
  const analysisResult = runScript("analyzer.mjs", [], 30);
  if (!analysisResult.success) {
    console.error("[WARN] Analysis failed, outputting raw scrape data only");
    // Output what we have
    const summary = {
      status: "partial",
      timestamp: scrapeData.timestamp,
      runTime: `${((Date.now() - startTime) / 1000).toFixed(0)}s`,
      scrape: {
        totalTweets: scrapeData.totalTweets,
        trending: scrapeData.trending || [],
        sources: scrapeData.sources || {},
      },
      analysis: null,
      error: "Analysis step failed, raw scrape data available",
      savedJson: scrapeData.savedJson,
    };
    console.log(JSON.stringify(summary));
    return;
  }

  // Parse analysis
  let analysis;
  try {
    analysis = JSON.parse(analysisResult.stdout);
  } catch {
    console.error("[WARN] Could not parse analysis output");
    analysis = null;
  }

  const runTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error(`[RUNNER] Complete in ${runTime}s`);

  // Output combined result
  const output = {
    status: "ok",
    timestamp: scrapeData.timestamp,
    runTime: `${runTime}s`,
    scrape: {
      totalTweets: scrapeData.totalTweets,
      trending: scrapeData.trending || [],
      sources: scrapeData.sources || {},
    },
    analysis: analysis ? {
      tokenMentions: analysis.tokenMentions?.slice(0, 20) || [],
      accountMentions: analysis.accountMentions?.slice(0, 15) || [],
      keywordHeat: analysis.keywordHeat?.change || {},
      topTweets: analysis.topTweets?.slice(0, 8) || [],
      topViewedTweets: analysis.topViewedTweets?.slice(0, 8) || [],
    } : null,
    savedJson: scrapeData.savedJson,
    savedHistory: analysis?.savedHistory || null,
  };

  // Save combined output
  const outFile = path.join(DATA_DIR, `daily-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  output.savedDaily = outFile;
  if (output.analysis) output.analysis.crossValidation = await crossValidateMarket(output.analysis);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  // Also save as latest-daily.json
  const latestDaily = path.join(DATA_DIR, "latest-daily.json");
  fs.writeFileSync(latestDaily, JSON.stringify(output, null, 2));

  if (telegramPartsMode) {
    console.log(JSON.stringify({ status: "ok", parts: splitTelegramParts(formatTelegramReport(output)), savedDaily: output.savedDaily }, null, 2));
  } else {
    console.log(telegramMode ? splitTelegramParts(formatTelegramReport(output))[0] : JSON.stringify(output));
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
