"""Risk sizing and portfolio guards — the part that keeps a bad signal small.

The philosophy here is deliberately conservative: the edge in a discretionary
method like Wyckoff is uncertain and signals *will* be wrong, so survival comes
from fixed-fractional sizing, hard caps, and kill switches, not from conviction.

Every trade is sized so that *if the protective stop is hit*, the loss is a small
fixed fraction of equity (default 0.5%). On top of that:
  * no single position may exceed ``max_position_pct`` of equity,
  * total open risk across positions is capped (``max_portfolio_risk_pct``),
  * a per-day realized-loss kill switch halts new entries,
  * a max number of concurrent positions bounds correlation blowups.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class RiskConfig:
    account_equity: float = 10_000.0
    risk_per_trade_pct: float = 0.005      # 0.5% of equity risked to the stop
    max_position_pct: float = 0.20         # ≤20% of equity in one name
    max_open_positions: int = 5
    max_portfolio_risk_pct: float = 0.02   # ≤2% total open risk
    max_daily_loss_pct: float = 0.03       # kill switch: stop new entries for the day
    allow_fractional: bool = True
    min_notional: float = 1.0


@dataclass
class OpenPosition:
    symbol: str
    shares: float
    entry: float
    stop: float

    @property
    def open_risk(self) -> float:
        return abs(self.entry - self.stop) * self.shares


@dataclass
class SizingResult:
    approved: bool
    shares: float
    notional: float
    dollar_risk: float
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "approved": self.approved,
            "shares": round(self.shares, 6),
            "notional": round(self.notional, 2),
            "dollar_risk": round(self.dollar_risk, 2),
            "reasons": self.reasons,
        }


def position_size(
    entry: float,
    stop: float,
    cfg: RiskConfig,
) -> SizingResult:
    """Fixed-fractional sizing capped by max position size."""
    reasons: List[str] = []
    risk_per_share = abs(entry - stop)
    if risk_per_share <= 0:
        return SizingResult(False, 0, 0, 0, ["invalid stop (zero risk-per-share)"])

    dollar_risk = cfg.account_equity * cfg.risk_per_trade_pct
    raw_shares = dollar_risk / risk_per_share

    max_shares_by_position = (cfg.account_equity * cfg.max_position_pct) / entry
    shares = min(raw_shares, max_shares_by_position)
    if shares < raw_shares:
        reasons.append(f"capped by max_position_pct ({cfg.max_position_pct:.0%} of equity)")

    if not cfg.allow_fractional:
        shares = math.floor(shares)

    notional = shares * entry
    if shares <= 0 or notional < cfg.min_notional:
        return SizingResult(False, 0, 0, 0, reasons + ["position rounds to zero / below min notional"])

    actual_risk = risk_per_share * shares
    reasons.append(
        f"risk ${actual_risk:.2f} = {actual_risk / cfg.account_equity:.2%} of equity "
        f"({shares:.4g} sh @ {entry:.2f}, stop {stop:.2f})"
    )
    return SizingResult(True, shares, notional, actual_risk, reasons)


@dataclass
class PortfolioState:
    equity: float
    open_positions: List[OpenPosition] = field(default_factory=list)
    realized_pnl_today: float = 0.0

    @property
    def total_open_risk(self) -> float:
        return sum(p.open_risk for p in self.open_positions)

    def has_position(self, symbol: str) -> bool:
        return any(p.symbol == symbol for p in self.open_positions)


def check_portfolio_guards(
    symbol: str,
    proposed: SizingResult,
    portfolio: PortfolioState,
    cfg: RiskConfig,
) -> List[str]:
    """Return a list of *blocking* reasons; empty means the trade passes guards."""
    blocks: List[str] = []

    # Daily loss kill switch.
    if portfolio.realized_pnl_today <= -cfg.max_daily_loss_pct * cfg.account_equity:
        blocks.append(
            f"KILL SWITCH: daily loss {portfolio.realized_pnl_today:.2f} hit "
            f"{cfg.max_daily_loss_pct:.0%} limit — no new entries today"
        )

    # Concurrency cap.
    if len(portfolio.open_positions) >= cfg.max_open_positions:
        blocks.append(f"already at max_open_positions ({cfg.max_open_positions})")

    # One position per symbol (no pyramiding in this baseline).
    if portfolio.has_position(symbol):
        blocks.append(f"already holding {symbol}")

    # Aggregate open-risk cap.
    projected_risk = portfolio.total_open_risk + proposed.dollar_risk
    if projected_risk > cfg.max_portfolio_risk_pct * cfg.account_equity:
        blocks.append(
            f"total open risk {projected_risk:.2f} would exceed "
            f"{cfg.max_portfolio_risk_pct:.0%} portfolio cap"
        )

    return blocks
