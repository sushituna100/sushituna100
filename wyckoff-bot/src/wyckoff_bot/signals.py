"""Signal generation: Wyckoff structure + independent indicator confirmation.

A Wyckoff trigger on its own is not a trade. This module takes the trigger from
``wyckoff.analyze`` and *cross-examines* it with indicators that are computed
independently of the pattern:

  * OBV slope    – is real volume flowing the way the pattern claims? (effort)
  * RSI          – momentum turning, and divergence at the extreme
  * EMA trend    – is price reclaiming / holding the mean in the trade's favor?
  * MFI          – volume-weighted money flow agreeing with OBV
  * ADX / DI     – regime + which side has directional control

Only when enough of these agree does a ``Signal`` get real confidence. Every
signal ships with a concrete ATR-based protective stop and structural targets
(the range top for the first objective, a Wyckoff cause-and-effect measured move
for the second), plus a reward:risk number, so the risk layer can size it and a
human can sanity-check it at a glance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .datafeed import Series
from . import indicators as ind
from . import wyckoff as wy


@dataclass
class SignalConfig:
    ema_trend: int = 30
    ema_fast: int = 10
    rsi_period: int = 14
    mfi_period: int = 14
    obv_slope_lookback: int = 15
    stop_buffer_atr: float = 0.5     # extra ATR cushion beyond the structural stop
    min_reward_risk: float = 1.8     # trades below this are flagged, not sized
    min_confirmations: int = 2       # independent confirmations required to act
    min_confidence: float = 0.55     # composite score required to act


@dataclass
class Confirmation:
    name: str
    passed: bool
    weight: float
    detail: str


@dataclass
class Signal:
    symbol: str
    direction: str            # 'long' | 'short'
    setup: str                # spring / sos_breakout / lps / upthrust / utad / sow_breakdown
    time: datetime
    price: float              # reference price at the trigger bar
    entry: float
    stop: float
    targets: List[float]
    reward_risk: float
    confidence: float         # 0..1 composite
    wyckoff_quality: float
    context: str
    support: float
    resistance: float
    confirmations: List[Confirmation] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)

    @property
    def confirmation_count(self) -> int:
        return sum(1 for c in self.confirmations if c.passed)

    @property
    def risk_per_share(self) -> float:
        return abs(self.entry - self.stop)

    def is_actionable(self, cfg: "SignalConfig") -> bool:
        return (
            self.confidence >= cfg.min_confidence
            and self.confirmation_count >= cfg.min_confirmations
            and self.reward_risk >= cfg.min_reward_risk
            and self.risk_per_share > 0
        )

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "direction": self.direction,
            "setup": self.setup,
            "time": self.time.isoformat(),
            "entry": round(self.entry, 4),
            "stop": round(self.stop, 4),
            "targets": [round(t, 4) for t in self.targets],
            "reward_risk": round(self.reward_risk, 2),
            "confidence": round(self.confidence, 3),
            "wyckoff_quality": round(self.wyckoff_quality, 3),
            "context": self.context,
            "support": round(self.support, 4),
            "resistance": round(self.resistance, 4),
            "confirmations": [c.name for c in self.confirmations if c.passed],
            "reasons": self.reasons,
        }


def generate_signal(
    series: Series,
    wyk_cfg: Optional[wy.WyckoffConfig] = None,
    sig_cfg: Optional[SignalConfig] = None,
) -> Optional[Signal]:
    sig_cfg = sig_cfg or SignalConfig()
    state = wy.analyze(series, wyk_cfg)
    if not state.has_signal or state.trading_range is None:
        return None

    i = state.trigger_index
    bars = series.bars
    highs, lows, closes, vols = series.highs, series.lows, series.closes, series.volumes
    tr = state.trading_range

    atr_list = ind.atr(highs, lows, closes, (wyk_cfg or wy.WyckoffConfig()).atr_period)
    atr = atr_list[i] if atr_list[i] is not None else ind.last_valid(atr_list[: i + 1]) or (highs[i] - lows[i]) or 1.0

    entry, stop, targets = _levels(state, tr, bars, highs, lows, closes, atr, sig_cfg)
    if entry is None:
        return None

    risk = abs(entry - stop)
    if risk <= 0:
        return None
    first_target = targets[0]
    reward_risk = abs(first_target - entry) / risk

    confs = _confirmations(state, series, i, sig_cfg, wyk_cfg or wy.WyckoffConfig())
    confidence = _score(state.quality, confs)

    reasons = [f"Wyckoff {state.setup} in {tr.context} range ({state.events[-1].volume_note})"]
    for c in confs:
        if c.passed:
            reasons.append(c.detail)
    if reward_risk < sig_cfg.min_reward_risk:
        reasons.append(f"reward:risk {reward_risk:.2f} below target {sig_cfg.min_reward_risk} — flagged")

    return Signal(
        symbol=series.symbol,
        direction=state.direction,
        setup=state.setup,
        time=bars[i].t,
        price=closes[i],
        entry=entry,
        stop=stop,
        targets=targets,
        reward_risk=reward_risk,
        confidence=confidence,
        wyckoff_quality=state.quality,
        context=tr.context,
        support=tr.support,
        resistance=tr.resistance,
        confirmations=confs,
        reasons=reasons,
    )


def _levels(state, tr, bars, highs, lows, closes, atr, cfg) -> Tuple[Optional[float], float, List[float]]:
    """Return (entry, stop, targets) for the trigger. None entry => skip."""
    i = state.trigger_index
    b = bars[i]
    height = max(tr.height, atr)

    if state.direction == "long":
        entry = closes[i]
        if state.setup == wy.SPRING:
            stop = lows[i] - cfg.stop_buffer_atr * atr          # below the spring low
        elif state.setup == wy.LPS:
            stop = min(lows[i], tr.resistance) - cfg.stop_buffer_atr * atr
        else:  # SOS breakout
            stop = tr.mid - cfg.stop_buffer_atr * atr           # back inside the range invalidates
        t1 = tr.resistance if tr.resistance > entry else entry + 0.6 * height
        t2 = tr.resistance + height                            # measured move (cause -> effect)
        targets = [round(t, 4) for t in (t1, t2) if t > entry] or [entry + height]
        return entry, stop, targets

    # short / exit
    entry = closes[i]
    if state.setup in (wy.UPTHRUST, wy.UTAD):
        stop = highs[i] + cfg.stop_buffer_atr * atr             # above the upthrust high
    else:  # SOW breakdown
        stop = tr.mid + cfg.stop_buffer_atr * atr
    t1 = tr.support if tr.support < entry else entry - 0.6 * height
    t2 = tr.support - height
    targets = [round(t, 4) for t in (t1, t2) if t < entry] or [entry - height]
    return entry, stop, targets


def _confirmations(state, series: Series, i: int, cfg: SignalConfig, wcfg) -> List[Confirmation]:
    """Cross-examine the trigger with independent indicators.

    The checks differ by setup type, because the *right* confirmation depends on
    what the pattern claims:

    * Reversal triggers (spring, upthrust/UTAD) fire at a moment of maximum
      apparent weakness/strength. There, raw momentum is meaningless — the
      confirmation is **divergence** (price makes a new extreme, the indicator
      does not), **volume dry-up**, and **close rejection** (close off the low/
      high). That is the smart-money-absorbing-the-crowd fingerprint.
    * Continuation triggers (SOS, LPS, SOW) fire on a move *with* the intended
      direction, so momentum/trend alignment (EMA, DI, MFI, OBV slope) is the
      correct confirmation.
    """
    highs, lows, closes, vols = series.highs, series.lows, series.closes, series.volumes
    long_side = state.direction == "long"
    tr = state.trading_range

    obv = ind.obv(closes, vols)
    rsi = ind.rsi(closes, cfg.rsi_period)
    ema_t = ind.ema(closes, cfg.ema_trend)
    ema_f = ind.ema(closes, cfg.ema_fast)
    mfi = ind.mfi(highs, lows, closes, vols, cfg.mfi_period)
    pdi, mdi, adx = ind.adx(highs, lows, closes, wcfg.atr_period)
    rvol = ind.relative_volume(vols, wcfg.vol_avg_period)

    def at(x):
        return x[i] if i < len(x) and x[i] is not None else ind.last_valid(x[: i + 1])

    reversal = state.setup in (wy.SPRING, wy.UPTHRUST, wy.UTAD)
    confs: List[Confirmation] = []

    if reversal:
        # Reference extreme inside the range body (the prior low for a spring,
        # the prior high for an upthrust) to test for divergence.
        body = range(tr.start, tr.end)
        if long_side:
            ref = min(body, key=lambda k: lows[k])
        else:
            ref = max(body, key=lambda k: highs[k])

        r, r_ref = at(rsi), rsi[ref]
        if r is not None and r_ref is not None:
            ok = (r > r_ref) if long_side else (r < r_ref)
            confs.append(Confirmation("rsi_divergence", ok, 0.16,
                         f"RSI divergence: {r:.0f} at the {'spring' if long_side else 'upthrust'} "
                         f"vs {r_ref:.0f} at the prior extreme"))

        o_now, o_ref = obv[i], obv[ref]
        ok = (o_now >= o_ref) if long_side else (o_now <= o_ref)
        confs.append(Confirmation("obv_divergence", ok, 0.14,
                     f"OBV {'held above' if ok else 'confirmed'} the prior extreme (absorption)"))

        rv = at(rvol) or 1.0
        confs.append(Confirmation("volume_dryup", rv < 1.0, 0.12,
                     f"volume {rv:.1f}x average at the trigger ({'dried up' if rv < 1.0 else 'still heavy'})"))

        cl = series.bars[i].close_location
        ok = cl >= 0.5 if long_side else cl <= 0.5
        confs.append(Confirmation("close_rejection", ok, 0.10,
                     f"close {'off the low' if long_side else 'off the high'} (location {cl:.2f})"))
        return confs

    # ---- continuation setups: momentum / trend alignment -------------------
    obv_slope = ind.slope(obv[max(0, i - cfg.obv_slope_lookback): i + 1], cfg.obv_slope_lookback)
    if obv_slope is not None:
        ok = obv_slope > 0 if long_side else obv_slope < 0
        confs.append(Confirmation("obv", ok, 0.14,
                     f"OBV {'rising' if obv_slope > 0 else 'falling'} into the breakout (effort confirms move)"))

    r = at(rsi)
    r_prev = rsi[i - 3] if i - 3 >= 0 and rsi[i - 3] is not None else r
    if r is not None and r_prev is not None:
        ok = (r > r_prev and 40 <= r <= 75) if long_side else (r < r_prev and 25 <= r <= 60)
        confs.append(Confirmation("rsi", ok, 0.12,
                     f"RSI {'rising' if r > r_prev else 'falling'} through {r:.0f} in trend direction"))

    et, ef, px = at(ema_t), at(ema_f), closes[i]
    if et is not None and ef is not None:
        ok = (px >= ef >= et * 0.985) if long_side else (px <= ef <= et * 1.015)
        confs.append(Confirmation("ema_trend", ok, 0.12,
                     f"price {'above' if long_side else 'below'} the fast mean, trend EMA aligned"))

    m = at(mfi)
    if m is not None:
        ok = m > 50 if long_side else m < 50
        confs.append(Confirmation("mfi", ok, 0.08, f"money flow index {m:.0f}"))

    p, mn = at(pdi), at(mdi)
    if p is not None and mn is not None:
        ok = p >= mn if long_side else mn >= p
        confs.append(Confirmation("adx_di", ok, 0.08,
                     f"{'+DI' if long_side else '-DI'} leading (directional control)"))
    return confs


def _score(quality: float, confs: List[Confirmation]) -> float:
    base = 0.30 + 0.30 * quality
    bonus = sum(c.weight for c in confs if c.passed)
    penalty = 0.35 * sum(c.weight for c in confs if not c.passed)
    return max(0.0, min(0.98, base + bonus - penalty))
