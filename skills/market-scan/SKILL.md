---
name: market-scan
description: Morning crypto trend scan — BTC/ETH and large-cap movers, market-moving news, derivatives positioning, today's macro calendar and sentiment — saved to raw/market/ with implications for altBot. Use for "market scan", "morning trend scan", "crypto news today".
---

# Market Scan

Informational only — no trade recommendations or orders.

1. **Context** — skim `wiki/topics/Crypto Trading Automation.md` and `wiki/projects/altBot.md` for the strategies and coins that matter.
2. **Research the last 24 hours**:
   - BTC and ETH: price, 24h change, key levels being discussed
   - Notable large-cap movers and why
   - Market-moving news: ETF flows, regulation, hacks, exchange incidents (CoinEx included)
   - Funding rates, open interest, liquidations — where available
   - Today's macro events (CPI, FOMC, jobs data…) with times in Tehran time
   - Fear & Greed index
3. **Write** `raw/market/YYYY-MM-DD-market-scan.md` with frontmatter (`date`, `tags: [market, crypto]`) and one section per item above. Cite every number with its source URL; mark anything you couldn't verify.

Reply in Persian: an 8–12 line summary, then `### برای altBot` — what this means for the bot (volatility regime, events or hours to avoid).
