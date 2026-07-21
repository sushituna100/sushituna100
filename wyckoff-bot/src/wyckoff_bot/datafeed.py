"""Data model and loaders.

The engine works on a ``Series`` of OHLCV ``Bar`` objects. This keeps the core
independent of *where* the data comes from: a CSV file for backtests, or the
Robinhood ``get_equity_historicals`` MCP tool at run time (see
``from_robinhood_historicals`` for the exact shape mapping).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Sequence


@dataclass(frozen=True)
class Bar:
    """A single OHLCV bar. ``t`` is the bar's open time (UTC)."""

    t: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def spread(self) -> float:
        """High-low range of the bar (Wyckoff 'spread')."""
        return self.high - self.low

    @property
    def is_up(self) -> bool:
        return self.close >= self.open

    @property
    def close_location(self) -> float:
        """Where the close sits within the bar's range, 0 (low) .. 1 (high).

        This is the VSA 'close-off-the-low' idea: a wide-spread down bar that
        closes near its high signals demand stepping in (absorption).
        """
        if self.high == self.low:
            return 0.5
        return (self.close - self.low) / (self.high - self.low)


class Series:
    """An ordered, immutable-ish collection of bars for one symbol.

    Provides cheap column views (``closes``, ``highs`` ...) so indicator code can
    stay list-oriented and dependency-free.
    """

    def __init__(self, symbol: str, bars: Sequence[Bar]):
        self.symbol = symbol
        self.bars: List[Bar] = list(bars)
        self.bars.sort(key=lambda b: b.t)

    def __len__(self) -> int:
        return len(self.bars)

    def __getitem__(self, i):
        if isinstance(i, slice):
            return Series(self.symbol, self.bars[i])
        return self.bars[i]

    def __iter__(self) -> Iterable[Bar]:
        return iter(self.bars)

    @property
    def opens(self) -> List[float]:
        return [b.open for b in self.bars]

    @property
    def highs(self) -> List[float]:
        return [b.high for b in self.bars]

    @property
    def lows(self) -> List[float]:
        return [b.low for b in self.bars]

    @property
    def closes(self) -> List[float]:
        return [b.close for b in self.bars]

    @property
    def volumes(self) -> List[float]:
        return [b.volume for b in self.bars]

    def tail(self, n: int) -> "Series":
        return Series(self.symbol, self.bars[-n:])


def _parse_ts(value: str) -> datetime:
    value = value.strip()
    # Accept unix seconds, unix millis, or ISO-8601.
    if value.isdigit():
        num = int(value)
        if num > 10_000_000_000:  # milliseconds
            num //= 1000
        return datetime.fromtimestamp(num, tz=timezone.utc)
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def load_csv(path: str, symbol: Optional[str] = None) -> Series:
    """Load a CSV with headers: time/date, open, high, low, close, volume.

    Header names are matched case-insensitively; ``time``, ``timestamp``,
    ``date`` and ``begins_at`` are all accepted for the timestamp column.
    """
    if symbol is None:
        base = path.rsplit("/", 1)[-1]
        symbol = base.split(".")[0].upper()

    time_keys = {"time", "timestamp", "date", "datetime", "begins_at", "t"}
    bars: List[Bar] = []
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        norm = {name.lower().strip(): name for name in (reader.fieldnames or [])}
        tkey = next((norm[k] for k in norm if k in time_keys), None)
        if tkey is None:
            raise ValueError(f"No time column found in {path}; headers={reader.fieldnames}")

        def col(row, *names):
            for n in names:
                if n in norm:
                    return row[norm[n]]
            raise ValueError(f"Missing one of columns {names} in {path}")

        for row in reader:
            bars.append(
                Bar(
                    t=_parse_ts(row[tkey]),
                    open=float(col(row, "open", "o")),
                    high=float(col(row, "high", "h")),
                    low=float(col(row, "low", "l")),
                    close=float(col(row, "close", "c")),
                    volume=float(col(row, "volume", "v")),
                )
            )
    return Series(symbol, bars)


def from_robinhood_historicals(symbol: str, payload: dict) -> Series:
    """Convert a Robinhood ``get_equity_historicals`` response into a ``Series``.

    The MCP tool returns bars with fields like ``begins_at``, ``open_price``,
    ``high_price``, ``low_price``, ``close_price`` and ``volume``. This helper is
    tolerant of the common field-name variants so the same code works whether you
    paste the tool output verbatim or a lightly reshaped version. Bars flagged
    ``interpolated`` (gap fillers that carry no new information) are dropped.
    """

    def pick(d: dict, *names, default=None):
        for n in names:
            if n in d and d[n] is not None:
                return d[n]
        return default

    rows = payload.get("bars") or payload.get("historicals") or payload.get("results") or payload
    if isinstance(rows, dict):
        rows = rows.get("bars") or rows.get("historicals") or []

    bars: List[Bar] = []
    for r in rows:
        if r.get("interpolated"):
            continue
        bars.append(
            Bar(
                t=_parse_ts(str(pick(r, "begins_at", "time", "t", "timestamp"))),
                open=float(pick(r, "open_price", "open", "o")),
                high=float(pick(r, "high_price", "high", "h")),
                low=float(pick(r, "low_price", "low", "l")),
                close=float(pick(r, "close_price", "close", "c")),
                volume=float(pick(r, "volume", "v", default=0.0)),
            )
        )
    return Series(symbol, bars)
