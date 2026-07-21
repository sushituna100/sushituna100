import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from wyckoff_bot import wyckoff as wy  # noqa: E402
from wyckoff_bot.datafeed import Bar, Series  # noqa: E402
from wyckoff_bot.signals import generate_signal, SignalConfig  # noqa: E402
from wyckoff_bot.strategy import Strategy, StrategyConfig  # noqa: E402
from wyckoff_bot.risk import RiskConfig, PortfolioState, OpenPosition  # noqa: E402
from wyckoff_bot.synth import make_accumulation  # noqa: E402
from wyckoff_bot.backtest import run_backtest  # noqa: E402


class TestWyckoffDetection(unittest.TestCase):
    def setUp(self):
        self.series = make_accumulation()

    def test_range_and_context(self):
        st = wy.analyze(self.series)
        self.assertIsNotNone(st.trading_range)
        self.assertEqual(st.trading_range.context, "accumulation")
        self.assertLess(st.trading_range.support, st.trading_range.resistance)

    def test_spring_is_the_trigger(self):
        st = wy.analyze(self.series)
        self.assertEqual(st.setup, wy.SPRING)
        self.assertEqual(st.direction, "long")
        self.assertGreater(st.quality, 0.6)

    def test_climax_annotated(self):
        st = wy.analyze(self.series)
        kinds = {e.kind for e in st.events}
        self.assertIn(wy.SC, kinds)  # selling climax detected inside the body


class TestSignalAndRisk(unittest.TestCase):
    def setUp(self):
        self.series = make_accumulation()

    def test_signal_actionable(self):
        sig = generate_signal(self.series)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.direction, "long")
        self.assertEqual(sig.setup, wy.SPRING)
        self.assertGreaterEqual(sig.reward_risk, 1.8)
        self.assertGreaterEqual(sig.confidence, 0.55)
        self.assertTrue(sig.is_actionable(SignalConfig()))

    def test_stop_below_entry_for_long(self):
        sig = generate_signal(self.series)
        self.assertLess(sig.stop, sig.entry)
        self.assertGreater(sig.targets[0], sig.entry)

    def test_confirmations_are_setup_appropriate(self):
        sig = generate_signal(self.series)
        names = {c.name for c in sig.confirmations}
        # spring is a reversal setup -> divergence-style confirmations, not raw momentum
        self.assertIn("rsi_divergence", names)
        self.assertIn("volume_dryup", names)

    def test_sizing_respects_risk_budget(self):
        strat = Strategy()  # default: $10k equity, 0.5% risk
        plans = strat.scan({"DEMO": self.series})
        self.assertTrue(plans)
        p = plans[0]
        self.assertTrue(p.actionable)
        self.assertLessEqual(p.dollar_risk, 0.005 * 10_000 + 1e-6)
        self.assertGreater(p.shares, 0)

    def test_position_cap_enforced(self):
        # tiny risk fraction but a big move -> capped by max_position_pct
        cfg = StrategyConfig()
        cfg.risk = RiskConfig(account_equity=10_000, risk_per_trade_pct=0.5,
                              max_position_pct=0.20, allow_fractional=True)
        plans = Strategy(cfg).scan({"DEMO": self.series})
        p = plans[0]
        self.assertLessEqual(p.notional, 0.20 * 10_000 + 1e-6)

    def test_portfolio_guard_blocks_duplicate(self):
        strat = Strategy()
        held = PortfolioState(
            equity=10_000,
            open_positions=[OpenPosition("DEMO", 10, 70, 66)],
        )
        plans = strat.scan({"DEMO": self.series}, portfolio=held)
        self.assertFalse(plans[0].actionable)
        self.assertTrue(any("already holding" in b for b in plans[0].blocks))


class TestGuards(unittest.TestCase):
    def _flat_series(self, n=200, price=100.0):
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        bars = [
            Bar(start + timedelta(days=i), price, price + 0.2, price - 0.2, price, 1_000_000)
            for i in range(n)
        ]
        return Series("FLAT", bars)

    def test_no_signal_on_structureless_data(self):
        self.assertIsNone(generate_signal(self._flat_series()))

    def test_short_history_is_safe(self):
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        bars = [Bar(start + timedelta(days=i), 100, 101, 99, 100, 1000) for i in range(10)]
        self.assertIsNone(generate_signal(Series("TINY", bars)))


class TestBacktest(unittest.TestCase):
    def test_backtest_runs_without_lookahead_error(self):
        res = run_backtest(make_accumulation(), max_hold=20)
        # It should complete and produce a well-formed result object.
        self.assertGreaterEqual(res.n, 0)
        self.assertIsInstance(res.summary(), str)


if __name__ == "__main__":
    unittest.main()
