"""Strategy orchestrator.

Ties the pipeline together for a whole universe of symbols and emits
``TradePlan`` objects — *proposals only*. A plan carries everything the Robinhood
agentic layer needs to review and place an order (side, order type, limit price,
protective stop, share count), plus the full rationale and any risk blocks.

IMPORTANT: nothing here places an order. ``TradePlan`` is a recommendation. The
execution path is the human-gated Robinhood runbook (see agent/ROBINHOOD_AGENT.md).
Default posture is long-only (equities), dry-run, small size.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .datafeed import Series
from . import wyckoff as wy
from .signals import Signal, SignalConfig, generate_signal
from .risk import (
    RiskConfig,
    PortfolioState,
    SizingResult,
    position_size,
    check_portfolio_guards,
)


@dataclass
class StrategyConfig:
    wyckoff: wy.WyckoffConfig = field(default_factory=wy.WyckoffConfig)
    signal: SignalConfig = field(default_factory=SignalConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    allow_short: bool = False          # equities: long-only by default
    entry_slippage: float = 0.0015     # marketable-limit cushion vs. reference price
    max_plans: int = 5                 # cap proposals per run


@dataclass
class TradePlan:
    symbol: str
    side: str                    # 'buy' | 'sell'
    setup: str
    order_type: str              # suggested Robinhood order type
    limit_price: float           # entry (marketable limit)
    stop_price: float            # protective stop
    targets: List[float]
    shares: float
    notional: float
    dollar_risk: float
    reward_risk: float
    confidence: float
    actionable: bool             # passed confidence/RR/confirmations AND risk guards
    signal: Signal
    sizing: Optional[SizingResult]
    blocks: List[str] = field(default_factory=list)

    def summary(self) -> str:
        flag = "ACTIONABLE" if self.actionable else "advisory"
        head = (
            f"[{flag}] {self.symbol} {self.side.upper()} {self.setup} "
            f"| conf {self.confidence:.2f} | R:R {self.reward_risk:.2f}"
        )
        body = (
            f"    entry~{self.limit_price:.2f}  stop {self.stop_price:.2f}  "
            f"targets {', '.join(f'{t:.2f}' for t in self.targets)}\n"
            f"    size {self.shares:.4g} sh (${self.notional:.0f}, risk ${self.dollar_risk:.0f})"
        )
        reasons = "\n".join(f"      - {r}" for r in self.signal.reasons)
        blocks = ("\n    BLOCKS:\n" + "\n".join(f"      ! {b}" for b in self.blocks)) if self.blocks else ""
        return f"{head}\n{body}\n    why:\n{reasons}{blocks}"

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "setup": self.setup,
            "order_type": self.order_type,
            "limit_price": round(self.limit_price, 4),
            "stop_price": round(self.stop_price, 4),
            "targets": [round(t, 4) for t in self.targets],
            "shares": round(self.shares, 6),
            "notional": round(self.notional, 2),
            "dollar_risk": round(self.dollar_risk, 2),
            "reward_risk": round(self.reward_risk, 2),
            "confidence": round(self.confidence, 3),
            "actionable": self.actionable,
            "blocks": self.blocks,
            "signal": self.signal.to_dict(),
        }


class Strategy:
    def __init__(self, config: Optional[StrategyConfig] = None):
        self.cfg = config or StrategyConfig()

    def evaluate(self, series: Series) -> Optional[Signal]:
        return generate_signal(series, self.cfg.wyckoff, self.cfg.signal)

    def scan(
        self,
        universe: Dict[str, Series],
        portfolio: Optional[PortfolioState] = None,
    ) -> List[TradePlan]:
        portfolio = portfolio or PortfolioState(equity=self.cfg.risk.account_equity)
        signals: List[Signal] = []
        for sym, series in universe.items():
            series.symbol = sym
            sig = self.evaluate(series)
            if sig is not None:
                signals.append(sig)

        # Best structural + confirmation quality first.
        signals.sort(key=lambda s: (s.confidence, s.reward_risk), reverse=True)

        plans: List[TradePlan] = []
        # Simulate filling the portfolio as we accept plans so guards compound.
        working = PortfolioState(
            equity=portfolio.equity,
            open_positions=list(portfolio.open_positions),
            realized_pnl_today=portfolio.realized_pnl_today,
        )
        for sig in signals:
            plan = self._plan_from_signal(sig, working)
            plans.append(plan)
            if plan.actionable:
                from .risk import OpenPosition
                working.open_positions.append(
                    OpenPosition(sig.symbol, plan.shares, plan.limit_price, plan.stop_price)
                )
            if sum(1 for p in plans if p.actionable) >= self.cfg.max_plans:
                break
        return plans

    def _plan_from_signal(self, sig: Signal, portfolio: PortfolioState) -> TradePlan:
        long = sig.direction == "long"
        side = "buy" if long else "sell"

        # Marketable-limit entry: cross the spread a touch for a fill with a price cap.
        if long:
            limit_price = round(sig.entry * (1 + self.cfg.entry_slippage), 2)
        else:
            limit_price = round(sig.entry * (1 - self.cfg.entry_slippage), 2)

        actionable_signal = sig.is_actionable(self.cfg.signal)
        # Short setups are advisory-only unless explicitly enabled.
        short_blocked = (not long) and (not self.cfg.allow_short)

        sizing = position_size(limit_price, sig.stop, self.cfg.risk)
        blocks: List[str] = []
        if not actionable_signal:
            blocks.append(
                f"signal below thresholds (conf {sig.confidence:.2f}, "
                f"{sig.confirmation_count} confirms, R:R {sig.reward_risk:.2f})"
            )
        if short_blocked:
            blocks.append("short setups are advisory-only (allow_short=false) — treat as exit/avoid")
        if not sizing.approved:
            blocks.extend(sizing.reasons)
        else:
            blocks.extend(check_portfolio_guards(sig.symbol, sizing, portfolio, self.cfg.risk))

        actionable = (
            actionable_signal
            and sizing.approved
            and not short_blocked
            and not check_portfolio_guards(sig.symbol, sizing, portfolio, self.cfg.risk)
        )

        return TradePlan(
            symbol=sig.symbol,
            side=side,
            setup=sig.setup,
            order_type="limit",
            limit_price=limit_price,
            stop_price=round(sig.stop, 2),
            targets=sig.targets,
            shares=sizing.shares if sizing.approved else 0.0,
            notional=sizing.notional if sizing.approved else 0.0,
            dollar_risk=sizing.dollar_risk if sizing.approved else 0.0,
            reward_risk=sig.reward_risk,
            confidence=sig.confidence,
            actionable=actionable,
            signal=sig,
            sizing=sizing,
            blocks=blocks,
        )
