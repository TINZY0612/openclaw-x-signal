#!/usr/bin/env node
/**
 * X Agent v3 — AI-powered Twitter/X Monitoring Agent
 *
 * Architecture:
 *   Hot Layer:     X List + Crypto Trending (keywordHeat)
 *   Narrative L:   10 keyword searches (Latest)
 *   Signal Layer:  whale/regulatory/on-chain queries
 *
 * Usage: node x-agent.mjs --search
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SECRET_PATH = "/home/azureuser/.openclaw/secrets/x-twitter.json";
const LIST_URL = "https://x.com/i/lists/2055568697255760309";
const DATA_DIR = "/home/azureuser/.openclaw/data/x-agent";
const HISTORY_DIR = path.join(DATA_DIR, "history");

// Narrative Layer — 10 keyword searches (Latest sort)
const NARRATIVE_QUERIES = [
  "bitcoin crypto", "ethereum defi", "solana web3", "AI agent crypto",
  "base chain", "altcoin season", "RWA tokenization", "DeFi yield",
  "memecoin", "crypto regulation news",
];

// Signal Layer — high-signal queries for targeted intelligence
const SIGNAL_QUERIES = [
  "whale move OR large transfer crypto",   // 大户/鲸鱼动向
  "project official news OR mainnet launch", // 项目方官宣
  "SEC OR CFTC crypto regulation",          // 监管新闻
  "onchain data OR TVL OR total value locked", // 链上数据
  "bitcoin etf OR ethereum etf inflow OR outflow", // ETF 资金流
];

// Keywords for heat tracking
const TRACKED_KEYWORDS = [
  "bitcoin", "ethereum", "solana", "ai agent", "base",
  "altcoin", "rwa", "defi", "memecoin", "regulation",
  "nft", "layer2", "staking", "etf", "whale",
  "ai", "grok", "openai", "nvidia", "google", "tesla",
  "fed", "interest rate", "inflation", "liquidity", "tariff", "war",
  "china", "russia", "iran", "oil", "gold", "stock", "nasdaq",
];

const KEYWORD_PATTERNS = {
  bitcoin: /\b(bitcoin|btc)\b/i,
  ethereum: /\b(ethereum|eth)\b/i,
  solana: /\b(solana|sol)\b/i,
  "ai agent": /\b(ai agents?|agentic|autonomous agent)\b/i,
  base: /\bbase chain\b|\bcoinbase\b|\bon base\b/i,
  altcoin: /\baltcoins?|altseason|altcoin season\b/i,
  rwa: /\b(rwa|real world assets?|tokeni[sz]ed stocks?|tokenization)\b/i,
  defi: /\bdefi|decentralized finance|tvl|yield tokenization\b/i,
  memecoin: /\bmemecoins?|meme coin|pump\.fun\b/i,
  regulation: /\b(sec|cftc|regulation|regulatory|lawsuit|enforcement|clarity)\b/i,
  nft: /\bnfts?\b/i,
  layer2: /\b(layer ?2|l2|rollup)\b/i,
  staking: /\bstaking|restaking|stake\b/i,
  etf: /\betfs?\b/i,
  whale: /\bwhales?|large transfer|smart money\b/i,
  ai: /\b(ai|grok|openai|xai|nvidia|artificial intelligence|cursor|gemini|claude)\b/i,
  fed: /\b(fed|fomc|powell|federal reserve)\b/i,
  "interest rate": /\b(interest rates?|rate cuts?|rate hikes?|yields?|treasury yields?)\b/i,
  inflation: /\b(cpi|ppi|inflation|disinflation)\b/i,
  liquidity: /\b(liquidity|m2|money supply|qe|qt)\b/i,
  tariff: /\btariffs?\b/i,
  war: /\b(war|ceasefire|missile|attack|geopolitics?|sanctions?)\b/i,
  china: /\bchina|beijing|hong kong\b/i,
  russia: /\brussia|moscow|ukraine\b/i,
  iran: /\biran|tehran|middle east\b/i,
  oil: /\boil|brent|wti|opec\b/i,
  gold: /\bgold|xau\b/i,
  stock: /\bstocks?|equities|shares?\b/i,
  nasdaq: /\bnasdaq|s&p|spx|qqq|ndx\b/i,
};

const SOURCE_WEIGHTS = new Map([
  ["watcherguru", 1.35], ["coindesk", 1.35], ["coinmarketcap", 1.25],
  ["coingecko", 1.25], ["sosovaluecrypto", 1.25], ["binance", 1.25],
  ["arkinvest", 1.25], ["unusual_whales", 1.2], ["jsseyff", 1.25],
  ["jseyff", 1.25], ["elonmusk", 1.15], ["xai", 1.15],
  ["cryptorover", 1.1], ["ashcrypto", 1.05],
]);

const TOKEN_DENY = new Set(["ASSET","PRINT","BILL","TRUST","LEAF","CHP","CA","BUGZ","AMST","PFE","BNTX","NEX"]);
const TOKEN_ALLOW = new Set(["BTC","ETH","SOL","BNB","XRP","ONDO","HYPE","AAVE","PEPE","TRX","STRK","TON","RAY","USDT","USDC","FXUSD","MEMECOIN"]);

const STOP_TOKENS = new Set([
  "THE","FOR","AND","NOT","YOU","CAN","ALL","ARE","BUT","HAS","WAS",
  "THIS","THAT","WITH","FROM","HAVE","BEEN","WILL","WHAT","WHEN",
  "THAN","YOUR","ITS","HERE","THERE","MORE","ALSO","SOME","EACH",
  "VERY","JUST","SHOW","DONE","NEW","NOW","ONE","OUT","HOW","WHY",
  "WHO","WHICH","WHERE","BOTH","EVER","ANY","FEW","MANY","SUCH",
  "ONLY","OWN","SAME","SO","TOO","PER","VIA","UPON","INTO","ONTO",
  "OVER","UNDER","BEFORE","AFTER","BETWEEN","THROUGH","WITHIN",
  "WITHOUT","ACROSS","AROUND","BEHIND","BEYOND","INSIDE","OUTSIDE",
  "ALONG","BESIDE","UPPER","LOWER","ETF","USD","CEO","APP","GAME",
  "BIG","TOP","DAY","WEEK","MONTH","YEAR","AVE","MIN","MAX","MID",
  "HIGH","LOW","LONG","SHORT","REAL","TRUE","SAFE","COLD","HOT",
  "WARM","DARK","LIGHT","FAST","SLOW","HARD","SOFT","DEEP","WIDE",
  "NEAR","FAR","OPEN","CLOSED","FREE","PAID","LIVE","DEAD","HALF",
  "FULL","NEXT","LAST","PAST","FIRST","SECOND","THIRD","LEFT","RIGHT",
  "EAST","WEST","NORTH","SOUTH","BEST","WORST","GOOD","BETTER","ABLE",
  "NICE","KIND","SURE","CLEAR","EASY","SOON","LATE","EARLY","MUCH",
  "LESS","MOST","LEAST","NEVER","OFTEN","ALWAYS","ABOUT","ABOVE",
  "AFTER","ALONG","ALSO","AMONG","AROUND","BEHIND","BELOW","BENEATH",
  "BESIDE","BETWEEN","BEYOND","DURING","EXCEPT","INSIDE","OUTSIDE",
  "THROUGH","TOWARD","TOWARDS","UNDER","UNLIKE","UNTIL","UPON",
  "WITHIN","WITHOUT","VIDEO","LOGO","SIGN","CODE","DATA","INFO",
  "TEXT","FILE","EDIT","VIEW","HELP","MENU","MODE","SITE","PAGE",
  "POST","LINK","LIST","NOTE","TASK","ICON","TAB","TAG","KEY",
  "SET","GET","PUT","RUN","LOG","MAP","NET","CPU","RAM","ROM",
  "SQL","PDF","HTML","CSS","HTTP","HTTPS","FTP","SSH","SSL",
  "TLS","API","URL","URI","JSON","XML","CSV","YAML","COM","NET",
  "ORG","INC","LTD","CO","DE","IO","ME","TO","PM","AM","US",
]);

function hasFlag(n) { return process.argv.includes(n); }
const mode = hasFlag("--full") ? "full" : hasFlag("--search") ? "search" : hasFlag("--kols") ? "kols" : "list";
const telegramMode = hasFlag("--telegram");

function rd() { return JSON.parse(fs.readFileSync(SECRET_PATH,"utf8")); }

function cookies(secret) {
  const a = secret.x_auth_token || secret.x_twitter_auth_token || secret.auth_token;
  const c = secret.x_ct0 || secret.ct0;
  const out = [];
  if (a) out.push({name:"auth_token",value:a,domain:".x.com",path:"/",httpOnly:true,secure:true,sameSite:"None"});
  if (c) out.push({name:"ct0",value:c,domain:".x.com",path:"/",httpOnly:false,secure:true,sameSite:"Lax"});
  return out;
}

// ===== ANALYSIS FUNCTIONS =====

function isNum(s) { return /^\d+[\.\d]*(K|M|B)?$/i.test(s); }

function isLikelyTickerNoise(t) {
  if (TOKEN_DENY.has(t)) return true;
  if (/^USD[A-Z0-9]{3,}$/.test(t) && !["USDC","USDT","USDD","USDS","USD1"].includes(t)) return true;
  if (t.length <= 2 && !TOKEN_ALLOW.has(t)) return true;
  if (t.length > 10) return true;
  if (/[0-9]/.test(t) && !["AAVE","1INCH"].includes(t)) return true;
  if (t.length > 6 && !TOKEN_ALLOW.has(t)) return true;
  return false;
}

function extractTokens(text) {
  if (!text) return [];
  const m = text.match(/\$([A-Za-z0-9]+)/g);
  if (!m) return [];
  return [...new Set(m.map(x=>x.slice(1).toUpperCase()).filter(t=>t.length>=2&&t.length<=15&&!STOP_TOKENS.has(t)&&!isNum(t)&&!isLikelyTickerNoise(t)&&/[A-Z]/.test(t)))];
}

function extractMentions(text) {
  if (!text) return [];
  const m = text.match(/@([A-Za-z0-9_]+)/g);
  return m ? [...new Set(m.map(x=>x.slice(1).toLowerCase()))] : [];
}

const SENTIMENT_RULES = {
  bullish: ["bullish","breakout","pump","moon","rally","surge","soar","ath","accumulate","inflow","approval","approved","launch","mainnet","partnership","adoption","institutional","buy","long","u"],
  bearish: ["bearish","dump","selloff","crash","drop","plunge","outflow","sold","liquidation","short","reject","withdrawn","hack","exploit","lawsuit","investigation","risk","down","跌","砸盘",""],
  panic: ["panic","capitulation","fear","blood","rug","exploit","hack","emergency","paused","halted","insolvent","bankrupt","崩盘","恐慌","踩踏","暂停","破产","归零"],
  hype: ["100x","1000x","gem","send it","ape","fomo","moon","next big","爆发","起飞","百倍","千倍","冲","梭哈"],
  news: ["breaking","just in","latest","announced","reportedly","says","launches","files","filing","update","new:","消息","宣布","报道","发布","上线"],
  shill: ["join now","airdrop","giveaway","claim","rewards","presale","mint now","buy now","referral","邀请码","空投","领取","预售"],
};

function classifySentiment(text) {
  const lower = String(text || "").toLowerCase();
  const scores = {};
  for (const [label, words] of Object.entries(SENTIMENT_RULES)) {
    scores[label] = words.reduce((sum, w) => sum + (lower.includes(w.toLowerCase()) ? 1 : 0), 0);
  }
  if (scores.panic > 0) return { label: "panic", scores };
  if (scores.shill >= 2) return { label: "shill", scores };
  if (scores.hype >= 2 && scores.bearish === 0) return { label: "hype", scores };
  if (scores.bullish > scores.bearish && scores.bullish > 0) return { label: "bullish", scores };
  if (scores.bearish > scores.bullish && scores.bearish > 0) return { label: "bearish", scores };
  if (scores.news > 0) return { label: "news", scores };
  return { label: "neutral", scores };
}

function isMarketRelevant(text) {
  return keywordMatches(text).length > 0 ||
    /\$[A-Za-z]{2,10}\b/.test(text || "") ||
    /\b(btc|eth|sol|bnb|xrp|defi|rwa|crypto|bitcoin|ethereum|solana|stablecoin|token|chain|onchain|etf|altcoin|memecoin|stocks?|equities|nasdaq|s&p|dow|dxy|treasury|yield|bond|fed|fomc|cpi|ppi|in/.test(text || "") ||
    /(比特币|以太坊|加密|币圈|链上|山寨|山寨币|稳定币|合约|现货|期货|交易所|资金费率|爆仓|清算|暴涨|暴跌|拉盘|砸盘|牛市|熊市|监管|降息|加息|/.test(text || "");
}

const isCryptoRelevant = isMarketRelevant;

function engScore(t) {
  const m = t.metrics||{};
  const base = parseMetric(m.like) + parseMetric(m.repost) * 2 + parseMetric(m.reply) * 3 + parseMetric(m.view) * 0.002;
  return base * accountWeight(t.author);
}

function parseMetric(v) {
  if (!v) return 0;
  const s=String(v).replace(/,/g,"").trim().toUpperCase();
  if (s.endsWith("K")) return parseFloat(s)*1000;
  if (s.endsWith("M")) return parseFloat(s)*1000000;
  if (s.endsWith("B")) return parseFloat(s)*1000000000;
  return parseFloat(s)||0;
}

function accountWeight(author = "") {
  return SOURCE_WEIGHTS.get(String(author).toLowerCase()) || 1;
}

function keywordMatches(text) {
  const lower = String(text || "").toLowerCase();
  const out = [];
  for (const kw of TRACKED_KEYWORDS) {
    const pattern = KEYWORD_PATTERNS[kw];
    if (pattern ? pattern.test(text || "") : lower.includes(kw)) out.push(kw);
  }
  return out;
}

function normalizeForCluster(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff$# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function nearDeduplicateTweets(tweets) {
  const best = new Map();
  for (const t of tweets) {
    const key = normalizeForCluster(t.text);
    if (!key || key.length < 24) {
      best.set(`${t.url || Math.random()}`, t);
      continue;
    }
    const prev = best.get(key);
    if (!prev || engScore(t) > engScore(prev)) best.set(key, t);
  }
  return [...best.values()];
}

function analyze(tweets) {
  const tokens={}, accounts={}, kwCount={}, scored=[], sentimentCounts={}, tokenSentiment={};
  for (const t of tweets) {
    const text=t.text||"", lower=text.toLowerCase();
    const sentiment = classifySentiment(text);
    t.sentiment = sentiment.label;
    sentimentCounts[sentiment.label]=(sentimentCounts[sentiment.label]||0)+1;
    for (const tok of extractTokens(text)) {
      tokens[tok]=(tokens[tok]||0)+1;
      tokenSentiment[tok] ||= {};
      tokenSentiment[tok][sentiment.label]=(tokenSentiment[tok][sentiment.label]||0)+1;
    }
    for (const acc of extractMentions(text)) { if (acc!==(t.author||"").toLowerCase()) accounts[acc]=(accounts[acc]||0)+1; }
    for (const kw of keywordMatches(text)) kwCount[kw]=(kwCount[kw]||0)+1;
    scored.push({tweet:t,score:engScore(t)});
  }
  scored.sort((a,b)=>b.score-a.score);
  return {
    tokenMentions: Object.fromEntries(Object.entries(tokens).sort((a,b)=>b[1]-a[1])),
    tokenSentiment,
    sentimentCounts: Object.fromEntries(Object.entries(sentimentCounts).sort((a,b)=>b[1]-a[1])),
    accountMentions: Object.fromEntries(Object.entries(accounts).sort((a,b)=>b[1]-a[1])),
    keywordCounts: kwCount,
    topTweets: scored.slice(0,10).map(s=>({url:s.tweet.url,author:s.tweet.author,text:(s.tweet.text||"").slice(0,200),score:s.score,sourceWeight:accountWeight(s.tweet.author),metrics:s.tweet.metr})),
    topViewedTweets: [...scored]
      .sort((a,b)=>parseMetric(b.tweet.metrics?.view)-parseMetric(a.tweet.metrics?.view))
      .slice(0,10)
      .map(s=>({url:s.tweet.url,author:s.tweet.author,text:(s.tweet.text||"").slice(0,200),views:parseMetric(s.tweet.metrics?.view),sourceWeight:accountWeight(s.tweet.author),metrics:s.tweet.metr})),
  };
}

function loadPrev() {
  try { if (!fs.existsSync(HISTORY_DIR)) return null;
    const f=fs.readdirSync(HISTORY_DIR).filter(x=>x.endsWith(".json")).sort().reverse();
    if (!f.length) return null;
    return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR,f[0]),"utf8")).analysis||null;
  } catch { return null; }
}

function heatChange(cur, prev) {
  const r={};
  for (const k of new Set([...Object.keys(cur),...(prev?Object.keys(prev):[])])) {
    const c=cur[k]||0, p=prev?.[k]||0;
    r[k]={current:c,previous:p,change:c-p,changePct:p>0?Math.round((c-p)/p*100):(c>0?100:0)};
  }
  return r;
}

function trimText(text, max = 120) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function buildNarratives(tweets, heatItems) {
  return (heatItems || []).slice(0, 7).map(item => {
    const keyword = item.keyword;
    const samples = tweets
      .filter(t => keywordMatches(t.text).includes(keyword))
      .filter(t => isMarketRelevant(t.text))
      .sort((a, b) => engScore(b) - engScore(a))
      .slice(0, 2)
      .map(t => ({ author: t.author, text: trimText(t.text, 150), url: t.url, metrics: t.metrics, sentiment: t.sentiment || classifySentiment(t.text).label }));
    const sentimentCounts = {};
    for (const t of tweets.filter(t => keywordMatches(t.text).includes(keyword))) {
      const label = t.sentiment || classifySentiment(t.text).label;
      sentimentCounts[label] = (sentimentCounts[label] || 0) + 1;
    }
    const dominantSentiment = Object.entries(sentimentCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "neutral";
    const weightedScore = (item.current || 0) * (dominantSentiment === "panic" ? 1.2 : dominantSentiment === "bearish" ? 1.1 : dominantSentiment === "bullish" ? 1.05 : 1);
    return { ...item, sentiment: dominantSentiment, sentimentCounts, weightedScore, samples };
  });
}

function formatTelegramSummary(out) {
  const sourceBits = [];
  if (out.sources?.list) sourceBits.push(`X List ${out.sources.list}`);
  if (out.sources?.signal) sourceBits.push(`信号 ${out.sources.signal}`);
  if (out.sources?.narrative) sourceBits.push(`叙事 ${out.sources.narrative}`);

  const lines = [
    `🐦 X/Twitter 每日精选 · ${new Date(out.timestamp || Date.now()).toISOString().slice(0,10).replaceAll("-", ".")}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "📊 市场情绪总览",
    `本次覆盖 ${out.totalTweets} 条推文，来自 ${sourceBits.join(" / ") || "X"}。热点主要集中在 ${(out.cryptoTrending || []).slice(0,3).map(x=>x.keyword).join("、") || "crypto �",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "🔥 核心叙事",
  ];

  if (out.sentimentSummary) {
    const s = out.sentimentSummary;
    lines.push("", `🧠 情绪分类: bullish ${s.bullish || 0} / bearish ${s.bearish || 0} / panic ${s.panic || 0} / hype ${s.hype || 0} / news ${s.news || 0} / shill ${s.shill || 0}`);
  }

  const heat = (out.topNarratives || out.cryptoTrending || []).slice(0, 5);
  if (heat.length) {
    let i = 1;
    for (const item of heat) {
      const change = item.change > 0 ? `+${item.change}` : `${item.change || 0}`;
      const sample = item.samples?.[0];
      lines.push(`${i}️⃣ ${item.keyword} 热度 ${item.current || 0} 次（${change} vs previous，${item.sentiment || "neutral"}）`);
      if (sample) lines.push(`${sample.text}（@${sample.author || "unknown"}）`);
      i++;
    }
  } else {
    lines.push("暂时没有足够重复叙事。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "🪙 高频代币");
  const tokens = (out.hotTokens || []).slice(0, 8);
  if (tokens.length) {
    lines.push(tokens.map(t => `$${t.token}(${t.count})`).join("  "));
  } else {
    lines.push("暂时没有可信 $ticker 聚集。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "📈 最热门5条推文");
  const topTweets = (out.topTweets || []).slice(0, 5);
  if (topTweets.length) {
    let i = 1;
    for (const t of topTweets) {
      lines.push(`${i}️⃣ @${t.author || "unknown"}`);
      lines.push(`${trimText(t.text, 115)}`);
      lines.push(`${t.url || "X"}`);
      i++;
    }
  } else {
    lines.push("暂时没有可排序的高互动帖子。");
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━", "", "📡 数据源说明");
  lines.push(`本次分析覆盖 ${out.totalTweets} 条推文，包含 X List、信号查询和 10 组关键词搜索。`);
  lines.push("", `⏰ 采集时间：${out.timestamp || new Date().toISOString()}`);
  lines.push("🤖 X Agent Daily · Generated by OpenClaw");
  lines.push("", "📁 完整数据已保存:");
  lines.push(out.savedJson || "/home/azureuser/.openclaw/data/x-agent/latest.json");

  return lines.join("\n").slice(0, 3900);
}

function saveHist(analysis) {
  fs.mkdirSync(HISTORY_DIR,{recursive:true});
  const date=new Date().toISOString().slice(0,10), fp=path.join(HISTORY_DIR,`${date}.json`);
  let e={}; try { e=JSON.parse(fs.readFileSync(fp,"utf8")); } catch {}
  fs.writeFileSync(fp,JSON.stringify({...e,timestamp:new Date().toISOString(),analysis,updatedAt:new Date().toISOString()},null,2));
  const files=fs.readdirSync(HISTORY_DIR).filter(x=>x.endsWith(".json")).sort();
  while (files.length>14) fs.unlinkSync(path.join(HISTORY_DIR,files.shift()));
}

// ===== SCRAPING =====

/** Scrape X Explore trending (Global) — approach C */
async function fetchExploreTrending(context) {
  console.error(`[TRENDING] Explore page...`);
  const tab = await context.newPage();
  try {
    await tab.goto("https://x.com/explore/tabs/trending", {waitUntil:"domcontentloaded",timeout:45000}).catch(()=>{});
    await tab.waitForTimeout(10000);
    const body = await tab.locator("body").innerText({timeout:5000}).catch(()=>"");
    if (tab.url().includes("/i/flow/login") || /Sign in to X/.test(body)) return [];

    const trending = await tab.evaluate(() => {
      // Each trending item has: rank number, category, title
      const els = document.querySelectorAll('div[data-testid="trend"]');
      if (els.length) {
        return Array.from(els).slice(0,15).map(el => {
          const spans = el.querySelectorAll('span');
          const texts = Array.from(spans).map(s => s.textContent).filter(Boolean);
          return { topic: texts[texts.length-1] || "", category: texts[texts.length-2] || "", rank: texts[0] || "" };
        });
      }
      // Fallback: parse from innerText
      const lines = document.body.innerText.split("\n").map(l=>l.trim()).filter(Boolean);
      const out = []; let inTrend=false;
      for (const ln of lines) {
        if (ln === "Global Trending" || ln === "Trending") { inTrend=true; continue; }
        if (ln === "The most popular posts" || ln === "Explore") { if (inTrend) break; else continue; }
        if (!inTrend) continue;
        if (/^\d+$/.test(ln) && out.length===0) continue; // skip rank
        if (ln.includes("·")) { out.push({topic:ln,source:"explore"}); }
        else if (ln.length>0 && out.length>0 && !/^\d+$/.test(ln)) { out.push({topic:ln,source:"explore"}); }
      }
      return out;
    }).catch(()=>[]);
    console.error(`[TRENDING] Got ${trending.length} global topics`);
    return trending;
  } finally { await tab.close().catch(()=>{}); }
}

