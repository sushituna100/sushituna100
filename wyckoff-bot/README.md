# wyckoff-bot

A **Wyckoff-method swing-trading agent** for **Robinhood agentic (MCP)** —
finding trades by reading crowd psychology in price and volume, confirming them
with independent indicators, and executing behind a human-confirmed, capped-risk
gate.

> **This project is entirely markdown — there is no code.** **[CLAUDE.md](CLAUDE.md)**
> *is* the program: an agent (Claude) reads it and executes the strategy directly
> against the Robinhood MCP tools — detection, risk sizing, order placement, and
> three scheduled routines (daily scan, daily propose-and-confirm execution,
> Sunday review + validation). Nothing to install or run.
>
> **Detection is automated. Execution is human-gated.** The agent only ever
> *proposes* trades; nothing places until you reply "yes" to that specific order.
>
> **Not financial advice.** Educational tooling. Currently running in
> **testing mode** — small, capped position sizes while the strategy proves
> itself live (see CLAUDE.md's Testing Mode section).

## Why Wyckoff, and what to trade

Wyckoff reads the **crowd** — panic bottoms and euphoric tops — and positions
*with* the institutional "Composite Operator" against it. That is the "market
sentiment / mob mentality" edge. It is **not** a commodity-picking system: it
works on any **liquid, institution-driven** instrument. On Robinhood (no
futures), the practical universe is **liquid ETFs and large-caps** — including
**commodity ETFs** (GLD, SLV, USO) if you want commodity exposure.

Full research, event definitions, and the safety/instrument-selection rationale:
**[STRATEGY.md](STRATEGY.md)**.

## Files

| File | Role |
|---|---|
| **[CLAUDE.md](CLAUDE.md)** | The entire program: detection rules, setup-aware confirmation, wick-resistant stop-loss engineering, sizing, sentiment gate, script-free backtest validation, execution steps, and the three scheduled routines. |
| **[STRATEGY.md](STRATEGY.md)** | The research/due-diligence behind the method — the three Wyckoff laws, the accumulation/distribution schematics, and why this universe was chosen. |

## Current universe (live on the "Wyckoff Watch" Robinhood watchlist)

| Symbol | Status |
|---|---|
| USO | ✅ Approved for execution |
| GDX, XLE | ✅ Approved (provisional) |
| SLV | ❌ Excluded (failed validation) |

`GLD, SPY, QQQ, IWM` were removed from the universe 2026-08-13 — their share
prices are too high for this account's sizing to ever clear a nonzero
position, so tracking them wasted analysis effort for zero possible trades.
Not a statement on their Wyckoff edge (see STRATEGY.md).

This table is refreshed by the Sunday routine; the authoritative copy lives in
CLAUDE.md's Universe section.

## Safety model

- **Setup-aware confirmation:** springs/upthrusts require **divergence + volume
  dry-up + close rejection** (raw momentum is meaningless at a reversal);
  breakouts require **momentum/trend alignment**. A trigger is only *actionable*
  after clearing confidence, confirmation-count, and reward:risk floors.
- **Sizing:** 2% of equity risked per trade (elevated to clear the whole-share
  floor on a small account), ≤50% per name, ≤1 open position at a time, ≤2%
  total open risk, −1.5%/day kill switch, plus a buying-power precondition
  before staging.
- **Two-layer stop-loss:** an agent-managed thesis stop on a daily close (so
  intraday wicks don't fake you out) plus an always-live broker catastrophe stop
  placed below the wick zone.
- **Protective stop on every entry; long-only** by default.
- **review → confirm → place** gate on every order; only `agentic_allowed`
  accounts are touched.

## Disclaimer

For research and education. Markets involve risk of loss; past behavior does not
predict future results. Nothing here is financial advice. You are responsible for
every order placed through your account.
