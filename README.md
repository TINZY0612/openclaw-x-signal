# X Agent: Crypto and Market Intelligence from X/Twitter

X Agent is a Playwright-based X/Twitter monitoring and analysis tool for crypto market intelligence. It reads a curated X List, searches high-signal market narratives, classifies sentiment, tracks token mentions, cross-validates X buzz against market data, and generates structured JSON plus Telegram-ready daily reports.

It is designed as an analyst layer, not an execution engine. Use it to understand what X is talking about, what narratives are heating up, and whether social attention is confirmed by price, volume, liquidity, or funding data.

## What It Does

- Reads a curated X List using your own authenticated X session.
- Searches predefined crypto, AI, macro, and market queries.
- Tracks narrative heat and changes versus previous runs.
- Extracts ticker mentions such as `$BTC`, `$ETH`, `$SOL`, and `$ONDO`.
- Classifies tweets as `bullish`, `bearish`, `panic`, `hype`, `news`, `shill`, or `neutral`.
- Splits narratives into two boards:
  - Crypto / On-chain
  - AI / Macro / Geopolitics
- Ranks tweets by engagement and separately by views.
- Cross-validates high-frequency crypto tickers against:
  - Binance
  - CoinGecko
  - Dexscreener
- Produces:
  - Structured JSON for other agents
  - Telegram-formatted human-readable daily reports
  - Historical snapshots for heat tracking

## Important Disclaimer

This project does not provide financial advice. It does not place trades. X/Twitter data is noisy, incomplete, and often manipulated. Treat the output as market intelligence and narrative monitoring, not as a direct buy or sell signal.

## Architecture

```text
                         X Agent
                            |
       +--------------------+--------------------+
       |                    |                    |
   Hot Layer           Signal Layer        Narrative Layer
       |                    |                    |
   X List              Whale moves         Keyword searches
   X Trending          Regulation          BTC / ETH / SOL
                       ETF flows           AI / RWA / DeFi
                       On-chain data       Memecoins / Macro
                            |
                            v
                         Analyzer
                            |
       +--------------------+--------------------+
       |                    |                    |
 Token extraction     Sentiment class      Narrative heat
 Engagement score     Source weighting     View ranking
 Deduplication        Keyword matching     History tracking
                            |
                            v
                    Market Cross-Validation
                            |
       +--------------------+--------------------+
       |                    |                    |
    Binance             CoinGecko          Dexscreener
 price / volume       market data        liquidity / pairs
 funding rate
                            |
                            v
                          Output
                            |
       +--------------------+--------------------+
       |                                         |
  Structured JSON                         Telegram report
  for agents                              for humans
```

## Requirements

- Node.js 18 or newer
- npm
- Playwright Chromium
- A valid X/Twitter browser session cookie
- Internet access from the machine running the agent

Default market data sources use public endpoints and do not require paid API keys.

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/x-agent.git
cd x-agent
npm install
npx playwright install chromium
```

On Linux servers, you may also need:

```bash
npx playwright install-deps
```

## X Authentication

X Agent uses your own logged-in X browser session. At minimum, it needs the `auth_token` cookie. The `ct0` cookie is recommended.

Create a secrets file outside the repository:

```bash
mkdir -p ~/.openclaw/secrets
cat > ~/.openclaw/secrets/x-twitter.json << 'EOF'
{
  "xactions_session_cookie": "YOUR_AUTH_TOKEN_HERE",
  "x_twitter_ct0": "YOUR_CT0_HERE"
}
EOF
chmod 600 ~/.openclaw/secrets/x-twitter.json
```

Never commit this file. Never paste real cookies into GitHub issues, prompts, or public chats.

## Configuration

Edit `x-agent.mjs`.

### X List

```js
const LIST_URL = "https://x.com/i/lists/YOUR_LIST_ID";
```

### Narrative Queries

```js
const NARRATIVE_QUERIES = [
  "bitcoin crypto",
  "ethereum defi",
  "solana web3",
  "AI agent crypto",
  "base chain",
  "altcoin season",
  "RWA tokenization",
  "DeFi yield",
  "memecoin",
  "crypto regulation news"
];
```

### Signal Queries

```js
const SIGNAL_QUERIES = [
  "whale move OR large transfer crypto",
  "project official news OR mainnet launch",
  "SEC OR CFTC crypto regulation",
  "onchain data OR TVL OR total value locked",
  "bitcoin etf OR ethereum etf inflow OR outflow"
];
```

### Source Weights

Trusted sources can receive small engagement boosts:

```js
const SOURCE_WEIGHTS = new Map([
  ["watcherguru", 1.35],
  ["coindesk", 1.35],
  ["coingecko", 1.25],
  ["binance", 1.25],
  ["elonmusk", 1.15],
  ["xai", 1.15]
]);
```

Keep these weights conservative. They should improve sorting, not decide truth.

## Commands

```bash
# X List only
node x-agent.mjs

