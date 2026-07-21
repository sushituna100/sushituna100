"""Deterministic synthetic price data for demos and tests.

``make_accumulation`` builds a textbook Wyckoff accumulation: a prior downtrend
(sets 'accumulation' context), a sideways range containing a selling climax and
a secondary test, then a shallow **spring** that undercuts support on light
volume and recovers — the primary long trigger. No randomness, no dependencies,
so tests are reproducible.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from .datafeed import Bar, Series


def _bar(t, o, h, l, c, v) -> Bar:
    return Bar(t=t, open=round(o, 2), high=round(h, 2), low=round(l, 2), close=round(c, 2), volume=float(v))


def make_accumulation(base_vol: float = 1_000_000.0) -> Series:
    """Return a 120-bar daily accumulation schematic ending on a spring + test."""
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    bars: List[Bar] = []
    # Planned closes per index; explicit OHLCV overrides for named events.
    overrides: Dict[int, Tuple[float, float, float, float, float]] = {
        78: (72.0, 72.5, 68.0, 69.5, 3.5),   # Selling Climax: wide down, close off low, huge vol
        82: (72.0, 77.5, 71.5, 77.0, 1.6),   # Automatic Rally: sets range top
        90: (72.0, 72.2, 68.5, 70.0, 1.1),   # Secondary Test: retest low, lighter vol
        117: (70.5, 70.5, 67.0, 69.5, 0.5),  # SPRING: undercut support, recover, dry volume
        118: (69.8, 72.0, 69.5, 71.5, 0.6),  # Test: holds above the spring low, light vol
    }

    def target_close(i: int) -> float:
        if i < 50:
            return 92.0 - 0.04 * i                      # gentle high plateau
        if i < 75:
            return 90.0 - (90.0 - 70.5) * (i - 50) / 25  # downtrend -> range (context)
        # range body: oscillate 71..76 around 73.5
        import math
        return 73.5 + 2.3 * math.sin((i - 75) * 0.7)

    prev_close = 92.0
    for i in range(120):
        t = start + timedelta(days=i)
        if i in overrides:
            o, h, l, c, vmult = overrides[i]
            bars.append(_bar(t, o, h, l, c, base_vol * vmult))
            prev_close = c
            continue
        c = target_close(i)
        o = prev_close
        hi = max(o, c) + 0.5
        lo = min(o, c) - 0.5
        # volume: heavier in the downtrend, average in the range
        vmult = 1.25 if 50 <= i < 75 else 1.0
        bars.append(_bar(t, o, hi, lo, c, base_vol * vmult))
        prev_close = c

    return Series("DEMO", bars)
