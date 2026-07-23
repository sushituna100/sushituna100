# Wyckoff Routines (scheduled automation)

Three routines run this project on a daily/weekly cadence. **Execution mode is
propose-and-confirm:** the routines analyze, stage, and notify — but no real order
is placed until you reply "yes".

## ⚠️ Connector requirement (read this first)

Each routine fires into a **fresh session** that must have **both**:
1. this repo checked out (so `wyckoff-bot/CLAUDE.md` loads), and
2. your **Robinhood MCP connector** attached (so `mcp__robinhood__*` tools work).

Routines created from inside an agent session may **not** carry the Robinhood
connector into their fired sessions. If a routine runs and reports it "can't reach
the account / no Robinhood tools," the connector didn't attach. **The reliable fix
is to create these routines from the claude.ai Routines UI** (or the Claude Code
Routines interface), where you can attach the Robinhood connector to the routine.
Copy each spec below into a new routine there.

Schedules are **US Eastern** (market time), shown with the UTC cron actually
stored. Eastern is currently EDT (UTC−4); when the US switches to EST (UTC−5) in
November, shift each UTC time +1 hour if you want to keep the same Eastern clock
time.

---

## 1. Daily Scan → Watchlist

- **When:** weekdays 5:15 PM ET (after the daily bar closes) · cron `15 21 * * 1-5` UTC
- **Notifications:** push
- **Trades?** No — analysis + watchlist only.

**Prompt:**

> You are the DAILY WYCKOFF SCAN routine for this project. This is a fresh session — start by reading and following `wyckoff-bot/CLAUDE.md` in this repo (the strategy program). Analysis and watchlist ONLY: do NOT place, modify, or cancel any orders in this routine.
>
> Using the Robinhood MCP tools, on DAILY bars, scan this universe for Wyckoff long setups: GLD, SPY, USO, GDX, SLV, QQQ, IWM, XLE.
>
> For each symbol: (1) fetch ~250 daily bars plus RSI(14), OBV, MFI(14), ATR(14), ADX(14); (2) apply CLAUDE.md Steps 1–6 (range, context, trigger, confirmation, entry model, two-layer stop, targets); (3) note the sentiment/regime read once (VIX via get_indexes→get_index_quotes, and SPY's trend).
>
> Maintain a Robinhood watchlist named "Wyckoff Watch" (create if missing): add symbols with a valid/developing long setup plus a short note, remove those that no longer qualify. Finish with a concise ranked summary (symbol, setup, confidence, entry zone, thesis-stop, broker-stop, R:R, regime) and push a notification naming the top 1–2 candidates.

## 2. Daily Execute — Propose & Confirm

- **When:** weekdays 9:45 AM ET (just after the open) · cron `45 13 * * 1-5` UTC
- **Notifications:** push + email
- **Trades?** Only after you reply "yes" in the fired session. Stages nothing otherwise.

**Prompt:**

> You are the DAILY WYCKOFF EXECUTION routine, running in PROPOSE-AND-CONFIRM mode: do the full analysis and STAGE orders, but PLACE NOTHING until the human replies "yes" in this session. Read and follow `wyckoff-bot/CLAUDE.md` first.
>
> Using the Robinhood MCP tools: (1) get_accounts → the agentic_allowed account (else STOP+notify); get_portfolio; get_equity_positions. (2) Review open positions per CLAUDE.md Step 9 and list any needed management (break-even move at +1R, trail under the last higher low, partial at target 1, exit on thesis-stop breach or Upthrust/UTAD/SOW) as PROPOSED actions — existing broker stops stay live. (3) Sentiment/regime gate: VIX + SPY; no new longs if risk-off. (4) Pick the single best A-grade LONG from "Wyckoff Watch" passing ALL of: symbol in approved set {GLD, SPY, USO} (SLV excluded, GDX watch-only); confirmed entry model; ≥3 confirmations; R:R ≥ 1.8; all hard caps (0.5% risk, ≤20%/name, ≤5 positions, ≤2% total open risk, −3%/day kill switch). (5) Call review_equity_order to get cost/alerts, present ONE plan, and END THE TURN WITHOUT PLACING. (6) Notify push+email: "proposal ready — reply yes to place" (or "no action").
>
> WHEN THE HUMAN APPROVES: place the marketable-limit entry (fresh ref_id), then IMMEDIATELY the protective stop_market (GTC) below the wick. Never a naked market order; never a non-agentic account.

## 3. Sunday Runbook + Backtest

- **When:** Sunday 5:00 PM ET · cron `0 21 * * 0` UTC
- **Notifications:** push + email
- **Trades?** No — review + validation only.

**Prompt:**

> You are the WEEKLY WYCKOFF RUNBOOK (Sunday review). Read and follow `wyckoff-bot/CLAUDE.md`. Do NOT place trades. Use the Robinhood MCP tools plus the wyckoff-bot Python backtester.
>
> (1) WEEK IN REVIEW: get_portfolio, get_equity_positions, get_realized_pnl, get_pnl_trade_history — summarize positions vs. thesis/stop/target, weekly realized+unrealized P&L, and flag any plan deviations. (2) RE-VALIDATE: pull ~2y daily bars for GLD, SPY, USO, GDX, SLV, save CSVs under `wyckoff-bot/data/`, run `PYTHONPATH=src python3 -m wyckoff_bot.cli backtest data/<SYM>.csv` each, report expectancy(R)/win%/profit-factor/maxDD, and recompute the approved set (positive expectancy AND profit factor > 1.3 AND not outlier-dependent) — state APPROVED / WATCH-ONLY / EXCLUDED and any change from baseline (GLD, SPY, USO approved; GDX watch-only; SLV excluded). (3) Refresh "Wyckoff Watch" and note the regime. (4) Push+email a concise weekly report.

---

## Baseline from the initial backtest (2023→2026, real daily data)

| Symbol | Trades | Win% | Total R | Profit factor | Verdict |
|---|---|---|---|---|---|
| GLD | 12 | 50% | +9.2 | 2.61 | ✅ approved |
| SPY | 34 | 44% | +20.8 | 2.15 | ✅ approved |
| USO | 12 | 58% | +10.2 | 3.04 | ✅ approved |
| GDX | 21 | 29% | +11.7 | 1.78 | ⚠️ watch-only (outlier-dependent) |
| SLV | 10 | 20% | −3.4 | 0.57 | ❌ excluded |

Small samples, no slippage/fees modeled — a filter, not a guarantee. The Sunday
routine refreshes this weekly.
