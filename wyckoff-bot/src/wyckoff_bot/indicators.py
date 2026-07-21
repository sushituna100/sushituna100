"""Dependency-free technical indicators.

All functions take plain lists of floats and return lists of the same length,
with ``None`` in the warm-up region so results stay index-aligned with the input
bars. Smoothing follows Wilder's method where that is the platform convention
(RSI, ATR, ADX, MFI), so values here match what Robinhood's
``get_equity_technical_indicators`` reports for the same series.

These are the confirmation layer for Wyckoff structure:
  * OBV / MFI  -> the "effort" side of Wyckoff's effort-vs-result law
  * ATR        -> volatility unit for stops and for scaling "wide spread"
  * RSI        -> momentum / divergence at springs and upthrusts
  * EMA/SMA    -> trend context and the "reclaim the mean" confirmation
  * ADX        -> trend-vs-range regime filter (Wyckoff ranges want low ADX)
  * rel_volume -> climactic vs. dried-up volume around key events
"""

from __future__ import annotations

from typing import List, Optional, Sequence

Num = Optional[float]


def sma(values: Sequence[float], period: int) -> List[Num]:
    out: List[Num] = [None] * len(values)
    if period <= 0:
        raise ValueError("period must be positive")
    run = 0.0
    for i, v in enumerate(values):
        run += v
        if i >= period:
            run -= values[i - period]
        if i >= period - 1:
            out[i] = run / period
    return out