/** Scrape tweets from a page (search with Latest sort) */
async function scrapeTweets(context, url, sourceLabel, maxTweets = 20) {
  console.error(`[SCRAPE] ${sourceLabel}`);
  const page = await context.newPage();
  try {
    await page.goto(url, {waitUntil:"domcontentloaded",timeout:45000}).catch(()=>{});
    await page.waitForTimeout(6000);
    const bt = await page.locator("body").innerText({timeout:8000}).catch(()=>"");
    if (page.url().includes("/i/flow/login") || /Sign in to X/.test(bt)) return [];

    const tweets = []; const seen = new Set(); let empty = 0;
    for (let s=0; s<6 && tweets.length<maxTweets && empty<3; s++) {
      const batch = await page.locator('article[data-testid="tweet"]').evaluateAll((articles) => {
        return articles.map(el => {
          const lk=el.querySelector('a[href*="/status/"]');
          const tx=el.querySelector('[data-testid="tweetText"]')?.textContent||"";
          const ne=el.querySelector('[data-testid="User-Name"]');
          const au=ne?.querySelector('a[href^="/"]')?.getAttribute("href")?.split("/")[1]||"";
          const ti=el.querySelector("time")?.getAttribute("datetime")||"";
          const gm=id=>(el.querySelector(`[data-testid="${id}"]`)?.textContent||"0").trim();
          return {url:lk?.href||"",author:au,userName:ne?.textContent||"",time:ti,text:tx,
            metrics:{reply:gm("reply"),repost:gm("retweet"),like:gm("like"),view:(el.querySelector('a[href*="/analytics"]')?.textContent||"0").trim()}};
        });
      }).catch(()=>[]);
      let added=0;
      for (const it of batch) { if (!it.url||seen.has(it.url)) continue; seen.add(it.url);
        tweets.push({source:sourceLabel,url:it.url,author:(it.author||"").replace(/\s+/g," ").trim(),userName:(it.userName||"").replace(/\s+/g," ").trim(),time:it.time,text:(it.text||"").replace(/\s+/g," ").trim(),metrics:it.metrics});
        added++; if (tweets.length>=maxTweets) break; }
      if (added===0) empty++; else empty=0;
      if (tweets.length<maxTweets) { await page.evaluate(()=>window.scrollBy(0,800)); await page.waitForTimeout(2000); }
    }
    console.error(`[SCRAPE] Got ${tweets.length} tweets`);
    return tweets;
  } finally { await page.close().catch(()=>{}); }
}

