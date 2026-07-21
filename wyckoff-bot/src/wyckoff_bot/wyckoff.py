"""Wyckoff structure detection.

This module turns a price/volume ``Series`` into an explicit, inspectable
``WyckoffState``: the trading range, whether it looks like *accumulation* or
*distribution* (decided by the trend that preceded the range), the key events,
and the single most-recent *tradable trigger* (spring, SOS, LPS, upthrust/UTAD,
SOW).

Design choices, stated plainly so nobody mistakes this for magic:

* Detection is heuristic. Wyckoff analysis is normally discretionary; here it is
  reduced to reproducible rules so a machine can apply it consistently and a
  human can audit exactly why a signal fired. Every threshold lives in
  ``WyckoffConfig`` and is meant to be tuned per instrument/timeframe.
* "Spread" and "climactic volume" are measured in *relative* units — bar range
  vs. ATR, and bar volume vs. its trailing average — so the same rules work on a
  $30 ETF and a $600 one.
* The module never decides position size or places orders. It only describes
  structure. Sizing/among-symbol selection is ``risk.py``/``strategy.py``.

Wyckoff accumulation event vocabulary (long side):
  PS  Preliminary Support   – first buying bulge inside a decline
  SC  Selling Climax        – panic low on wide spread + huge volume
  AR  Automatic Rally       – snap-back that sets the range top
  ST  Secondary Test        – retest of SC low on lighter volume
  Spring / Shakeout         – false break BELOW support, then recovery (Phase C)
  Test                      – low-volume retest of the spring low
  SOS Sign of Strength      – wide-spread rally on expanding volume (Phase D)
  LPS Last Point of Support – higher-low pullback that holds, low volume
Distribution is the mirror (BC, UTAD/Upthrust, SOW, LPSY).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from .datafeed import Series
from . import indicators as ind

# --- event / setup name constants -------------------------------------------
SC = "SC"            # Selling Climax
ST = "ST"            # Secondary Test
BC = "BC"            # Buying Climax
SPRING = "spring"
SOS = "sos_breakout"
LPS = "lps"
UPTHRUST = "upthrust"
UTAD = "utad"
SOW = "sow_breakdown"

LONG_SETUPS = {SPRING, SOS, LPS}
SHORT_SETUPS = {UPTHRUST, UTAD, SOW}


@dataclass
class WyckoffConfig:
    # window geometry (in bars)
    range_lookback: int = 40        # bars used to define the range body
    trigger_bars: int = 5           # recent bars scanned for a trigger event
    pre_trend_lookback: int = 25    # bars before the range used to classify context
    vol_avg_period: int = 20        # trailing window for relative-volume
    atr_period: int = 14

    # classification thresholds
    trend_pct: float = 0.08         # pre-range move to call accumulation/distribution
    max_range_pct: float = 0.45     # reject "ranges" taller than this fraction of price
    min_range_atr: float = 1.5      # a real range should span at least this many ATRs
    flat_drift_atr: float = 6.0     # net drift across the range body, in ATRs, to still be "sideways"

    # event thresholds (relative units)
    climax_vol_mult: float = 1.8    # volume vs. average to call a climax
    wide_spread_mult: float = 1.5   # bar range vs. ATR to call spread "wide"
    min_penetration_atr: float = 0.10  # how far below support a spring must poke
    dry_vol_mult: float = 0.85      # volume below this * average == "dried up"
    sos_vol_mult: float = 1.3       # expanding volume for a breakout
    proximity_atr: float = 1.5      # "near" support/resistance, in ATRs


@dataclass
class WyckoffEvent:
    kind: str
    index: int
    time: datetime
    price: float
    volume_note: str = ""
    detail: str = ""


@dataclass
class TradingRange:
    start: int
    end: int            # exclusive end of the range body
    support: float
    resistance: float
    context: str        # 'accumulation' | 'distribution' | 'undefined'

    @property
    def height(self) -> float:
        return self.resistance - self.support

    @property
    def mid(self) -> float:
        return (self.support + self.resistance) / 2.0


@dataclass
class WyckoffState:
    symbol: str
    trading_range: Optional[TradingRange] = None
    events: List[WyckoffEvent] = field(default_factory=list)
    setup: Optional[str] = None            # the active tradable trigger
    direction: Optional[str] = None        # 'long' | 'short'
    trigger_index: Optional[int] = None
    trigger_price: Optional[float] = None
    quality: float = 0.0                   # 0..1 structural quality of the trigger
    notes: List[str] = field(default_factory=list)

    @property
    def has_signal(self) -> bool:
        return self.setup is not None

    def describe(self) -> str:
        if not self.trading_range:
            return f"{self.symbol}: no clean trading range found."
        tr = self.trading_range
        lines = [
            f"{self.symbol}: {tr.context} range "
            f"[support {tr.support:.2f} / resistance {tr.resistance:.2f}]",
        ]
        for e in self.events:
            lines.append(f"  {e.kind:<8} @{e.index} {e.price:.2f}  {e.volume_note} {e.detail}".rstrip())
        if self.setup:
            lines.append(
                f"  => TRIGGER: {self.setup} ({self.direction}) "
                f"@ {self.trigger_price:.2f}  quality={self.quality:.2f}"
            )
        return "\n".join(lines)


def _atr_at(atr_list, i, fallback):
    v = atr_list[i] if i < len(atr_list) else None
    if v is None:
        v = ind.last_valid(atr_list[: i + 1])
    return v if v else fallback


def analyze(series: Series, cfg: Optional[WyckoffConfig] = None) -> WyckoffState:
    cfg = cfg or WyckoffConfig()
    state = WyckoffState(symbol=series.symbol)
    n = len(series)
    need = cfg.range_lookback + cfg.trigger_bars + cfg.pre_trend_lookback + cfg.atr_period
    if n < need:
        state.notes.append(f"not enough history ({n} bars, need ~{need})")
        return state

    bars = series.bars
    highs, lows, closes, vols = series.highs, series.lows, series.closes, series.volumes
    atr = ind.atr(highs, lows, closes, cfg.atr_period)
    rvol = ind.relative_volume(vols, cfg.vol_avg_period)
    atr_ref = _atr_at(atr, n - 1, (highs[-1] - lows[-1]) or 1.0)

    # ---- geometry -----------------------------------------------------------
    trig_start = n - cfg.trigger_bars
    body_start = trig_start - cfg.range_lookback
    body_end = trig_start                      # range body excludes the trigger bars
    support = min(lows[body_start:body_end])
    resistance = max(highs[body_start:body_end])
    height = resistance - support

    # ---- is this actually a range? -----------------------------------------
    if height <= 0:
        state.notes.append("degenerate range")
        return state
    if height > cfg.max_range_pct * closes[body_end - 1]:
        state.notes.append("too wide to be a consolidation (trending)")
        return state
    if height < cfg.min_range_atr * atr_ref:
        state.notes.append("range too tight relative to volatility")
        return state
    drift = abs(closes[body_end - 1] - closes[body_start])
    if drift > cfg.flat_drift_atr * atr_ref:
        state.notes.append("body is trending, not sideways")
        # Still allow trigger detection but flag lower quality.

    # ---- context from the pre-range trend ----------------------------------
    pre_start = body_start - cfg.pre_trend_lookback
    context = "undefined"
    if pre_start >= 0 and closes[pre_start] > 0:
        pre_change = (closes[body_start] - closes[pre_start]) / closes[pre_start]
        if pre_change <= -cfg.trend_pct:
            context = "accumulation"
        elif pre_change >= cfg.trend_pct:
            context = "distribution"

    tr = TradingRange(body_start, body_end, support, resistance, context)
    state.trading_range = tr

    # ---- annotate SC / BC / ST inside the body -----------------------------
    _annotate_climax_events(state, bars, rvol, atr, tr, cfg)

    # ---- scan trigger window for the tradable event ------------------------
    candidate = _detect_trigger(bars, closes, highs, lows, rvol, atr, tr, cfg, trig_start, n)
    if candidate:
        idx, setup, direction, quality, note, detail = candidate
        state.setup = setup
        state.direction = direction
        state.trigger_index = idx
        state.trigger_price = closes[idx]
        state.quality = quality
        state.events.append(
            WyckoffEvent(setup, idx, bars[idx].t, closes[idx], note, detail)
        )
        state.events.sort(key=lambda e: e.index)
    return state


def _annotate_climax_events(state, bars, rvol, atr, tr: TradingRange, cfg):
    body = range(tr.start, tr.end)
    # Selling climax: biggest-volume wide-range down bar near support.
    sc_idx = None
    sc_score = 0.0
    for i in body:
        b = bars[i]
        rv = rvol[i] or 0
        a = _atr_at(atr, i, b.spread or 1.0)
        near = (b.low - tr.support) <= cfg.proximity_atr * a
        wide = b.spread >= cfg.wide_spread_mult * a
        if rv >= cfg.climax_vol_mult and near and wide and not b.is_up:
            score = rv * (1.0 + b.close_location)  # reward close-off-the-low absorption
            if score > sc_score:
                sc_score, sc_idx = score, i
    if sc_idx is not None:
        state.events.append(
            WyckoffEvent(SC, sc_idx, bars[sc_idx].t, bars[sc_idx].low,
                         f"rvol {rvol[sc_idx]:.1f}x", "panic low / possible absorption")
        )
        # Secondary test: later bar retesting the SC low on lighter volume.
        for j in range(sc_idx + 1, tr.end):
            b = bars[j]
            a = _atr_at(atr, j, b.spread or 1.0)
            if abs(b.low - bars[sc_idx].low) <= cfg.proximity_atr * a and (rvol[j] or 9) < (rvol[sc_idx] or 1):
                state.events.append(
                    WyckoffEvent(ST, j, b.t, b.low, f"rvol {rvol[j]:.1f}x", "retest on lighter volume")
                )
                break

    # Buying climax: biggest-volume wide-range up bar near resistance.
    bc_idx = None
    bc_score = 0.0
    for i in body:
        b = bars[i]
        rv = rvol[i] or 0
        a = _atr_at(atr, i, b.spread or 1.0)
        near = (tr.resistance - b.high) <= cfg.proximity_atr * a
        wide = b.spread >= cfg.wide_spread_mult * a
        if rv >= cfg.climax_vol_mult and near and wide and b.is_up:
            score = rv * (2.0 - b.close_location)  # reward close-off-the-high (weakness)
            if score > bc_score:
                bc_score, bc_idx = score, i
    if bc_idx is not None:
        state.events.append(
            WyckoffEvent(BC, bc_idx, bars[bc_idx].t, bars[bc_idx].high,
                         f"rvol {rvol[bc_idx]:.1f}x", "buying climax / possible supply")
        )


def _detect_trigger(bars, closes, highs, lows, rvol, atr, tr, cfg, trig_start, n):
    """Return the most recent qualifying trigger as a tuple, or None.

    tuple = (index, setup, direction, quality0to1, volume_note, detail)
    """
    best = None
    for i in range(trig_start, n):
        b = bars[i]
        a = _atr_at(atr, i, b.spread or 1.0)
        rv = rvol[i] or 1.0

        # ---- SPRING / SHAKEOUT (long, Phase C) -----------------------------
        if tr.context in ("accumulation", "undefined"):
            penetration = tr.support - b.low
            if penetration >= cfg.min_penetration_atr * a and b.close > tr.support:
                # recovered back above support -> spring
                if rv <= cfg.dry_vol_mult:
                    note, vq = f"low-volume spring (rvol {rv:.1f}x, no supply)", 0.95
                elif b.close_location >= 0.5:
                    note, vq = f"shakeout absorbed (rvol {rv:.1f}x, close off low)", 0.8
                else:
                    note, vq = f"high-volume undercut (rvol {rv:.1f}x, weak)", 0.45
                # deeper recovery within the range => higher quality
                recov = min(1.0, (b.close - tr.support) / max(tr.height, a))
                quality = min(0.55 + 0.25 * recov + 0.20 * vq, 0.98)
                best = _keep_latest(best, (i, SPRING, "long", round(quality, 3), note, "false break below support, recovered"))
                continue

        # ---- SOS breakout (long, Phase D) ----------------------------------
        if tr.context in ("accumulation", "undefined"):
            if b.close > tr.resistance and b.spread >= cfg.wide_spread_mult * a and rv >= cfg.sos_vol_mult:
                quality = min(0.9, 0.5 + 0.15 * (rv - cfg.sos_vol_mult) + 0.2 * b.close_location)
                best = _keep_latest(best, (i, SOS, "long", round(quality, 3),
                                           f"expanding volume (rvol {rv:.1f}x)", "wide-spread breakout above resistance"))
                continue

        # ---- LPS pullback (long, Phase D) ----------------------------------
        if tr.context in ("accumulation", "undefined"):
            broke = any(closes[k] > tr.resistance for k in range(max(trig_start - 5, 0), i))
            near_res = abs(b.close - tr.resistance) <= cfg.proximity_atr * a and b.close >= tr.resistance * (1 - 0.01)
            higher_low = b.low > tr.support + 0.25 * tr.height
            if broke and near_res and higher_low and rv <= 1.1:
                quality = 0.55 + 0.2 * b.close_location
                best = _keep_latest(best, (i, LPS, "long", round(quality, 3),
                                           f"quiet pullback (rvol {rv:.1f}x)", "higher low holding prior breakout"))
                continue

        # ---- UPTHRUST / UTAD (short/exit, Phase C of distribution) ---------
        if tr.context in ("distribution", "undefined"):
            penetration = b.high - tr.resistance
            if penetration >= cfg.min_penetration_atr * a and b.close < tr.resistance:
                setup = UTAD if tr.context == "distribution" else UPTHRUST
                weak = b.close_location <= 0.5
                quality = 0.6 + (0.25 if weak else 0.0) + min(0.15, 0.1 * (rv - 1))
                best = _keep_latest(best, (i, setup, "short", round(min(quality, 0.95), 3),
                                           f"rvol {rv:.1f}x", "false break above resistance, rejected"))
                continue

        # ---- SOW breakdown (short/exit, Phase D of distribution) -----------
        if tr.context in ("distribution", "undefined"):
            if b.close < tr.support and b.spread >= cfg.wide_spread_mult * a and rv >= cfg.sos_vol_mult:
                quality = min(0.9, 0.5 + 0.15 * (rv - cfg.sos_vol_mult) + 0.2 * (1 - b.close_location))
                best = _keep_latest(best, (i, SOW, "short", round(quality, 3),
                                           f"expanding volume (rvol {rv:.1f}x)", "wide-spread breakdown below support"))
                continue
    return best


def _keep_latest(best, candidate):
    if best is None:
        return candidate
    # prefer the most recent bar; tie-break on quality
    if candidate[0] > best[0]:
        return candidate
    if candidate[0] == best[0] and candidate[3] > best[3]:
        return candidate
    return best
