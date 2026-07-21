"""Command-line interface.

    wyckoff-bot demo                       # run the whole pipeline on synthetic data
    wyckoff-bot analyze data/GLD.csv       # Wyckoff structure + signal for one file
    wyckoff-bot scan data/*.csv            # rank trade plans across a universe
    wyckoff-bot backtest data/GLD.csv      # walk-forward R-multiple stats

CSV headers: time/date, open, high, low, close, volume.
This CLI only *analyzes and proposes*. It never connects to a broker or places
an order — that path is the Robinhood agentic runbook (agent/ROBINHOOD_AGENT.md).
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from typing import Dict, List

from .datafeed import Series, load_csv
from . import wyckoff as wy
from .strategy import Strategy, StrategyConfig
from .backtest import run_backtest
from .synth import make_accumulation


def _load_many(patterns: List[str]) -> Dict[str, Series]:
    universe: Dict[str, Series] = {}
    for pat in patterns:
        for path in sorted(glob.glob(pat)) or [pat]:
            s = load_csv(path)
            universe[s.symbol] = s
    return universe


def cmd_demo(args) -> int:
    series = make_accumulation()
    print("== Wyckoff structure ==")
    state = wy.analyze(series)
    print(state.describe())
    print("\n== Signal ==")
    strat = Strategy()
    sig = strat.evaluate(series)
    if not sig:
        print("no signal")
        return 0
    print(json.dumps(sig.to_dict(), indent=2))
    print("\n== Trade plan ==")
    plans = strat.scan({series.symbol: series})
    for p in plans:
        print(p.summary())
    return 0


def cmd_analyze(args) -> int:
    series = load_csv(args.path)
    print(wy.analyze(series).describe())
    sig = Strategy(_config(args)).evaluate(series)
    print()
    if sig:
        print(json.dumps(sig.to_dict(), indent=2))
    else:
        print(f"{series.symbol}: no actionable signal")
    return 0


def cmd_scan(args) -> int:
    universe = _load_many(args.paths)
    strat = Strategy(_config(args))
    plans = strat.scan(universe)
    if not plans:
        print("No setups found in the universe.")
        return 0
    if args.json:
        print(json.dumps([p.to_dict() for p in plans], indent=2))
        return 0
    for p in plans:
        print(p.summary())
        print()
    actionable = [p for p in plans if p.actionable]
    print(f"{len(actionable)} actionable of {len(plans)} setups.")
    return 0


def cmd_backtest(args) -> int:
    universe = _load_many(args.paths)
    for sym, series in universe.items():
        res = run_backtest(series, _config(args), max_hold=args.max_hold)
        print(res.summary())
    return 0


def _config(args) -> StrategyConfig:
    if getattr(args, "config", None):
        from .config import load_config, strategy_config_from_dict
        cfg = strategy_config_from_dict(load_config(args.config))
    else:
        cfg = StrategyConfig()
    if getattr(args, "equity", None):
        cfg.risk.account_equity = args.equity
    if getattr(args, "risk_pct", None):
        cfg.risk.risk_per_trade_pct = args.risk_pct
    if getattr(args, "allow_short", False):
        cfg.allow_short = True
    return cfg


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="wyckoff-bot", description="Wyckoff swing strategy engine (analysis only).")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="run the pipeline on built-in synthetic data")
    d.set_defaults(func=cmd_demo)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", help="path to a YAML/JSON strategy config")
    common.add_argument("--equity", type=float, help="account equity for sizing")
    common.add_argument("--risk-pct", dest="risk_pct", type=float, help="fraction risked per trade, e.g. 0.005")
    common.add_argument("--allow-short", action="store_true", help="enable short-side plans")

    a = sub.add_parser("analyze", parents=[common], help="analyze one CSV")
    a.add_argument("path")
    a.set_defaults(func=cmd_analyze)

    s = sub.add_parser("scan", parents=[common], help="rank plans across CSVs")
    s.add_argument("paths", nargs="+")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_scan)

    b = sub.add_parser("backtest", parents=[common], help="walk-forward backtest")
    b.add_argument("paths", nargs="+")
    b.add_argument("--max-hold", type=int, default=30)
    b.set_defaults(func=cmd_backtest)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
