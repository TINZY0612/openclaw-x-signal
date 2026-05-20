#!/usr/bin/env node
/**
 * X Agent Analyzer — Post-scrape analysis:
 *   - $TOKEN mention extraction & ranking
 *   - Keyword heat change vs previous day
 *   - Most-engaged tweets ranking
 *   - Mentioned @accounts tracking
 *
 * Usage:
 *   node analyzer.mjs [--input path/to/data.json]
 *                     [--history path/to/history/dir]
 */

import fs from "node:fs";
import path from "node:path";

// --- Common words that look like tokens but aren't ---
const STOP_TOKENS = new Set([
  "THE","FOR","AND","NOT","YOU","CAN","ALL","ARE","BUT","HAS","WAS",
  "THIS","THAT","WITH","FROM","HAVE","BEEN","WILL","WHAT","WHEN",
  "THAN","YOUR","ITS","HERE","THERE","MORE","ALSO","SOME","EACH",
  "VERY","JUST","SHOW","DONE","NEW","NOW","ONE","OUT","HOW","WHY",
  "WHO","WHOM","WHICH","WHERE","BOTH","EVER","ANY","FEW","MANY",
  "SUCH","ONLY","OWN","SAME","SO","TOO","PER","VIA","UPON",
  "INTO","ONTO","OVER","UNDER","BEFORE","AFTER","BETWEEN","THROUGH",
  "WITHIN","WITHOUT","ACROSS","AROUND","BEHIND","BEYOND","INSIDE",
  "OUTSIDE","ALONG","BESIDE","UPPER","LOWER","ETF","USD","CEO",
  "APP","GAME","BIG","TOP","DAY","WEEK","MONTH","YEAR","AVE",
  "MIN","MAX","MID","HIGH","LOW","LONG","SHORT","REAL","TRUE",
  "SAFE","COLD","HOT","WARM","DARK","LIGHT","FAST","SLOW","HARD",
  "SOFT","DEEP","WIDE","NEAR","FAR","OPEN","CLOSED","FREE","PAID",
  "LIVE","DEAD","HALF","FULL","NEXT","LAST","PAST","FIRST","SECOND",
  "THIRD","LEFT","RIGHT","EAST","WEST","NORTH","SOUTH","BEST","WORST",
  "GOOD","BETTER","ABLE","NICE","KIND","SURE","CLEAR","EASY","SOON",
  "LATE","EARLY","MUCH","LESS","MOST","LEAST","NEVER","OFTEN","ALWAYS",
  "ABOUT","ABOVE","ACROSS","AFTER","ALONG","ALSO","AMONG","AROUND",
  "BEHIND","BELOW","BENEATH","BESIDE","BETWEEN","BEYOND","DURING",
  "EXCEPT","INSIDE","OUTSIDE","THROUGH","THROUGHOUT","TOWARD",
  "TOWARDS","UNDER","UNDERNEATH","UNLIKE","UNTIL","UPON","WITHIN",
  "WITHOUT","VIDEO","LOGO","SIGN","CODE","DATA","INFO","TEXT",
  "FILE","EDIT","VIEW","HELP","MENU","MODE","SITE","PAGE","POST",
  "LINK","LIST","NOTE","TASK","ICON","TAB","TAG","KEY","SET",
  "GET","PUT","RUN","LOG","MAP","NET","CPU","RAM","ROM","SQL",
  "PDF","HTML","CSS","HTTP","HTTPS","FTP","SSH","SSL","TLS",
  "API","URL","URI","JSON","XML","CSV","YAML","AAA","BBB","CCC",
  "DDD","EEE","FFF","GGG","HHH","III","JJJ","KKK","LLL","MMM",
  "NNN","OOO","PPP","QQQ","RRR","SSS","TTT","UUU","VVV","WWW",
  "XXX","YYY","ZZZ","COM","NET","ORG","INC","LTD","CO","DE","IO",
  "ME","TO","PM","AM","NEXT","THISLIST","YOURTIMELINE",
]);

// Keywords that we track heat for (maps to search queries)
const TRACKED_KEYWORDS = [
  "bitcoin", "ethereum", "solana", "ai agent", "base chain",
  "altcoin", "rwa", "defi", "memecoin", "regulation",
  "nft", "layer2", "staking",
];