def ema(values: Sequence[float], period: int) -> List[Num]:
    out: List[Num] = [None] * len(values)
    if period <= 0:
        raise ValueError("period must be positive")
    if len(values) < period:
        return out
    k = 2.0 / (period + 1.0)
    seed = sum(values[:period]) / period  # seed EMA with the first SMA
    out[period - 1] = seed
    prev = seed
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi(values: Sequence[float], period: int = 14) -> List[Num]:
    out: List[Num] = [None] * len(values)
    if len(values) <= period:
        return out
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        ch = values[i] - values[i - 1]
        gains += max(ch, 0.0)
        losses += max(-ch, 0.0)
    avg_gain = gains / period
    avg_loss = losses / period
    out[period] = _rsi_from(avg_gain, avg_loss)
    for i in range(period + 1, len(values)):
        ch = values[i] - values[i - 1]
        gain = max(ch, 0.0)
        loss = max(-ch, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = _rsi_from(avg_gain, avg_loss)
    return out


def _rsi_from(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def true_ranges(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]) -> List[float]:
    tr: List[float] = []
    for i in range(len(highs)):
        if i == 0:
            tr.append(highs[i] - lows[i])
        else:
            pc = closes[i - 1]
            tr.append(max(highs[i] - lows[i], abs(highs[i] - pc), abs(lows[i] - pc)))
    return tr


def atr(highs, lows, closes, period: int = 14) -> List[Num]:
    tr = true_ranges(highs, lows, closes)
    out: List[Num] = [None] * len(tr)
    if len(tr) < period:
        return out
    prev = sum(tr[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(tr)):
        prev = (prev * (period - 1) + tr[i]) / period
        out[i] = prev
    return out


def obv(closes: Sequence[float], volumes: Sequence[float]) -> List[float]:
    out: List[float] = [0.0] * len(closes)
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            out[i] = out[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            out[i] = out[i - 1] - volumes[i]
        else:
            out[i] = out[i - 1]
    return out


def mfi(highs, lows, closes, volumes, period: int = 14) -> List[Num]:
    n = len(closes)
    out: List[Num] = [None] * n
    if n <= period:
        return out
    tp = [(highs[i] + lows[i] + closes[i]) / 3.0 for i in range(n)]
    pos = [0.0] * n
    neg = [0.0] * n
    for i in range(1, n):
        rmf = tp[i] * volumes[i]
        if tp[i] > tp[i - 1]:
            pos[i] = rmf
        elif tp[i] < tp[i - 1]:
            neg[i] = rmf
    for i in range(period, n):
        p = sum(pos[i - period + 1 : i + 1])
        ng = sum(neg[i - period + 1 : i + 1])
        if ng == 0:
            out[i] = 100.0
        else:
            out[i] = 100.0 - 100.0 / (1.0 + p / ng)
    return out


def rolling_vwap(highs, lows, closes, volumes, period: int = 20) -> List[Num]:
    n = len(closes)
    out: List[Num] = [None] * n
    tp = [(highs[i] + lows[i] + closes[i]) / 3.0 for i in range(n)]
    for i in range(period - 1, n):
        pv = 0.0
        vv = 0.0
        for j in range(i - period + 1, i + 1):
            pv += tp[j] * volumes[j]
            vv += volumes[j]
        out[i] = pv / vv if vv else None
    return out


def adx(highs, lows, closes, period: int = 14):
    """Return (plus_di, minus_di, adx) as three index-aligned lists."""
    n = len(highs)
    plus_di: List[Num] = [None] * n
    minus_di: List[Num] = [None] * n
    adx_out: List[Num] = [None] * n
    if n <= 2 * period:
        return plus_di, minus_di, adx_out

    tr = true_ranges(highs, lows, closes)
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0

    # Wilder smoothing of TR / +DM / -DM starting at index `period`.
    str_ = sum(tr[1 : period + 1])
    spdm = sum(plus_dm[1 : period + 1])
    smdm = sum(minus_dm[1 : period + 1])

    dx_series: List[Num] = [None] * n
    for i in range(period, n):
        if i > period:
            str_ = str_ - str_ / period + tr[i]
            spdm = spdm - spdm / period + plus_dm[i]
            smdm = smdm - smdm / period + minus_dm[i]
        pdi = 100.0 * spdm / str_ if str_ else 0.0
        mdi = 100.0 * smdm / str_ if str_ else 0.0
        plus_di[i] = pdi
        minus_di[i] = mdi
        denom = pdi + mdi
        dx_series[i] = 100.0 * abs(pdi - mdi) / denom if denom else 0.0

    # ADX = Wilder average of DX, first value at index 2*period-1.
    first = 2 * period - 1
    if first < n:
        window = [dx_series[i] for i in range(period, first + 1) if dx_series[i] is not None]
        if window:
            prev = sum(window) / len(window)
            adx_out[first] = prev
            for i in range(first + 1, n):
                if dx_series[i] is not None:
                    prev = (prev * (period - 1) + dx_series[i]) / period
                    adx_out[i] = prev
    return plus_di, minus_di, adx_out


def relative_volume(volumes: Sequence[float], period: int = 20) -> List[Num]:
    """volume divided by its trailing average -> 1.0 == average, 2.0 == 2x."""
    avg = sma(list(volumes), period)
    out: List[Num] = [None] * len(volumes)
    for i, a in enumerate(avg):
        if a and a > 0:
            out[i] = volumes[i] / a
    return out


def rolling_max(values: Sequence[float], period: int) -> List[Num]:
    out: List[Num] = [None] * len(values)
    for i in range(period - 1, len(values)):
        out[i] = max(values[i - period + 1 : i + 1])
    return out


def rolling_min(values: Sequence[float], period: int) -> List[Num]:
    out: List[Num] = [None] * len(values)
    for i in range(period - 1, len(values)):
        out[i] = min(values[i - period + 1 : i + 1])
    return out


def slope(values: Sequence[Num], lookback: int) -> Optional[float]:
    """Least-squares slope of the last ``lookback`` non-None values, normalized
    per bar. Used to judge whether OBV is rising into an accumulation."""
    pts = [(i, v) for i, v in enumerate(values[-lookback:]) if v is not None]
    if len(pts) < 2:
        return None
    n = len(pts)
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    denom = n * sxx - sx * sx
    if denom == 0:
        return None
    return (n * sxy - sx * sy) / denom


def last_valid(values: Sequence[Num]) -> Optional[float]:
    for v in reversed(values):
        if v is not None:
            return v
    return None
