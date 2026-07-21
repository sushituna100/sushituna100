"""A small, honest, walk-forward backtester.

It replays the series bar by bar. At each bar it asks the strategy for a signal
using *only* data up to and including that bar, and it acts only when the signal
is newly triggered on that bar (``trigger_index == last``) — so there is no
look-ahead. Entries fill at the next bar's open; exits are stop, first target, or
a time stop, checked bar by bar.

Results are reported in **R-multiples** (profit/loss as a multiple of the money
risked to the stop). R is the right unit because it is independent of position
size and account equity, so it measures the *edge* rather than the bet size.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from .datafeed import Series
from .strategy import Strategy, StrategyConfig
from . import wyckoff as wy


@dataclass
class Trade:
    symbol: str
    direction: str
    setup: str
    entry_time: datetime
    entry: float
    stop: float
    target: float
    exit_time: Optional[datetime] = None
    exit: Optional[float] = None
    exit_reason: str = ""
    r_multiple: float = 0.0


@dataclass
class BacktestResult:
    symbol: str
    trades: List[Trade] = field(default_factory=list)

    @property
    def n(self) -> int:
        return len(self.trades)

    @property
    def wins(self) -> int:
        return sum(1 for t in self.trades if t.r_multiple > 0)

    @property
    def win_rate(self) -> float:
        return self.wins / self.n if self.n else 0.0

    @property
    def total_r(self) -> float:
        return sum(t.r_multiple for t in self.trades)

    @property
    def expectancy_r(self) -> float:
        return self.total_r / self.n if self.n else 0.0

    @property
    def profit_factor(self) -> float:
        gains = sum(t.r_multiple for t in self.trades if t.r_multiple > 0)
        losses = -sum(t.r_multiple for t in self.trades if t.r_multiple < 0)
        return gains / losses if losses else float("inf")

    @property
    def max_drawdown_r(self) -> float:
        peak = 0.0
        equity = 0.0
        dd = 0.0
        for t in self.trades:
            equity += t.r_multiple
            peak = max(peak, equity)
            dd = min(dd, equity - peak)
        return dd

    def summary(self) -> str:
        if not self.n:
            return f"{self.symbol}: no trades triggered over the sample."
        return (
            f"{self.symbol}: {self.n} trades | win {self.win_rate:.0%} | "
            f"expectancy {self.expectancy_r:+.2f}R | total {self.total_r:+.2f}R | "
            f"profit factor {self.profit_factor:.2f} | maxDD {self.max_drawdown_r:.2f}R"
        )


def run_backtest(
    series: Series,
    config: Optional[StrategyConfig] = None,
    max_hold: int = 30,
    warmup: Optional[int] = None,
) -> BacktestResult:
    strat = Strategy(config)
    wcfg = strat.cfg.wyckoff
    warmup = warmup or (wcfg.range_lookback + wcfg.trigger_bars + wcfg.pre_trend_lookback + wcfg.atr_period + 5)

    result = BacktestResult(series.symbol)
    bars = series.bars
    n = len(bars)
    in_trade_until = -1  # bar index the current trade closed on; no overlap

    for t in range(warmup, n - 1):
        if t <= in_trade_until:
            continue
        window = Series(series.symbol, bars[: t + 1])
        sig = strat.evaluate(window)
        if sig is None or sig.direction != "long":
            continue  # backtest only takes the long side by default
        # Act only on a freshly-triggered signal on this bar.
        # (generate_signal reports the trigger index inside the last trigger window;
        #  we require it to be the final bar so entries are causal.)
        state = _last_trigger_index(window, strat.cfg)
        if state != t:
            continue
        if not sig.is_actionable(strat.cfg.signal):
            continue

        entry = bars[t + 1].open
        stop = sig.stop
        target = sig.targets[0]
        risk = entry - stop
        if risk <= 0:
            continue

        trade = Trade(series.symbol, "long", sig.setup, bars[t + 1].t, entry, stop, target)
        exit_idx = None
        for k in range(t + 1, min(t + 1 + max_hold, n)):
            b = bars[k]
            if b.low <= stop:  # conservative: stop checked before target
                trade.exit, trade.exit_reason, exit_idx = stop, "stop", k
                break
            if b.high >= target:
                trade.exit, trade.exit_reason, exit_idx = target, "target", k
                break
        if exit_idx is None:
            exit_idx = min(t + max_hold, n - 1)
            trade.exit, trade.exit_reason = bars[exit_idx].close, "time"
        trade.exit_time = bars[exit_idx].t
        trade.r_multiple = (trade.exit - entry) / risk
        result.trades.append(trade)
        in_trade_until = exit_idx

    return result


def _last_trigger_index(series: Series, cfg) -> Optional[int]:
    state = wy.analyze(series, cfg.wyckoff)
    return state.trigger_index