// ===== MAIN =====

async function main() {
  const start=Date.now();
  console.error(`=== X Agent v3 [mode: ${mode}] ===`);

  const secret=rd(), ck=cookies(secret);
  if (!ck.some(c=>c.name==="auth_token"&&c.value)) { console.log(JSON.stringify({status:"error",error:"missing_auth_token"})); process.exit(2); }

  const browser=await chromium.launch({headless:true,args:["--disable-dev-shm-usage","--no-sandbox"]});
  const result={status:"ok",timestamp:new Date().toISOString(),mode,sources:{},totalTweets:0,tweets:[],trending:[],signalTweets:[]};

  let ctx;
  try {
    ctx=await browser.newContext({viewport:{width:1365,height:900},locale:"en-US",userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"});
    await ctx.addCookies(ck);

    if (mode==="search"||mode==="full") {
      // Hot Layer: Explore Trending (global) — approach C
      result.trending = await fetchExploreTrending(ctx);
      result.sources.trending = result.trending.length;

      // Signal Layer (NEW): high-signal targeted queries
      console.error("[SIGNAL] High-signal queries...");
      for (const q of SIGNAL_QUERIES) {
        const url = `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`;
        const tweets = await scrapeTweets(ctx, url, `signal:${q.slice(0,30)}`, 5);
        result.tweets.push(...tweets);
        result.totalTweets += tweets.length;
      }
      result.sources.signal = result.totalTweets;
    }

    // Hot Layer: X List
    result.tweets.push(...await scrapeTweets(ctx, LIST_URL, "x_list", 20));
    result.sources.list = 20;

    // Narrative Layer: 10 keyword searches (Latest sort)
    if (mode==="search"||mode==="full") {
      console.error("[NARRATIVE] Keyword searches (Latest)...");
      for (const q of NARRATIVE_QUERIES) {
        // Use Latest (live) sort for freshness
        const url = `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
        const tweets = await scrapeTweets(ctx, url, `narrative:${q}`, 6);
        result.tweets.push(...tweets);
        result.totalTweets += tweets.length;
      }
      result.sources.narrative = result.totalTweets - result.sources.list - (result.sources.signal||0);
    }

    // KOL timelines
    if (mode==="kols"||mode==="full") {
      for (const u of ["blknoiz06","jessepollak","cz_binance","VitalikButerin","aixbt_agent","raoulgmi","CryptoHayes","DefiLlama","CoinMarketCap","CoinDesk"]) {
        result.tweets.push(...await scrapeTweets(ctx, `https://x.com/${u}`, `kol:${u}`, 6));
      }
    }

    // Deduplicate
    const seen=new Set(), unique=[];
    for (const t of result.tweets) { const k=t.url; if (!k||seen.has(k)) continue; seen.add(k); unique.push(t); }
    result.tweets=nearDeduplicateTweets(unique); result.totalTweets=result.tweets.length;

    // ===== ANALYSIS =====
    console.error("[ANALYSIS] Running...");
    const a=analyze(result.tweets), prev=loadPrev(), hc=heatChange(a.keywordCounts, prev?.keywordCounts);
    saveHist(a);

    // Crypto trending from keywordHeat (approach B)
    const cryptoTrending = Object.entries(hc)
      .map(([k,v])=>({keyword:k,...v}))
      .sort((a,b)=>(b.current + Math.max(0,b.change||0)*0.5) - (a.current + Math.max(0,b.change||0)*0.5))
      .slice(0,12);

    // Output
    const out = {
      status:"ok", version:"v3", timestamp:result.timestamp, runTime:"", mode:result.mode,
      sources: result.sources, totalTweets: result.totalTweets,
      // Hot Layer: trending
      exploreTrending: result.trending,
      cryptoTrending,  // keywordHeat-based (approach B)
      // Narrative Layer insights
      hotTokens: Object.entries(a.tokenMentions).slice(0,25).map(([k,v])=>({token:k,count:v})),
      tokenSentiment: a.tokenSentiment,
      sentimentSummary: a.sentimentCounts,
      hotAccounts: Object.entries(a.accountMentions).slice(0,15).map(([k,v])=>({account:k,count:v})),
      keywordHeat: cryptoTrending,
      topNarratives: buildNarratives(result.tweets, cryptoTrending),
      topTweets: a.topTweets.filter(t=>isMarketRelevant(t.text)).slice(0,8),
      topViewedTweets: a.topViewedTweets.filter(t=>isMarketRelevant(t.text)).slice(0,8),
      historySaved: true,
    };

    fs.mkdirSync(DATA_DIR,{recursive:true});
    const ts=new Date().toISOString().replace(/[:.]/g,"-"), of=path.join(DATA_DIR,`x-agent-${ts}.json`);
    fs.writeFileSync(of,JSON.stringify(out,null,2));
    fs.writeFileSync(path.join(DATA_DIR,"latest.json"),JSON.stringify(out,null,2));
    out.savedJson=of; out.runTime=`${((Date.now()-start)/1000).toFixed(0)}s`;

    console.error(`[DONE] ${result.totalTweets}t, ${result.trending.length}trending, ${Object.keys(a.tokenMentions).length}tokens in ${out.runTime}`);
    console.error(`[DONE] Saved: ${of}`);
    console.log(telegramMode ? formatTelegramSummary(out) : JSON.stringify(out));
  } finally {
    if (ctx) await ctx.close().catch(()=>{});
    await browser.close().catch(()=>{});
  }
}

main().catch(err=>{console.error("[FATAL]",err.message); console.log(JSON.stringify({status:"error",error:err.message})); process.exit(1);});