function parseArgs() {
  const argv = process.argv;
  const input = argv.indexOf("--input") >= 0 ? argv[argv.indexOf("--input") + 1] : null;
  const historyDir = argv.indexOf("--history") >= 0 ? argv[argv.indexOf("--history") + 1] : "/home/azureuser/.openclaw/data/x-agent/history";
  return { input, historyDir };
}

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`[ANALYZER] Cannot read ${filePath}: ${e.message}`);
    return null;
  }
}

function isNumeric(str) {
  return /^\d+[\.\d]*$/.test(str) || /^\d+[\.\d]*(K|M|B)$/i.test(str);
}

function isDateLike(str) {
  return /^\d{1,4}([-\/]\d{1,4}){1,2}$/.test(str);
}

function isLikelyTickerNoise(t) {
  if (/^USD[A-Z0-9]{3,}$/.test(t) && !["USDC", "USDT", "USDD", "USDS", "USD1"].includes(t)) return true;
  if (t.length > 10) return true;
  if (/[0-9]/.test(t) && !["AAVE", "1INCH"].includes(t)) return true;
  return false;
}

// Extract $TOKEN mentions from text, filtering out false positives
function extractTokens(text) {
  if (!text) return [];
  const matches = text.match(/\$([A-Za-z0-9]+)/g);
  if (!matches) return [];

  return matches
    .map(m => m.slice(1).toUpperCase())
    .filter(t => {
      if (t.length < 2 || t.length > 15) return false;
      if (STOP_TOKENS.has(t)) return false;
      if (isNumeric(t)) return false;
      if (isDateLike(t)) return false;
      if (isLikelyTickerNoise(t)) return false;
      // Must contain at least one letter
      if (!/[A-Z]/.test(t)) return false;
      return true;
    });
}

// Extract @mentions from text
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@([A-Za-z0-9_]+)/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

// Calculate engagement score
function engagementScore(tweet) {
  const m = tweet.metrics || {};
  const parseMetric = (val) => {
    if (!val) return 0;
    if (typeof val === "number") return val;
    const s = String(val).replace(/,/g, "");
    if (s.includes("K")) return parseFloat(s) * 1000;
    if (s.includes("M")) return parseFloat(s) * 1000000;
    return parseInt(s, 10) || 0;
  };
  return parseMetric(m.like) + parseMetric(m.repost) * 2 + parseMetric(m.reply) * 3;
}

