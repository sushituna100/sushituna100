"""wyckoff_bot: a Wyckoff-method swing-trading engine with multi-indicator
confirmation and hard risk controls.

The package is intentionally split so that *detection is deterministic* (plain
Python, fully testable, no chart eyeballing) while *execution stays agentic and
human-gated* (the Robinhood MCP layer, see ``agent/ROBINHOOD_AGENT.md``).

Pipeline:

    bars  ->  indicators  ->  wyckoff events/phase  ->  scored Signal
          ->  risk sizing/guards  ->  TradePlan (dry-run proposal)

Nothing in this library ever places an order. It produces *proposals*. Order
placement happens only through the Robinhood agentic runbook, behind an explicit
review-and-confirm gate.
"""

from .datafeed import Bar, Series, load_csv
from .signals import Signal, generate_signal
from .risk import RiskConfig, position_size
from .strategy import Strategy, StrategyConfig, TradePlan

__all__ = [
    "Bar",
    "Series",
    "load_csv",
    "Signal",
    "generate_signal",
    "RiskConfig",
    "position_size",
    "Strategy",
    "StrategyConfig",
    "TradePlan",
]

__version__ = "0.1.0"