# Full intelligence scrape: list + trending + signal queries + narrative searches
node x-agent.mjs --search

# KOL mode
node x-agent.mjs --kols

# Everything
node x-agent.mjs --full

# Daily pipeline with one Telegram-formatted report
node daily-run.mjs --telegram

# Daily pipeline with multi-part Telegram output for long reports
node daily-run.mjs --telegram-parts
```

For detailed reports, prefer:

```bash
node daily-run.mjs --telegram-parts
```

This returns a JSON object with a `parts` array. Send each part as a separate Telegram message.

## Output Files

By default, the agent writes data under:

```text
~/.openclaw/data/x-agent/
```

Typical files:

```text
latest.json             Most recent scrape output
latest-daily.json       Most recent daily report output
x-agent-*.json          Timestamped scrape snapshots
daily-*.json            Timestamped daily reports
history/YYYY-MM-DD.json Daily keyword heat history
```

## Telegram Report Format

The report includes:

1. Market sentiment overview
2. Sentiment classification summary
3. Crypto / On-chain narrative board
4. AI / Macro / Geopolitics narrative board
5. High-frequency tokens
6. X x Market cross-validation
7. Most engaged tweets
8. Highest viewed tweets
9. Data source note
10. Saved JSON path

Example:

```text
X/Twitter Daily Intelligence - 2026.05.20
Part 1/2

Market Sentiment Overview
Covered 91 tweets from X List 20 / signal 25 / narrative 40.
Sentiment: bullish 25 / bearish 10 / panic 3 / hype 0 / news 4 / shill 0.

Core Narratives

A. Crypto / On-chain
1. bitcoin heat 15 (-5 vs previous, neutral)
   BlackRock ETF reportedly sold $448.33M worth of Bitcoin...

B. AI / Macro / Geopolitics
1. ai heat 20 (-2 vs previous, neutral)
   Grok Build release notes will be published daily...