// Analyze a single data file
function analyze(data) {
  const result = {
    analyzedAt: new Date().toISOString(),
    dataTimestamp: data.timestamp,
    totalTweets: data.totalTweets || 0,
    tokenMentions: {},
    accountMentions: {},
    topTweets: [],
    keywordHeat: {},
    trendingTopics: data.trending || [],
    sourcesBreakdown: {},
  };

  // Count by source
  const sourceCounts = {};
  for (const t of data.tweets) {
    const src = (t.source || "unknown").split(":")[0];
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  result.sourcesBreakdown = sourceCounts;

  // Process each tweet
  const tweetsWithScore = [];
  for (const t of data.tweets) {
    const text = t.text || "";

    // Token mentions
    const tokens = extractTokens(text);
    for (const tok of tokens) {
      result.tokenMentions[tok] = (result.tokenMentions[tok] || 0) + 1;
    }

    // Account mentions
    const accounts = extractMentions(text);
    for (const acc of accounts) {
      if (acc === t.author?.toLowerCase()) continue; // skip self-mentions
      result.accountMentions[acc] = (result.accountMentions[acc] || 0) + 1;
    }

    // Track keywords in tweet text (for heat)
    const lowerText = text.toLowerCase();
    for (const kw of TRACKED_KEYWORDS) {
      if (lowerText.includes(kw)) {
        result.keywordHeat[kw] = (result.keywordHeat[kw] || 0) + 1;
      }
    }

    // Engagement score
    tweetsWithScore.push({ tweet: t, score: engagementScore(t) });
  }

  // Top tweets by engagement
  tweetsWithScore.sort((a, b) => b.score - a.score);
  result.topTweets = tweetsWithScore.slice(0, 10).map(t => ({
    url: t.tweet.url,
    author: t.tweet.author,
    text: t.tweet.text?.slice(0, 200),
    score: t.score,
    metrics: t.tweet.metrics,
  }));

  // Sort token mentions
  result.tokenMentions = Object.fromEntries(
    Object.entries(result.tokenMentions).sort((a, b) => b[1] - a[1])
  );

  // Sort account mentions
  result.accountMentions = Object.fromEntries(
    Object.entries(result.accountMentions).sort((a, b) => b[1] - a[1])
  );

  // Add keyword heat from sources too
  result.keywordHeat = Object.fromEntries(
    Object.entries(result.keywordHeat).sort((a, b) => b[1] - a[1])
  );

  return result;
}

// Load previous analysis for comparison
function loadPreviousAnalysis(historyDir) {
  try {
    if (!fs.existsSync(historyDir)) return null;
    const files = fs.readdirSync(historyDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const prev = loadJSON(path.join(historyDir, files[0]));
    return prev ? prev.analysis : null;
  } catch {
    return null;
  }
}

// Calculate keyword heat change
function computeHeatChange(current, previous) {
  if (!previous) return { change: {}, current };
  const result = {};
  const allKeys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  for (const key of allKeys) {
    const cur = current[key] || 0;
    const prev = previous[key] || 0;
    const diff = cur - prev;
    const pct = prev > 0 ? Math.round((diff / prev) * 100) : (cur > 0 ? 100 : 0);
    result[key] = { current: cur, previous: prev, change: diff, changePct: pct };
  }
  return { change: result, current };
}

// Save history
function saveAnalysis(analysisResult, historyDir) {
  fs.mkdirSync(historyDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(historyDir, `${date}.json`);

  // Merge with existing entry for same day
  let existing = {};
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  }

  const combined = {
    ...existing,
    timestamp: analysisResult.dataTimestamp,
    analysis: analysisResult,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(combined, null, 2));

  // Also save latest for easy reference
  // Trim history to last 14 days
  const files = fs.readdirSync(historyDir).filter(f => f.endsWith(".json")).sort();
  while (files.length > 14) {
    const old = files.shift();
    fs.unlinkSync(path.join(historyDir, old));
  }

  return filePath;
}

async function main() {
  const { input, historyDir } = parseArgs();

  // Determine input file
  let dataFile = input;
  if (!dataFile) {
    const latest = "/home/azureuser/.openclaw/data/x-agent/latest.json";
    if (fs.existsSync(latest)) dataFile = latest;
  }
  if (!dataFile || !fs.existsSync(dataFile)) {
    console.error("[ANALYZER] No input file. Use --input <path> or ensure latest.json exists.");
    process.exit(1);
  }

  const data = loadJSON(dataFile);
  if (!data || !data.tweets) {
    console.error("[ANALYZER] Invalid data file.");
    process.exit(1);
  }

  console.error(`[ANALYZER] Analyzing ${data.totalTweets} tweets from ${data.timestamp?.slice(0, 10)}`);

  const analysisResult = analyze(data);

  // History comparison
  const prevAnalysis = loadPreviousAnalysis(historyDir);
  const heatChange = computeHeatChange(analysisResult.keywordHeat, prevAnalysis?.keywordHeat);

  // Save history
  const savedPath = saveAnalysis(analysisResult, historyDir);
  console.error(`[ANALYZER] History saved: ${savedPath}`);

  // Output
  const output = {
    status: "ok",
    dataTimestamp: data.timestamp,
    totalTweets: data.totalTweets,
    trending: data.trending || [],
    sourcesBreakdown: analysisResult.sourcesBreakdown,
    tokenMentions: Object.entries(analysisResult.tokenMentions).slice(0, 30).map(([k, v]) => ({ token: k, count: v })),
    accountMentions: Object.entries(analysisResult.accountMentions).slice(0, 20).map(([k, v]) => ({ account: k, count: v })),
    keywordHeat: heatChange,
    topTweets: analysisResult.topTweets.slice(0, 5),
    savedHistory: savedPath,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("[ANALYZER ERROR]", err.message);
  console.log(JSON.stringify({ status: "error", error: err.message }));
  process.exit(1);
});
