# wyckoff-bot

A **Wyckoff-method swing-trading engine** with multi-indicator confirmation and
hard risk controls, designed to drive **Robinhood agentic (MCP)** execution.

It reduces a discretionary method to reproducible rules: it finds the trading
range, decides accumulation vs. distribution from the prior trend, detects the
tradable events (**spring, SOS, LPS, upthrust/UTAD, SOW**), cross-examines each
with independent volume/momentum indicators, and sizes every trade to a small
fixed fraction of equity behind a protective stop.

> **Detection is automated. Execution is human-gated.** The engine only ever
> *proposes* trades. Placing an order happens through the Robinhood runbook,
> behind an explicit review-and-confirm gate. Nothing here auto-trades.
>
> **Not financial advice.** Educational tooling. Run in dry-run/paper first.

## Why Wyckoff, and what to trade

Wyckoff reads the **crowd** — panic bottoms and euphoric tops — and positions
*with* the institutional "Composite Operator" against it. That is the "market
sentiment / mob mentality" edge. It is **not** a commodity-picking system: it
works on any **liquid, institution-driven** instrument. On Robinhood (no
futures), the practical universe is **liquid ETFs and large-caps** — including
**commodity ETFs** (GLD, SLV, USO, UNG) if you want commodity exposure.

Full research, event definitions, safety rationale, and the instrument-selection
answer: **[STRATEGY.md](STRATEGY.md)**.

## Quickstart

```bash
# no dependencies required for analysis/backtest (pure stdlib)
cd wyckoff-bot
PYTHONPATH=src python3 -m wyckoff_bot.cli demo         # full pipeline on synthetic data

# with your own data (CSV: time,open,high,low,close,volume)
PYTHONPATH=src python3 -m wyckoff_bot.cli analyze data/GLD.csv
PYTHONPATH=src python3 -m wyckoff_bot.cli scan data/*.csv --equity 25000
PYTHONPATH=src python3 -m wyckoff_bot.cli backtest data/GLD.csv --max-hold 30

# or install it
pip install -e .        # then: wyckoff-bot demo
```

Example `demo` output:

```
DEMO: accumulation range [support 68.00 / resistance 77.50]
  SC       @78 68.00  rvol 2.6x panic low / possible absorption
  ST       @79 69.00  rvol 0.8x retest on lighter volume
  spring   @117 69.50 low-volume spring (rvol 0.5x, no supply)
  => TRIGGER: spring (long) @ 69.50  quality=0.78

[ACTIONABLE] DEMO BUY spring | conf 0.86 | R:R 2.16
    entry~69.60  stop 65.80  targets 77.50, 87.00
    size 13.17 sh ($917, risk $50)
    why:
      - Wyckoff spring in accumulation range (low-volume spring, no supply)
      - RSI divergence: 38 at the spring vs 23 at the prior extreme
      - volume 0.5x average at the trigger (dried up)
      - close off the low (location 0.71)
```

## How it works (pipeline)

```
bars ─▶ indicators ─▶ Wyckoff events/phase ─▶ scored Signal ─▶ risk sizing/guards ─▶ TradePlan (proposal)
       (OBV, RSI,      (range, spring, SOS,   (setup-aware      (0.5% risk, caps,     (limit entry +
        MFI, ATR,       LPS, upthrust…)        confirmation)     kill switch)          protective stop)
        ADX, VWAP)
```

| Module | Role |
|---|---|
| `datafeed.py` | `Bar`/`Series`, CSV loader, `from_robinhood_historicals` adapter |
| `indicators.py` | pure-Python SMA/EMA/RSI/ATR/OBV/MFI/VWAP/ADX/rel-volume (Wilder-smoothed) |
| `wyckoff.py` | trading-range + event/phase detection → `WyckoffState` |
| `signals.py` | **setup-aware** indicator confirmation → scored `Signal` with stop/targets |
| `risk.py` | fixed-fractional sizing, position/portfolio caps, daily kill switch |
| `strategy.py` | orchestrates a universe → ranked `TradePlan` proposals |
| `backtest.py` | walk-forward, look-ahead-free, results in **R-multiples** |
| `config.py` | load a `StrategyConfig` from YAML/JSON |
| `cli.py` | `demo` / `analyze` / `scan` / `backtest` |

## Safety model

- **Setup-aware confirmation:** springs/upthrusts require **divergence + volume
  dry-up + close rejection** (raw momentum is meaningless at a reversal);
  breakouts require **momentum/trend alignment**. A trigger is only *actionable*
  after clearing confidence, confirmation-count, and reward:risk floors.
- **Fixed-fractional sizing** (default 0.5%/trade) derived from the stop.
- **Hard caps:** ≤20% per name, ≤5 positions, ≤2% total open risk.
- **Protective stop on every entry**; **daily-loss kill switch**; **long-only**
  by default.
- The Robinhood layer adds an independent **review → confirm → place** gate and
  only touches `agentic_allowed` accounts.

See **[agent/ROBINHOOD_AGENT.md](agent/ROBINHOOD_AGENT.md)** for the execution
runbook and a paste-ready agent system prompt.

## Tests

```bash
PYTHONPATH=src python3 -m unittest discover -s tests    # 23 tests, stdlib only
```

## Making it its own repo

This project is fully self-contained in the `wyckoff-bot/` folder. To split it
into a standalone repository: copy the folder out, `git init`, and it works as-is
(the `pyproject.toml`, `src/` layout, tests, and docs travel with it).

## Disclaimer

For research and education. Markets involve risk of loss; past behavior does not
predict future results. Nothing here is financial advice. You are responsible for
every order placed through your account.
