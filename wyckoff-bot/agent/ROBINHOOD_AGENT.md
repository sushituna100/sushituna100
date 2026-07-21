# Running the Wyckoff strategy with Robinhood Agentic (MCP)

This is the execution layer. The Python library (`wyckoff_bot`) does the
**deterministic detection**; the **Robinhood MCP tools** supply live data and
place orders. The division of labor is deliberate:

> **Detection is automated. Execution is human-gated.** The bot *proposes*
> trades. A human confirms each one. Only then does the agent place an order —
> a marketable-limit entry immediately paired with a protective stop.

## 0. Hard safety gates (the agent must enforce these itself)

These are independent of the library's checks — belt and suspenders.

1. **Agentic account only.** `place_equity_order` / `review_equity_order` require
   an account with `agentic_allowed = true`. Confirm with `get_accounts`. Never
   guess an account number.
2. **Review, then explicit confirmation, for every order.** Always call
   `review_equity_order` first, show the estimated cost and any alerts, and get a
   clear "yes, place it" from the human for *that specific order*. A generic
   "run the strategy" is **not** authorization to place trades.
3. **Never a naked market order.** Use a **marketable limit** (limit at/just
   through the ask) for price protection. Outside regular hours, use limit orders
   with the correct `market_hours`.
4. **Every entry gets a protective stop, placed immediately.** A position is not
   "open" until its stop order is live. No stop → close the position.
5. **Respect the risk budget.** Per-trade risk ≤ 0.5% of equity; ≤ 20% equity per
   name; ≤ 5 open positions; ≤ 2% total open risk. If a plan violates a cap,
   don't place it.
6. **Daily-loss kill switch.** If realized P&L for the day ≤ −3% of equity, stop
   opening new positions for the day.
7. **Long-only unless the human explicitly enabled shorts** (and understands
   margin). Distribution signals on names you *don't* hold are "avoid," not
   "short."
8. **Swing cadence, not day-trading.** Evaluate on **daily** bars, once per day.
   Don't churn intraday.

## 1. Session setup (once per run)

```
get_accounts()                      # pick the agentic_allowed account_number
get_portfolio(account_number)       # equity + buying power  -> RiskConfig.account_equity
get_equity_positions(account_number)# current holdings -> PortfolioState.open_positions
```

Set `RiskConfig.account_equity` from real equity. Seed `PortfolioState` with open
positions so the guards (max positions, duplicate symbol, aggregate risk) are
accurate.

## 2. Pull data for the universe

For each symbol in the configured universe (default: `SPY QQQ IWM GLD SLV USO
GDX XLE`), fetch ~1–2 years of **daily** bars:

```
get_equity_historicals(symbols=[SYM], interval="day",
                       start_time="<~500 calendar days ago>Z",
                       adjustment_type="split")
```

Convert the response to a `Series` with
`wyckoff_bot.datafeed.from_robinhood_historicals(sym, payload)`.

Optional cross-check: `get_equity_technical_indicators` can recompute RSI/ATR/OBV
server-side to sanity-check the library's values (they use the same Wilder
conventions, so they should match closely).

## 3. Generate proposals

```python
from wyckoff_bot.strategy import Strategy, StrategyConfig
from wyckoff_bot.risk import PortfolioState, OpenPosition

cfg = StrategyConfig()
cfg.risk.account_equity = <equity from get_portfolio>
strat = Strategy(cfg)
plans = strat.scan(universe, portfolio=<PortfolioState from positions>)
actionable = [p for p in plans if p.actionable]
```

Present `p.summary()` for each actionable plan: symbol, setup, entry, stop,
targets, size, reward:risk, confidence, and the reasons. **Stop here and let the
human choose.** Do not proceed to orders unprompted.

## 4. Place an approved trade (per plan, after the human says yes)

Entry (marketable limit buy):

```
review_equity_order(account_number, symbol=p.symbol, side="buy",
                    type="limit", quantity=p.shares, limit_price=p.limit_price,
                    time_in_force="gfd")
# -> show estimated cost + alerts, get explicit confirmation, then:
place_equity_order(account_number, symbol=p.symbol, side="buy",
                   type="limit", quantity=p.shares, limit_price=p.limit_price,
                   time_in_force="gfd", ref_id=<fresh UUID>)
```

Protective stop (place as soon as the entry fills — check `get_equity_orders`):

```
place_equity_order(account_number, symbol=p.symbol, side="sell",
                   type="stop_market", quantity=<filled qty>,
                   stop_price=p.stop_price, time_in_force="gtc",
                   ref_id=<fresh UUID>)
```

Reuse the **same `ref_id`** only when retrying a transient failure of the *same*
logical order; use a **new** `ref_id` for a genuinely new order.

## 5. Manage open positions

On each daily run, for every held name:
- If price reached **target 1**, propose taking partial/*full* profit (and/or
  trailing the stop up to breakeven / under the last LPS).
- If a **distribution** signal (UTAD / SOW) appears on a held name, propose an
  **exit** (this is the long-only "sell" path).
- If the stop was hit, confirm the position closed and update the daily P&L for
  the kill-switch check.

## 6. Logging

Append every proposal and every placed order (with `ref_id`, fills, stop) to a
journal so runs are auditable and expectancy can be measured over time.

---

## Paste-ready system prompt for a Robinhood agent

> You are a disciplined Wyckoff swing-trading assistant with Robinhood MCP tools.
> Trade **daily** bars on this universe: SPY, QQQ, IWM, GLD, SLV, USO, GDX, XLE.
> Use the `wyckoff_bot` library for all detection and sizing — never eyeball
> charts. Each run: read the agentic account and portfolio, pull ~1–2y daily
> bars per symbol, run `Strategy.scan`, and present the actionable `TradePlan`s
> with their reasons. **Never place an order without first calling
> `review_equity_order` and getting my explicit confirmation for that specific
> order.** Every entry is a marketable limit; every entry gets a `stop_market`
> protective stop placed immediately after it fills. Enforce: ≤0.5% equity risk
> per trade, ≤20% equity per name, ≤5 open positions, ≤2% total open risk, and a
> −3%/day kill switch. Long-only. If a rule blocks a trade, skip it and tell me
> why. This is not financial advice; when unsure, stop and ask.