X x Market Cross-Validation
- $BTC: early narrative / X sentiment bullish / 24h +0.35%
```

## JSON Output

The daily output is meant to be machine-readable by another agent:

```json
{
  "status": "ok",
  "timestamp": "2026-05-20T05:50:40.326Z",
  "runTime": "140s",
  "scrape": {
    "totalTweets": 91,
    "sources": {
      "list": 20,
      "signal": 25,
      "narrative": 40,
      "trending": 15
    }
  },
  "analysis": {
    "sentimentSummary": {
      "bullish": 25,
      "bearish": 10,
      "panic": 3,
      "hype": 0,
      "news": 4,
      "shill": 0
    },
    "tokenMentions": [
      { "token": "BTC", "count": 2 }
    ],
    "keywordHeat": [
      {
        "keyword": "bitcoin",
        "current": 15,
        "previous": 20,
        "change": -5
      }
    ],
    "crossValidation": [
      {
        "token": "BTC",
        "mentions": 2,
        "xSentiment": "bullish",
        "verdict": {
          "label": "early narrative",
          "reason": "X heat is rising but price has not moved significantly"
        }
      }
    ]
  }
}
```

## Analysis Features

### Sentiment Classification

Each tweet is classified into:

- `bullish`
- `bearish`
- `panic`
- `hype`
- `news`
- `shill`
- `neutral`

The current classifier is rule-based. It supports English and selected Chinese keywords. For higher precision, add an LLM-based second pass for high-impact tweets.

### Market Relevance Filter

The filter covers:

- Crypto and on-chain topics
- AI and agent topics
- Macro and interest rates
- Finance and equities
- Geopolitics, oil, and gold
- Selected Chinese market keywords

This allows broader risk sentiment to appear without mixing all topics into one board.

### Narrative Boards

Narratives are split into:

```text
Crypto / On-chain
AI / Macro / Geopolitics
```

This prevents high-visibility AI or macro posts from burying crypto-specific signals.

### Engagement Ranking

The rough scoring formula is:

```text
likes + reposts * 2 + replies * 3 + views * 0.002
```

The view weight is intentionally small. Views matter, but they should not completely dominate crypto signal quality.

### Top Views Ranking

The report also includes a separate highest-viewed list. This catches high-reach market posts that may have lower engagement.

### Cross-Validation Labels

For high-frequency crypto tokens, the report assigns:

- `early narrative`: X heat is rising, price has not moved much
- `possible pump`: X heat plus price and volume surge
- `high risk`: X is hot but DEX liquidity is weak
- `risk-off`: bearish or panic X sentiment plus price or funding stress
- `watching`: no strong confirmation yet

## OpenClaw Integration

Place `SKILL.md` into your OpenClaw workspace skills directory.

Example usage:

```text
Use the x-agent skill. Run the daily X report and send every Telegram part to me in order.
```

Recommended command:

```bash
cd /path/to/x-agent
node daily-run.mjs --telegram-parts
```

The command prints JSON:

```json
{
  "status": "ok",
  "parts": [
    "Part 1...",
    "Part 2..."
  ],
  "savedDaily": "/path/to/daily-output.json"
}
```

Your agent should send each item in `parts` as a separate Telegram message.

## Standalone Cron Example

```cron
0 8 * * * cd /path/to/x-agent && /usr/bin/node daily-run.mjs --telegram-parts >> /tmp/x-agent.log 2>&1
```

If you want Telegram delivery, run the command from your agent framework or write a small Telegram sender around the returned `parts`.

## Security

- Do not commit `x-twitter.json`.
- Do not log real cookies.
- Do not print secrets in Telegram.
- Use a dedicated X account for automation.
- Prefer read-only analysis before enabling posting, liking, or replying.

Recommended `.gitignore`:

```gitignore
node_modules/
.env
*.log
data/
.openclaw/
secrets/
x-twitter.json
```

## Limitations

- X layout changes can break scraping selectors.
- X may rate-limit or block automated sessions.
- Rule-based sentiment can misread sarcasm or nuanced posts.
- Sample size is limited, usually around 80-150 tweets per full run.
- Token extraction can still produce false positives.
- Cross-validation is correlational, not predictive.
- This is not a trading system.

## Suggested Next Upgrades

- LLM-based sentiment classification for high-impact tweets.
- Semantic narrative clustering.
- Account tiering: official, news, analyst, trader, macro, shill/noise.
- Historical backtesting of narrative heat versus future price movement.
- Trader-agent-ready JSON schema with confidence scores.
- Alert mode for sudden narrative spikes.

## License

MIT

## Acknowledgments

- [Playwright](https://playwright.dev/) for browser automation
- [Binance](https://www.binance.com/) public market data
- [CoinGecko](https://www.coingecko.com/) public market data
- [Dexscreener](https://dexscreener.com/) public market data

